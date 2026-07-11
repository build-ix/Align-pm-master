#!/usr/bin/env node
/**
 * Align PM — Upgraded Auditor (two-mode CLI)
 * ==========================================
 * MODE 1 — AUDIT   : node tools/auditor.js audit
 *   Playwright against the LIVE app (http://localhost:3002). Signs in,
 *   iterates every project, opens all 12 tiles per project, verifies the
 *   section body renders non-empty content, collects console errors and
 *   failed network requests, screenshots ONLY failing tiles.
 *   Writes plain-text report: tools/reports/audit-<YYYYMMDD-HHMM>.txt
 *   Exit 0 = all pass, 1 = failures, 2 = audit crashed.
 *   On failures only: calls ~/.local/bin/notify-alfredo with a summary.
 *
 * MODE 2 — PREVIEW : node tools/auditor.js preview <run-name> [staging-dir]
 *   Approve-before-deploy snapshot generator.
 *   - Builds /home/alfr/align-staging/ via rsync (excludes data/, uploads/,
 *     node_modules, .git, tools/reports) unless staging-dir is supplied.
 *   - Copies the live DB (cp only — production is NEVER written or moved).
 *   - Symlinks node_modules, starts staging server on 127.0.0.1:3010
 *     (PORT=3010, DEV_MODE=false), waits for /api/health | /api/ping.
 *   - Captures the 12-PNG snapshot matrix (desktop 1440x900 + mobile
 *     390x844, light + dark themes, screens: signin / projects / dashboard)
 *     to "/home/alfr/iPhoneDrop/Align/UI Redesign Review/<run-name>/".
 *   - Kills the staging server and verifies port 3010 is free.
 *
 * SAFETY: never touches production data in place, never binds 3002,
 * never restarts align-server. Pure script — no LLM involved.
 */
'use strict';

const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');

/* ── Constants ─────────────────────────────────────────────────────────── */
const LIVE_BASE     = process.env.ALIGN_BASE_URL || 'http://localhost:3002';
const USER          = process.env.ALIGN_USER || 'admin';
const PASS          = process.env.ALIGN_PASS || 'Alfredo25';
const PROD_DIR      = '/home/alfr/align-pm-master';
const TOOLS_DIR     = path.join(PROD_DIR, 'tools');
const REPORTS_DIR   = path.join(TOOLS_DIR, 'reports');
const DEFAULT_STAGING = '/home/alfr/align-staging';
const STAGING_PORT  = 3010;
const STAGING_BASE  = 'http://127.0.0.1:' + STAGING_PORT;
const REVIEW_ROOT   = '/home/alfr/iPhoneDrop/Align/UI Redesign Review';
const NOTIFY_BIN    = '/home/alfr/.local/bin/notify-alfredo';

const SECTIONS = [
  'drawings', 'daily-logs', 'specs', 'rfis', 'punchlist', 'schedule',
  'budget', 'contacts', 'photos', 'tasks', 'procurement', 'files',
];

/* ── Helpers ───────────────────────────────────────────────────────────── */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function notify(title, msg, priority) {
  try {
    execFileSync(NOTIFY_BIN, [title, msg, priority || 'default'], { timeout: 15000 });
  } catch (e) {
    console.error('  (notify-alfredo failed: ' + e.message + ')');
  }
}

function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs || 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(1500, () => done(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Shared Playwright: sign in through the real UI ────────────────────── */
async function signIn(page, base) {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#auth-login-form, #auth-card-view', { timeout: 20000 });
  if (await page.$('#auth-card-view')) {
    // "Welcome back" card for a remembered user — switch to full login form
    await page.click('#auth-not-you-btn');
    await page.waitForSelector('#auth-login-username', { state: 'visible', timeout: 8000 });
  }
  await page.fill('#auth-login-username', USER);
  await page.fill('#auth-login-password', PASS);
  const submit = (await page.$('#auth-login-submit')) || (await page.$('.auth-signin-btn'));
  if (!submit) throw new Error('sign-in submit button not found');
  await submit.click();
  await page.waitForFunction(() => location.hash === '#project-select', { timeout: 15000 });
  await page.waitForSelector('.ps-card[data-pid]', { timeout: 15000 });
}

/* ════════════════════════════════════════════════════════════════════════
 * MODE 1 — AUDIT
 * ════════════════════════════════════════════════════════════════════════ */
async function runAudit() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = stamp();
  const reportPath = path.join(REPORTS_DIR, 'audit-' + ts + '.txt');
  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };

  const results = [];      // { name, status: 'pass'|'fail', detail }
  const jsErrors = [];     // { step, text }
  const netErrors = [];    // { step, text }
  let step = 'boot';

  say('ALIGN AUDIT — ' + new Date().toString());
  say('Target: ' + LIVE_BASE);
  say('='.repeat(64));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon|ServiceWorker.*insecure|ipapi\.co|status of 401/i.test(text)) return;
    jsErrors.push({ step, text: 'console.error: ' + text.slice(0, 400) });
  });
  page.on('pageerror', (err) => {
    jsErrors.push({ step, text: 'pageerror: ' + String(err).slice(0, 400) });
  });
  page.on('requestfailed', (req) => {
    if (/cdnjs|sentry|ipapi\.co/i.test(req.url())) return; // external services
    const f = req.failure();
    netErrors.push({ step, text: 'request failed: ' + req.url() + ' — ' + (f ? f.errorText : 'unknown') });
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      // expected pre-auth probes while the sign-in overlay is up
      if (res.status() === 401 && /^(boot|signin)$/.test(step) &&
          /\/api\/(auth\/me|projects)/.test(res.url())) return;
      netErrors.push({ step, text: 'HTTP ' + res.status() + ': ' + res.url() });
    }
  });

  async function failShot(name) {
    try {
      const p = path.join(REPORTS_DIR, 'audit-' + ts + '-FAIL-' + name.replace(/[^a-z0-9-]/gi, '_') + '.png');
      await page.screenshot({ path: p, fullPage: true });
      return p;
    } catch { return null; }
  }

  function record(name, ok, detail) {
    results.push({ name, status: ok ? 'pass' : 'fail', detail: detail || '' });
    say('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  }

  try {
    // Sign in
    step = 'signin';
    await signIn(page, LIVE_BASE);
    record('Sign-in (' + USER + ') -> #project-select', true);

    // Enumerate projects
    step = 'project-select';
    const projects = await page.$$eval('.ps-card[data-pid]', (cards) =>
      cards.map((c) => ({
        pid: c.dataset.pid,
        name: ((c.querySelector('.ps-card-name') || {}).textContent || '').trim(),
      })));
    // Audit whatever projects actually exist. The only failure condition is
    // ZERO projects (that means the DB/app is broken); any count >= 1 is fine.
    record('Project selection (' + projects.length + ' project(s): ' +
      projects.map((p) => p.name || p.pid).join(', ') + ')', projects.length > 0,
      projects.length === 0 ? 'no projects found — DB/app may be broken' : '');

    // Per project: open dashboard, walk all 12 tiles
    for (const proj of projects) {
      const P = proj.name || proj.pid;
      step = 'open:' + P;
      say('');
      say('PROJECT: ' + P);

      try {
        await page.evaluate(() => { location.hash = '#project-select'; });
        await page.waitForSelector('.ps-card[data-pid="' + proj.pid + '"]', { timeout: 10000 });
        await page.click('.ps-card[data-pid="' + proj.pid + '"]');
        await page.waitForFunction(() => {
          const tg = document.querySelector('.tile-grid');
          return location.hash === '' && tg && getComputedStyle(tg).display !== 'none';
        }, { timeout: 12000 });
        record('[' + P + '] Dashboard opens', true);
      } catch (e) {
        record('[' + P + '] Dashboard opens', false, e.message.split('\n')[0]);
        await failShot(P + '-dashboard');
        continue;
      }

      const tileKeys = await page.$$eval('.tile[data-section]', (t) => t.map((x) => x.dataset.section));
      const missing = SECTIONS.filter((s) => !tileKeys.includes(s));
      record('[' + P + '] All ' + SECTIONS.length + ' tiles present', missing.length === 0,
        missing.length ? 'missing: ' + missing.join(', ') : tileKeys.length + ' tiles found');

      for (const key of SECTIONS) {
        step = P + ':' + key;
        const jsBefore = jsErrors.length;
        const netBefore = netErrors.length;
        try {
          const tile = await page.$('.tile[data-section="' + key + '"]');
          if (!tile) { record('[' + P + '] Tile "' + key + '"', false, 'tile not found in DOM'); continue; }
          await tile.click();

          // Section body must render non-empty content
          await page.waitForSelector('#section-page', { state: 'visible', timeout: 12000 });
          await page.waitForFunction(() => {
            const b = document.getElementById('section-body');
            return b && b.children.length > 0 && b.innerText.trim().length > 0;
          }, { timeout: 12000 });
          await page.waitForTimeout(400); // let async fetches land

          const bodyLen = await page.$eval('#section-body', (el) => el.innerText.trim().length);
          const title = await page.$eval('#section-title', (el) => el.textContent.trim()).catch(() => '');
          const newJs = jsErrors.slice(jsBefore).map((e) => e.text);
          const newNet = netErrors.slice(netBefore).map((e) => e.text);

          if (bodyLen > 0 && newJs.length === 0 && newNet.length === 0) {
            record('[' + P + '] Tile "' + key + '"', true, 'title "' + title + '", ' + bodyLen + ' chars rendered');
          } else {
            const probs = [];
            if (bodyLen === 0) probs.push('section body empty');
            if (newJs.length) probs.push(newJs.length + ' JS error(s): ' + newJs.join(' | '));
            if (newNet.length) probs.push(newNet.length + ' network failure(s): ' + newNet.join(' | '));
            record('[' + P + '] Tile "' + key + '"', false, probs.join('; '));
            const sp = await failShot(P + '-' + key);
            if (sp) say('        screenshot: ' + sp);
          }

          // Back to dashboard
          await page.click('#section-back');
          await page.waitForFunction(() => {
            const tg = document.querySelector('.tile-grid');
            return tg && getComputedStyle(tg).display !== 'none';
          }, { timeout: 10000 });
        } catch (e) {
          const newJs = jsErrors.slice(jsBefore).map(x => x.text);
          const newNet = netErrors.slice(netBefore).map(x => x.text);
          const extra = [].concat(newJs, newNet);
          record('[' + P + '] Tile "' + key + '"', false,
            'render/navigation error: ' + e.message.split('\n')[0] +
            (extra.length ? ' | ' + extra.join(' | ') : ''));
          const sp = await failShot(P + '-' + key);
          if (sp) say('        screenshot: ' + sp);
          // recover to dashboard
          await page.evaluate(() => { location.hash = ''; }).catch(() => {});
          await page.waitForTimeout(800);
        }
      }
    }
  } catch (fatal) {
    record('AUDIT ABORTED', false, fatal.message.split('\n')[0]);
    await failShot('fatal');
  } finally {
    await browser.close().catch(() => {});
  }

  // ── Report ──
  const failures = results.filter((r) => r.status === 'fail');
  say('');
  say('='.repeat(64));
  say('SUMMARY: ' + (results.length - failures.length) + '/' + results.length +
    ' checks passed, ' + failures.length + ' failed');
  say('Console/page JS errors captured: ' + jsErrors.length);
  say('Failed network requests captured: ' + netErrors.length);
  if (jsErrors.length) {
    say('');
    say('JS ERRORS:');
    jsErrors.forEach((e) => say('  [' + e.step + '] ' + e.text));
  }
  if (netErrors.length) {
    say('');
    say('NETWORK ERRORS:');
    netErrors.forEach((e) => say('  [' + e.step + '] ' + e.text));
  }
  say('');
  say('RESULT: ' + (failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILURE(S)'));

  fs.writeFileSync(reportPath, lines.join('\n') + '\n');
  console.log('\nReport written: ' + reportPath);

  if (failures.length > 0) {
    const summary = failures.slice(0, 5).map((f) => f.name + (f.detail ? ' (' + f.detail.slice(0, 80) + ')' : '')).join('; ');
    notify('Align audit: ' + failures.length + ' failure(s)',
      summary + ' — report: ' + reportPath, 'high');
    return 1;
  }
  return 0;
}

/* ════════════════════════════════════════════════════════════════════════
 * MODE 2 — PREVIEW
 * ════════════════════════════════════════════════════════════════════════ */
async function runPreview(runName, stagingDirArg) {
  if (!runName) {
    console.error('Usage: node tools/auditor.js preview <run-name> [staging-dir]');
    return 2;
  }
  const stagingDir = stagingDirArg ? path.resolve(stagingDirArg) : DEFAULT_STAGING;
  if (path.resolve(stagingDir) === path.resolve(PROD_DIR)) {
    console.error('REFUSING: staging dir must not be the production dir.');
    return 2;
  }
  const outDir = path.join(REVIEW_ROOT, runName);
  console.log('PREVIEW run "' + runName + '"');
  console.log('  staging dir : ' + stagingDir);
  console.log('  output dir  : ' + outDir);

  // Port must be free before we start
  if (await portInUse(STAGING_PORT)) {
    console.error('ABORT: port ' + STAGING_PORT + ' is already in use. ' +
      'Stop whatever is bound to it and retry (staging refuses to share the port).');
    return 2;
  }

  /* (a) Build staging copy */
  if (!stagingDirArg) {
    console.log('\n[a] rsync production -> staging (excluding data/, uploads/, node_modules, .git, tools/reports)');
    fs.mkdirSync(stagingDir, { recursive: true });
    execFileSync('rsync', [
      '-a', '--delete',
      '--exclude=data/', '--exclude=uploads/', '--exclude=node_modules',
      '--exclude=.git', '--exclude=tools/reports',
      PROD_DIR + '/', stagingDir + '/',
    ], { stdio: 'inherit' });
  } else {
    console.log('\n[a] using existing staging dir (no rsync): ' + stagingDir);
  }
  if (!fs.existsSync(path.join(stagingDir, 'server.js'))) {
    console.error('ABORT: ' + stagingDir + '/server.js not found — not a valid staging copy.');
    return 2;
  }

  // Copy live DB read-only (cp only; production files are never moved/written)
  const stagingData = path.join(stagingDir, 'data');
  fs.mkdirSync(stagingData, { recursive: true });
  const dbFiles = ['align.db', 'align.db-wal', 'align.db-shm'];
  for (const f of dbFiles) {
    const src = path.join(PROD_DIR, 'data', f);
    if (fs.existsSync(src)) {
      execFileSync('cp', ['--preserve=timestamps', src, path.join(stagingData, f)]);
      console.log('    cp ' + f + ' -> staging/data/');
    }
  }

  /* (b) node_modules symlink */
  const nmLink = path.join(stagingDir, 'node_modules');
  if (!fs.existsSync(nmLink)) {
    fs.symlinkSync(path.join(PROD_DIR, 'node_modules'), nmLink, 'dir');
    console.log('[b] symlinked node_modules -> production node_modules');
  } else {
    console.log('[b] node_modules already present in staging');
  }

  // Force staging to bind loopback only (patch the STAGING COPY, never prod)
  const sjPath = path.join(stagingDir, 'server.js');
  let sj = fs.readFileSync(sjPath, 'utf8');
  if (sj.includes("app.listen(PORT, '127.0.0.1',")) {
    console.log('    staging server.js already binds 127.0.0.1');
  } else if (sj.includes('app.listen(PORT,')) {
    sj = sj.replace('app.listen(PORT,', "app.listen(PORT, '127.0.0.1',");
    fs.writeFileSync(sjPath, sj);
    console.log('    patched staging server.js to bind 127.0.0.1 only');
  } else {
    console.warn('    WARNING: could not patch listen() host in staging server.js');
  }

  /* (c) Start staging server */
  console.log('[c] starting staging server on 127.0.0.1:' + STAGING_PORT + ' (DEV_MODE=false)');
  const logPath = path.join(stagingDir, 'staging-server.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn('node', ['server.js'], {
    cwd: stagingDir,
    env: { ...process.env, PORT: String(STAGING_PORT), DEV_MODE: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', logFd, logFd],
    detached: false,
  });
  let childExited = false;
  child.on('exit', () => { childExited = true; });

  const killStaging = async () => {
    if (!childExited) {
      child.kill('SIGTERM');
      for (let i = 0; i < 20 && !childExited; i++) await sleep(250);
      if (!childExited) { child.kill('SIGKILL'); await sleep(500); }
    }
    fs.closeSync(logFd);
    const stillUp = await portInUse(STAGING_PORT);
    console.log('[f] staging server stopped; port ' + STAGING_PORT + ' free: ' + !stillUp);
    return !stillUp;
  };

  /* (d) Wait for health */
  console.log('[d] waiting for ' + STAGING_BASE + '/api/health ...');
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    if (childExited) break;
    const h = await httpGet(STAGING_BASE + '/api/health', 2000);
    const p = h === 200 ? 200 : await httpGet(STAGING_BASE + '/api/ping', 2000);
    if (h === 200 || p === 200) { healthy = true; break; }
    await sleep(500);
  }
  if (!healthy) {
    console.error('ABORT: staging server never became healthy. Last log lines:');
    try { console.error(fs.readFileSync(logPath, 'utf8').split('\n').slice(-25).join('\n')); } catch {}
    await killStaging();
    return 2;
  }
  console.log('    staging healthy.');

  /* (e) Snapshot matrix: 2 viewports x 2 themes x 3 screens = 12 PNGs */
  fs.mkdirSync(outDir, { recursive: true });
  const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
  const THEMES = ['light', 'dark'];
  let captured = 0;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      for (const theme of THEMES) {
        console.log('[e] capturing ' + vpName + ' / ' + theme + ' ...');
        const ctx = await browser.newContext({
          viewport: vp,
          colorScheme: theme,
          isMobile: vpName === 'mobile',
          hasTouch: vpName === 'mobile',
          deviceScaleFactor: 2,
        });
        // Persist theme BEFORE any app script runs: index.html reads
        // 'align-theme'; settings module reads JSON 'align.settings.theme'.
        await ctx.addInitScript((t) => {
          try {
            localStorage.setItem('align-theme', t);
            localStorage.setItem('align.settings.theme', JSON.stringify(t));
          } catch (e) {}
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.setAttribute('data-theme', t);
          });
        }, theme);
        const page = await ctx.newPage();

        const snap = async (screen) => {
          // enforce theme attribute right before capture
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await page.waitForTimeout(600); // fonts / transitions settle
          const file = path.join(outDir, `${vpName}-${screen}-${theme}.png`);
          await page.screenshot({ path: file, fullPage: false });
          captured++;
          console.log('      ' + path.basename(file));
        };

        // Screen 1: signin (fresh context = signed out)
        await page.goto(STAGING_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#auth-login-form, #auth-card-view', { timeout: 20000 });
        await snap('signin');

        // Screen 2: projects (project-select)
        await signIn(page, STAGING_BASE);
        await snap('projects');

        // Screen 3: dashboard (first project)
        await page.click('.ps-card[data-pid]');
        await page.waitForFunction(() => {
          const tg = document.querySelector('.tile-grid');
          return tg && getComputedStyle(tg).display !== 'none';
        }, { timeout: 15000 });
        await snap('dashboard');

        await ctx.close();
      }
    }
  } catch (e) {
    console.error('PREVIEW capture error: ' + e.message);
    if (browser) await browser.close().catch(() => {});
    await killStaging();
    return 2;
  }
  await browser.close().catch(() => {});

  /* (f) Shut down staging, verify port free */
  const portFree = await killStaging();

  console.log('\nPREVIEW complete: ' + captured + '/12 PNGs -> ' + outDir);
  return captured === 12 && portFree ? 0 : 2;
}

/* ── CLI ───────────────────────────────────────────────────────────────── */
(async () => {
  const [, , mode, arg1, arg2] = process.argv;
  let code;
  if (mode === 'audit') {
    code = await runAudit();
  } else if (mode === 'preview') {
    code = await runPreview(arg1, arg2);
  } else {
    console.error('Usage:\n  node tools/auditor.js audit\n  node tools/auditor.js preview <run-name> [staging-dir]');
    code = 2;
  }
  process.exit(code);
})().catch((e) => {
  console.error('FATAL: ' + (e && e.stack || e));
  process.exit(2);
});

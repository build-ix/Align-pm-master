#!/usr/bin/env node
/**
 * Align PM — Full Browser Audit (Playwright, headless Chromium)
 * =============================================================
 * Signs in through the real UI, walks project selection, opens every
 * tile in every project, and records:
 *   - JS console errors and uncaught page exceptions
 *   - Failed / 4xx / 5xx network requests to /api/*
 *   - Missing or empty section content, wrong titles
 *   - Broken navigation (back button, project switching, sign-out)
 *
 * READ-ONLY by default: no records are created or deleted.
 *
 * Run:   node audit/align-audit.js
 * Env:   ALIGN_BASE_URL (default http://localhost:3002)
 *        ALIGN_USER     (default admin)
 *        ALIGN_PASS     (default Alfredo25; prefer sourcing ~/.align-audit.env)
 *        AUDIT_OUT_DIR  (default ~/align-audits)
 * Out:   report-<ts>.json, report-<ts>.md, fail-*.png screenshots
 * Exit:  0 = all pass, 1 = failures found, 2 = audit crashed
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.ALIGN_BASE_URL || 'http://localhost:3002';
const USER = process.env.ALIGN_USER || 'admin';
const PASS = process.env.ALIGN_PASS || 'Alfredo25';
const OUT_DIR = process.env.AUDIT_OUT_DIR || path.join(os.homedir(), 'align-audits');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const SECTIONS = [
  'drawings', 'daily-logs', 'specs', 'rfis', 'punchlist', 'schedule',
  'budget', 'contacts', 'photos', 'tasks', 'procurement', 'files',
];
const SECTION_TITLES = {
  'drawings': 'Drawings', 'daily-logs': 'Daily Logs', 'specs': 'Specs',
  'rfis': 'RFIs', 'punchlist': 'Punchlist', 'schedule': 'Schedule',
  'budget': 'Budget', 'contacts': 'Directory', 'photos': 'Photos',
  'tasks': 'Tasks', 'procurement': 'Procurement', 'files': 'Files',
};

const results = [];
const jsErrors = [];
const netErrors = [];
let currentStep = 'boot';

function pass(step, detail) { results.push({ step, status: 'pass', detail: detail || '' }); console.log('  \u2713 ' + step + (detail ? ' - ' + detail : '')); }
function fail(step, detail) { results.push({ step, status: 'fail', detail: detail || '' }); console.log('  \u2717 ' + step + ' - ' + detail); }
function warn(step, detail) { results.push({ step, status: 'warn', detail: detail || '' }); console.log('  ! ' + step + ' - ' + detail); }

async function shot(page, name) {
  try {
    const p = path.join(OUT_DIR, 'fail-' + STAMP + '-' + name.replace(/[^a-z0-9-]/gi, '_') + '.png');
    await page.screenshot({ path: p, fullPage: true });
    return p;
  } catch { return null; }
}

async function waitSection(page) {
  await page.waitForSelector('#section-page', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const b = document.getElementById('section-body');
    return b && b.children.length > 0 && b.innerText.trim().length > 0;
  }, { timeout: 10000 });
  await page.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Align PM Browser Audit - ' + STAMP + '\nTarget: ' + BASE + '\n');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (/favicon|ServiceWorker.*insecure/i.test(text)) return;
      jsErrors.push({ step: currentStep, type: 'console.error', text: text.slice(0, 500) });
    }
  });
  page.on('pageerror', (err) => {
    jsErrors.push({ step: currentStep, type: 'pageerror', text: String(err).slice(0, 500) });
  });
  page.on('requestfailed', (req) => {
    if (/cdnjs|sentry/i.test(req.url())) return;
    netErrors.push({ step: currentStep, url: req.url(), failure: req.failure() ? req.failure().errorText : 'unknown' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      if (res.status() === 401 && (currentStep === 'boot' || currentStep === 'signin-reject' || currentStep === 'signout')) return;
      netErrors.push({ step: currentStep, url: res.url(), status: res.status() });
    }
  });

  try {
    // 1. App loads + sign-in sheet
    currentStep = 'boot';
    const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (resp && resp.ok()) pass('App loads (HTTP ' + resp.status() + ')');
    else fail('App loads', 'HTTP ' + (resp ? resp.status() : 'no response'));

    currentStep = 'signin-sheet';
    try {
      await page.waitForSelector('#auth-login-form, #auth-card-view', { timeout: 15000 });
      pass('Sign-in sheet renders');
    } catch (e) {
      fail('Sign-in sheet renders', 'overlay never appeared: ' + e.message);
      await shot(page, 'signin-sheet');
      throw new Error('Cannot continue without sign-in sheet');
    }

    if (await page.$('#auth-card-view')) {
      await page.click('#auth-not-you-btn');
      await page.waitForSelector('#auth-login-username', { state: 'visible', timeout: 5000 });
    }

    // 1b. Wrong password rejection (consumes 1 of 10 rate-limit slots / 15 min)
    currentStep = 'signin-reject';
    await page.fill('#auth-login-username', USER);
    await page.fill('#auth-login-password', 'definitely-wrong-password');
    await page.click('#auth-login-submit');
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById('auth-login-error');
        return el && el.textContent.trim().length > 0;
      }, { timeout: 8000 });
      pass('Wrong password rejected with visible error');
    } catch { fail('Wrong password rejected', 'no error message shown'); await shot(page, 'signin-reject'); }

    // 2. Real sign-in -> project selection
    currentStep = 'signin';
    await page.fill('#auth-login-password', PASS);
    await page.click('#auth-login-submit');
    try {
      await page.waitForFunction(() => location.hash === '#project-select', { timeout: 10000 });
      pass('Sign-in succeeds -> routed to #project-select');
    } catch {
      fail('Sign-in', 'never routed to #project-select');
      await shot(page, 'signin');
      throw new Error('Cannot continue unauthenticated');
    }

    currentStep = 'project-select';
    let projects = [];
    try {
      await page.waitForSelector('.ps-card[data-pid]', { timeout: 10000 });
      projects = await page.$$eval('.ps-card[data-pid]', (cards) =>
        cards.map((c) => ({ pid: c.dataset.pid, name: (c.querySelector('.ps-card-name') || {}).textContent })));
      projects.forEach((p) => { if (p.name) p.name = p.name.trim(); });
      pass('Project selection loads (' + projects.length + ' project(s): ' + projects.map((p) => p.name).join(', ') + ')');
      if (projects.length < 2) warn('Project count', 'expected 2 projects, found ' + projects.length);
    } catch (e) {
      const errBox = await page.$('.ps-error');
      fail('Project selection loads', errBox ? await errBox.innerText() : e.message);
      await shot(page, 'project-select');
      throw new Error('No projects to audit');
    }

    // 3-5. For each project: open dashboard, audit every tile
    for (const proj of projects) {
      const P = proj.name || proj.pid;
      currentStep = 'open-project:' + P;

      await page.evaluate(() => { location.hash = '#project-select'; });
      await page.waitForSelector('.ps-card[data-pid="' + proj.pid + '"]', { timeout: 10000 });
      await page.click('.ps-card[data-pid="' + proj.pid + '"]');
      try {
        await page.waitForFunction(() => {
          const tg = document.querySelector('.tile-grid');
          return location.hash === '' && tg && getComputedStyle(tg).display !== 'none';
        }, { timeout: 10000 });
        const shownName = await page.$eval('#project-name', (el) => el.textContent.trim()).catch(() => '');
        pass('[' + P + '] Dashboard opens', shownName ? 'header shows "' + shownName + '"' : '');
        if (shownName && proj.name && shownName.indexOf(proj.name) === -1) {
          warn('[' + P + '] Header project name', 'header "' + shownName + '" does not match selected "' + proj.name + '"');
        }
      } catch {
        fail('[' + P + '] Dashboard opens', 'tile grid never became visible');
        await shot(page, 'dashboard-' + P);
        continue;
      }

      const tileKeys = await page.$$eval('.tile[data-section]', (t) => t.map((x) => x.dataset.section));
      const missingTiles = SECTIONS.filter((s) => tileKeys.indexOf(s) === -1);
      if (missingTiles.length === 0) pass('[' + P + '] All ' + SECTIONS.length + ' tiles present on dashboard');
      else fail('[' + P + '] Tiles present', 'missing: ' + missingTiles.join(', '));

      for (const key of SECTIONS) {
        currentStep = P + ':' + key;
        const jsBefore = jsErrors.length, netBefore = netErrors.length;
        try {
          const tile = await page.$('.tile[data-section="' + key + '"]');
          if (!tile) { fail('[' + P + '] Tile "' + key + '"', 'tile not found in DOM'); continue; }
          await tile.click();
          await waitSection(page);

          const title = await page.$eval('#section-title', (el) => el.textContent.trim());
          const bodyLen = await page.$eval('#section-body', (el) => el.innerText.trim().length);
          const titleOk = title === SECTION_TITLES[key];
          const newJs = jsErrors.length - jsBefore, newNet = netErrors.length - netBefore;

          if (titleOk && newJs === 0 && newNet === 0) {
            pass('[' + P + '] Tile "' + key + '"', 'title ok, ' + bodyLen + ' chars rendered');
          } else {
            const probs = [];
            if (!titleOk) probs.push('title "' + title + '" expected "' + SECTION_TITLES[key] + '"');
            if (newJs) probs.push(newJs + ' JS error(s)');
            if (newNet) probs.push(newNet + ' failed API call(s)');
            fail('[' + P + '] Tile "' + key + '"', probs.join('; '));
            await shot(page, P + '-' + key);
          }

          await page.click('#section-back');
          await page.waitForFunction(() => {
            const tg = document.querySelector('.tile-grid');
            return tg && getComputedStyle(tg).display !== 'none';
          }, { timeout: 8000 });
        } catch (e) {
          fail('[' + P + '] Tile "' + key + '"', 'render/navigation error: ' + e.message.split('\n')[0]);
          await shot(page, P + '-' + key);
          await page.evaluate(() => { location.hash = ''; }).catch(() => {});
          await page.waitForTimeout(800);
        }
      }

      // Settings route (admin-only, not a tile)
      currentStep = P + ':settings';
      try {
        await page.evaluate(() => { location.hash = '#settings'; });
        await waitSection(page);
        pass('[' + P + '] Settings page renders');
        await page.evaluate(() => { location.hash = ''; });
        await page.waitForTimeout(500);
      } catch (e) { fail('[' + P + '] Settings page', e.message.split('\n')[0]); await shot(page, P + '-settings'); }
    }

    // 6. Project switch back-and-forth
    if (projects.length >= 2) {
      currentStep = 'project-switch';
      try {
        await page.evaluate(() => { location.hash = '#project-select'; });
        await page.waitForSelector('.ps-card[data-pid="' + projects[0].pid + '"]', { timeout: 8000 });
        await page.click('.ps-card[data-pid="' + projects[0].pid + '"]');
        await page.waitForFunction(() => {
          const tg = document.querySelector('.tile-grid');
          return location.hash === '' && tg && getComputedStyle(tg).display !== 'none';
        }, { timeout: 8000 });
        pass('Switch back to first project -> dashboard loads');
      } catch { fail('Project switching', 'dashboard did not load after switch-back'); await shot(page, 'switch'); }
    }

    // 7. Sign-out
    currentStep = 'signout';
    try {
      await page.evaluate(() => { location.hash = '#project-select'; });
      await page.waitForSelector('#ps-signout', { timeout: 8000 });
      await page.click('#ps-signout');
      await page.waitForSelector('#align-auth-overlay', { timeout: 8000 });
      pass('Sign-out returns to auth overlay');
    } catch (e) { fail('Sign-out', e.message.split('\n')[0]); await shot(page, 'signout'); }

  } catch (fatal) {
    console.error('\nAUDIT ABORTED: ' + fatal.message);
  } finally {
    await browser.close();
  }

  // Report + regression diff
  const failures = results.filter((r) => r.status === 'fail');
  const warns = results.filter((r) => r.status === 'warn');
  const report = {
    timestamp: new Date().toISOString(), base: BASE,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: failures.length, warnings: warns.length,
      jsErrors: jsErrors.length, netErrors: netErrors.length,
    },
    results, jsErrors, netErrors,
  };

  const jsonPath = path.join(OUT_DIR, 'report-' + STAMP + '.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const prev = fs.readdirSync(OUT_DIR).filter((f) => /^report-.*\.json$/.test(f) && f.indexOf(STAMP) === -1).sort().pop();
  let regressions = [];
  if (prev) {
    try {
      const prevReport = JSON.parse(fs.readFileSync(path.join(OUT_DIR, prev), 'utf8'));
      const prevFailed = new Set(prevReport.results.filter((r) => r.status === 'fail').map((r) => r.step));
      regressions = failures.filter((f) => !prevFailed.has(f.step));
    } catch {}
  }

  const md = [
    '# Align PM Audit - ' + report.timestamp, '',
    'Target: ' + BASE, '',
    '**' + report.summary.passed + '/' + report.summary.total + ' passed** | ' + report.summary.failed + ' failed | ' + report.summary.warnings + ' warnings | ' + jsErrors.length + ' JS errors | ' + netErrors.length + ' network errors', '',
    regressions.length ? '## NEW REGRESSIONS (vs ' + prev + ')\n' + regressions.map((r) => '- **' + r.step + '**: ' + r.detail).join('\n') + '\n' : (prev ? '_No new regressions vs ' + prev + '._\n' : ''),
    failures.length ? '## Failures\n' + failures.map((r) => '- **' + r.step + '**: ' + r.detail).join('\n') + '\n' : '## All checks passed\n',
    warns.length ? '## Warnings\n' + warns.map((r) => '- ' + r.step + ': ' + r.detail).join('\n') + '\n' : '',
    jsErrors.length ? '## JS Errors\n' + jsErrors.map((e) => '- [' + e.step + '] ' + e.type + ': ' + e.text).join('\n') + '\n' : '',
    netErrors.length ? '## Network Errors\n' + netErrors.map((e) => '- [' + e.step + '] ' + e.url + ' -> ' + (e.status || e.failure)).join('\n') + '\n' : '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'report-' + STAMP + '.md'), md);

  console.log('\n' + '='.repeat(60));
  console.log('RESULT: ' + report.summary.passed + '/' + report.summary.total + ' passed, ' + failures.length + ' failed, ' + warns.length + ' warnings');
  if (regressions.length) console.log('WARNING: ' + regressions.length + ' NEW regression(s) vs ' + prev);
  console.log('Report: ' + jsonPath);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(2); });

const { chromium } = require('playwright');

const TILES = [
  { section: 'punchlist', createBtn: '#pl-create-list', formSel: '#pl-list-name', title: 'Punchlist', formTitle: 'Create List' },
  { section: 'rfis', createBtn: '#rf-new', formSel: '#rf-subject', title: 'RFIs', formTitle: 'New RFI' },
  { section: 'tasks', createBtn: '#tk-new', formSel: '#tk-title', title: 'Tasks', formTitle: 'New Task' },
  { section: 'specs', createBtn: '#sp-new', formSel: '#sp-title', title: 'Specs', formTitle: 'New Specification' },
  { section: 'schedule', createBtn: '#sc-new', formSel: '#sc-title', title: 'Schedule', formTitle: 'New Milestone' },
  { section: 'budget', createBtn: '#bg-new', formSel: '#bg-title', title: 'Budget', formTitle: 'New Budget Item' },
  { section: 'procurement', createBtn: '#pr-new', formSel: '#pr-title', title: 'Procurement', formTitle: 'New Purchase Order' },
  { section: 'contacts', createBtn: '#ct-new-company', formSel: '#ct-co-name', title: 'Directory', formTitle: 'New Company' }
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  const log = (...a) => console.log(...a);

  try {
    await page.goto('http://localhost:3002/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#auth-login-username', { timeout: 15000 });
    await page.fill('#auth-login-username', 'admin');
    await page.fill('#auth-login-password', 'Alfredo25');
    await page.click('.auth-signin-btn');
    await page.waitForSelector('.ps-card', { state: 'visible', timeout: 15000 });
    await page.$eval('.ps-card', el => el.click());
    await page.waitForSelector('.tile', { state: 'visible', timeout: 15000 });

    for (const t of TILES) {
      await page.$eval(`button.tile[data-section="${t.section}"]`, el => el.click());
      await page.waitForTimeout(900);
      const title = await page.$eval('#section-title', el => el.textContent).catch(() => '');
      const hasCreate = await page.$(t.createBtn).then(b => !!b);
      log(`[${t.section}] header="${title}" create=${hasCreate}`);

      // Click create → form
      if (hasCreate) {
        await page.$eval(t.createBtn, el => el.click());
        await page.waitForSelector(t.formSel, { timeout: 8000 }).catch(() => {});
        const formTitle = await page.$eval('#section-title', el => el.textContent).catch(() => '');
        const hasSave = await page.$(`.section-header-action[type="submit"]`).then(b => !!b);
        log(`  form header="${formTitle}" saveBtn=${hasSave}`);

        // Back out
        await page.$eval('#section-back', el => el.click());
        await page.waitForTimeout(600);
      }

      // Back to dashboard
      await page.$eval('#section-back', el => el.click()).catch(() => {});
      await page.waitForSelector('.tile-grid', { state: 'visible', timeout: 8000 }).catch(() => {});
    }

    const unique = [...new Set(errors)];
    log('Pageerrors:', unique.length);
    unique.slice(0, 10).forEach(e => log('  ERR: ' + e.substring(0, 160)));
    log(unique.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
  } catch (e) {
    log('TEST ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();

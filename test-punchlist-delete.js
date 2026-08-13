const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  let dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  const log = (...a) => console.log(...a);

  try {
    // SIGN IN
    await page.goto('http://localhost:3002/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#auth-login-username', { timeout: 15000 });
    await page.fill('#auth-login-username', 'admin');
    await page.fill('#auth-login-password', 'Alfredo25');
    await page.click('.auth-signin-btn');
    await page.waitForSelector('.ps-card', { state: 'visible', timeout: 15000 });
    await page.$eval('.ps-card', el => el.click());
    await page.waitForSelector('.tile', { state: 'visible', timeout: 15000 });
    log('Signed in + project selected.');

    // OPEN PUNCHLIST
    await page.$eval('button.tile[data-section="punchlist"]', el => el.click());
    await page.waitForSelector('.pl-wrap, .pl-empty', { timeout: 15000 });
    log('Punchlist opened.');

    // OPEN OR CREATE A LIST
    let listTile = await page.$('[data-pl-list]');
    if (listTile) {
      await page.$eval('[data-pl-list]', el => el.click());
      log('Opened existing list.');
    } else {
      await page.$eval('#section-header-action', el => el.click());
      await page.waitForSelector('#pl-list-name', { timeout: 10000 });
      await page.fill('#pl-list-name', 'HERMES-DELETE-TEST');
      await page.$eval('#pl-list-form-save', el => el.click());
      log('Created list (lands in list view).');
    }
    await page.waitForSelector('.pl-apt-nav, .pl-item-row, .pl-empty', { timeout: 15000 });

    // ENSURE AN ITEM EXISTS
    let item = await page.$('.pl-item-row');
    if (!item) {
      await page.$eval('#pl-new-item', el => el.click());
      await page.waitForSelector('#pl-item-title', { timeout: 10000 });
      await page.fill('#pl-item-title', 'HERMES-DELETE-TEST-ITEM');
      await page.$eval('#pl-item-form-save', el => el.click());
      await page.waitForSelector('.pl-item-row', { timeout: 15000 });
      log('Created item.');
    }

    // BOUNCE views 3x (would stack listeners pre-fix)
    for (let i = 0; i < 3; i++) {
      await page.$eval('#pl-lists-back', el => el.click());
      await page.waitForSelector('[data-pl-list]', { timeout: 10000 });
      await page.$eval('[data-pl-list]', el => el.click());
      await page.waitForSelector('.pl-item-row', { timeout: 10000 });
    }
    log('Bounced 3x.');

    // DELETE + COUNT DIALOGS
    dialogs = [];
    const before = (await page.$$('.pl-item-row')).length;
    await page.$eval('[data-pl-act="delete-item"]', el => el.click());
    await page.waitForTimeout(1500);
    const after = (await page.$$('.pl-item-row')).length;

    log(`Dialogs fired: ${dialogs.length}  ${JSON.stringify(dialogs)}`);
    log(`Items before=${before} after=${after}`);
    log(dialogs.length === 1 ? 'RESULT: PASS (exactly one confirm)' : `RESULT: FAIL (expected 1, got ${dialogs.length})`);

    const unique = [...new Set(errors)];
    log(`Pageerrors: ${unique.length}`);
    unique.slice(0, 8).forEach(e => log('  ERR: ' + e.substring(0, 160)));
  } catch (e) {
    log('TEST ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();

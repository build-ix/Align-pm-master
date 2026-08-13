const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
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

    // OPEN PUNCHLIST
    await page.$eval('button.tile[data-section="punchlist"]', el => el.click());
    await page.waitForSelector('.pl-wrap, .pl-empty', { timeout: 15000 });

    // OPEN OR CREATE LIST
    let listTile = await page.$('[data-pl-list]');
    if (listTile) {
      await page.$eval('[data-pl-list]', el => el.click());
    } else {
      await page.$eval('#section-header-action', el => el.click());
      await page.waitForSelector('#pl-list-name', { timeout: 10000 });
      await page.fill('#pl-list-name', 'HERMES-UPLOAD-TEST');
      await page.$eval('#pl-list-form-save', el => el.click());
    }
    await page.waitForSelector('#pl-new-item', { timeout: 15000 });

    // OPEN ITEM FORM
    await page.$eval('#pl-new-item', el => el.click());
    await page.waitForSelector('#pl-item-title', { timeout: 10000 });

    // ATTACH IMAGE + FILL TITLE
    await page.setInputFiles('#pl-file-input', '/tmp/pl-test-img.png');
    await page.waitForTimeout(800);
    const thumbCount = (await page.$$('.pl-image-thumb')).length;
    log('Preview thumbs after attach:', thumbCount);

    await page.fill('#pl-item-title', 'HERMES-UPLOAD-TEST-ITEM');

    // DOUBLE-CLICK SAVE (test double-submit guard)
    const saveBtn = await page.$('#pl-item-form-save');
    await saveBtn.click();
    await saveBtn.click().catch(() => {}); // second click may fail if disabled; ignore
    await page.waitForTimeout(2500);

    // Count items rendered
    const rows = await page.$$('.pl-item-row');
    log('Items after save:', rows.length);
    log('Dialogs during save:', JSON.stringify(dialogs));

    const unique = [...new Set(errors)];
    log('Pageerrors:', unique.length);
    unique.slice(0, 8).forEach(e => log('  ERR: ' + e.substring(0, 160)));

    log(rows.length === 1 ? 'RESULT: PASS (exactly one item saved)' : `RESULT: FAIL (expected 1 item, got ${rows.length})`);
  } catch (e) {
    log('TEST ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();

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
    // SIGN IN + SELECT PROJECT
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
      await page.fill('#pl-list-name', 'HERMES-DETAIL-TEST');
      await page.$eval('#pl-list-form-save', el => el.click());
    }
    await page.waitForSelector('#pl-new-item', { timeout: 15000 });

    // CREATE ITEM WITH ATTACHMENT
    await page.$eval('#pl-new-item', el => el.click());
    await page.waitForSelector('#pl-item-title', { timeout: 10000 });
    await page.setInputFiles('#pl-file-input', '/tmp/pl-test-img.png');
    await page.waitForTimeout(600);
    await page.fill('#pl-item-title', 'HERMES-DETAIL-TEST-ITEM');
    await page.$eval('#pl-item-form-save', el => el.click());
    await page.waitForSelector('.pl-item-row', { timeout: 15000 });
    log('Item saved.');

    // CLICK THE ITEM → DETAIL VIEW
    await page.$eval('.pl-item-row', el => el.click());
    await page.waitForSelector('.pl-detail-wrap', { timeout: 10000 });

    const detailThumbs = (await page.$$('.pl-detail-images .pl-image-thumb')).length;
    const fullLinks = (await page.$$('.pl-detail-images a')).length;
    log('Detail view attachment thumbs:', detailThumbs);
    log('Detail view full-image links:', fullLinks);

    const unique = [...new Set(errors)];
    log('Pageerrors:', unique.length);
    unique.slice(0, 8).forEach(e => log('  ERR: ' + e.substring(0, 160)));

    log(detailThumbs >= 1 ? 'RESULT: PASS (attachments render in detail view)' : 'RESULT: FAIL (no attachment thumbs)');
  } catch (e) {
    log('TEST ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();

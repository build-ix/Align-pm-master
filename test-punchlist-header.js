const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const log = (...a) => console.log(...a);
  const hdrTitle = () => page.$eval('#section-title', el => el.textContent);
  const hdrBack = () => page.$eval('#section-back', el => el.textContent.trim());
  const hdrActions = () => page.$$eval('.section-header-action', els => els.map(e => e.textContent));

  try {
    await page.goto('http://localhost:3002/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#auth-login-username', { timeout: 15000 });
    await page.fill('#auth-login-username', 'admin');
    await page.fill('#auth-login-password', 'Alfredo25');
    await page.click('.auth-signin-btn');
    await page.waitForSelector('.ps-card', { state: 'visible', timeout: 15000 });
    await page.$eval('.ps-card', el => el.click());
    await page.waitForSelector('.tile', { state: 'visible', timeout: 15000 });

    await page.$eval('button.tile[data-section="punchlist"]', el => el.click());
    await page.waitForSelector('.pl-wrap, .pl-empty', { timeout: 15000 });

    log('LISTS view — title:', await hdrTitle(), '| back:', JSON.stringify(await hdrBack()), '| actions:', JSON.stringify(await hdrActions()));

    // Create a list via the header button
    await page.$eval('#pl-create-list', el => el.click());
    await page.waitForSelector('#pl-list-name', { timeout: 10000 });
    log('LIST-FORM view — title:', await hdrTitle(), '| back:', JSON.stringify(await hdrBack()), '| actions:', JSON.stringify(await hdrActions()));

    await page.fill('#pl-list-name', 'HERMES-HDR-TEST');
    await page.$eval('#pl-save-list', el => el.click());
    await page.waitForSelector('.pl-items, .pl-empty', { timeout: 15000 });
    await page.waitForTimeout(300);
    log('LIST view — title:', await hdrTitle(), '| back:', JSON.stringify(await hdrBack()), '| actions:', JSON.stringify(await hdrActions()));

    // Add item via header button
    await page.$eval('#pl-add-item', el => el.click());
    await page.waitForSelector('#pl-item-title', { timeout: 10000 });
    log('ITEM-FORM view — title:', await hdrTitle(), '| back:', JSON.stringify(await hdrBack()), '| actions:', JSON.stringify(await hdrActions()));

    await page.fill('#pl-item-title', 'HERMES-HDR-ITEM');
    await page.$eval('#pl-save-item', el => el.click());
    await page.waitForSelector('.pl-item-row', { timeout: 15000 });
    log('LIST view (after item save) — title:', await hdrTitle(), '| actions:', JSON.stringify(await hdrActions()));

    // Open item detail
    await page.$eval('.pl-item-row', el => el.click());
    await page.waitForSelector('.pl-detail-wrap', { timeout: 10000 });
    log('DETAIL view — title:', await hdrTitle(), '| back:', JSON.stringify(await hdrBack()), '| actions:', JSON.stringify(await hdrActions()));

    // Back: detail -> list
    await page.$eval('#section-back', el => el.click());
    await page.waitForSelector('.pl-item-row', { timeout: 15000 });
    log('After back (detail->list) — title:', await hdrTitle(), '| back:', JSON.stringify(await hdrBack()));

    // Back: list -> lists
    await page.$eval('#section-back', el => el.click());
    await page.waitForSelector('.pl-apt-grid', { timeout: 15000 });
    log('After back (list->lists) — title:', await hdrTitle(), '| back:', JSON.stringify(await hdrBack()));

    // Back: lists -> exit (dashboard)
    await page.$eval('#section-back', el => el.click());
    await page.waitForSelector('.tile-grid', { state: 'visible', timeout: 10000 });
    log('After back (lists->dashboard) — exited to dashboard.');

    const unique = [...new Set(errors)];
    log('Pageerrors:', unique.length);
    unique.slice(0, 8).forEach(e => log('  ERR: ' + e.substring(0, 160)));

    log(unique.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL (page errors)');
  } catch (e) {
    log('TEST ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();

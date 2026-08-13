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

    await page.$eval('button.tile[data-section="rfis"]', el => el.click());
    await page.waitForSelector('.rf-wrap, .rf-empty', { timeout: 15000 });
    log('RFI list — title:', await hdrTitle(), '| actions:', JSON.stringify(await hdrActions()));

    // Create via header
    await page.$eval('#rf-new', el => el.click());
    await page.waitForSelector('#rf-subject', { timeout: 10000 });
    log('RFI form — title:', await hdrTitle(), '| actions:', JSON.stringify(await hdrActions()));

    await page.fill('#rf-subject', 'HERMES-RFI-TEST');
    await page.$eval('#rf-save', el => el.click());
    await page.waitForSelector('.rf-card', { timeout: 15000 });
    log('RFI list (after save) — title:', await hdrTitle(), '| actions:', JSON.stringify(await hdrActions()));

    // Open card -> edit form
    await page.$eval('.rf-card', el => el.click());
    await page.waitForSelector('#rf-subject', { timeout: 10000 });
    log('RFI edit form — title:', await hdrTitle(), '| actions:', JSON.stringify(await hdrActions()));

    // Back -> list
    await page.$eval('#section-back', el => el.click());
    await page.waitForSelector('.rf-card', { timeout: 15000 });
    log('RFI list (after back) — title:', await hdrTitle(), '| actions:', JSON.stringify(await hdrActions()));

    // Back -> dashboard
    await page.$eval('#section-back', el => el.click());
    await page.waitForSelector('.tile-grid', { state: 'visible', timeout: 10000 });
    log('Exited to dashboard.');

    const unique = [...new Set(errors)];
    log('Pageerrors:', unique.length);
    unique.slice(0, 8).forEach(e => log('  ERR: ' + e.substring(0, 160)));
    log(unique.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
  } catch (e) {
    log('TEST ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();

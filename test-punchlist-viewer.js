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

    let listTile = await page.$('[data-pl-list]');
    if (listTile) {
      await page.$eval('[data-pl-list]', el => el.click());
    } else {
      await page.$eval('#section-header-action', el => el.click());
      await page.waitForSelector('#pl-list-name', { timeout: 10000 });
      await page.fill('#pl-list-name', 'HERMES-VIEWER-TEST');
      await page.$eval('#pl-list-form-save', el => el.click());
    }
    await page.waitForSelector('#pl-new-item', { timeout: 15000 });

    // CREATE ITEM: description + 2 attachments
    await page.$eval('#pl-new-item', el => el.click());
    await page.waitForSelector('#pl-item-title', { timeout: 10000 });
    await page.setInputFiles('#pl-file-input', ['/tmp/pl-test-img.png', '/tmp/pl-test-img2.png']);
    await page.waitForTimeout(600);
    await page.fill('#pl-item-title', 'HERMES-VIEWER-TEST-ITEM');
    await page.fill('#pl-item-description', 'Crack in the drywall near the window');
    await page.$eval('#pl-item-form-save', el => el.click());
    await page.waitForSelector('.pl-item-row', { timeout: 15000 });
    log('Item saved with description + 2 attachments.');

    // OPEN DETAIL
    await page.$eval('.pl-item-row', el => el.click());
    await page.waitForSelector('.pl-detail-wrap', { timeout: 10000 });

    const descText = await page.$eval('.pl-detail-value', el => el.textContent).catch(() => '');
    const thumbs = (await page.$$('.pl-detail-images .pl-image-thumb')).length;
    log('Description shown:', JSON.stringify(descText));
    log('Detail thumbs:', thumbs);

    // OPEN VIEWER (click first thumbnail)
    await page.$eval('.pl-image-link[data-image-index="0"]', el => el.click());
    await page.waitForSelector('.pl-image-viewer.is-open', { state: 'visible', timeout: 5000 });
    const counter1 = await page.$eval('.pl-image-viewer__counter', el => el.textContent);
    log('Viewer open, counter:', counter1);

    // NEXT
    await page.$eval('[data-viewer-action="next"]', el => el.click());
    await page.waitForTimeout(400);
    const counter2 = await page.$eval('.pl-image-viewer__counter', el => el.textContent);
    log('After next, counter:', counter2);

    // PREV
    await page.$eval('[data-viewer-action="prev"]', el => el.click());
    await page.waitForTimeout(400);
    const counter3 = await page.$eval('.pl-image-viewer__counter', el => el.textContent);
    log('After prev, counter:', counter3);

    // CLOSE (X)
    await page.$eval('.pl-image-viewer__close', el => el.click());
    await page.waitForTimeout(400);
    const viewerHidden = await page.$eval('.pl-image-viewer', el => el.hidden).catch(() => true);
    log('Viewer hidden after close:', viewerHidden);

    const unique = [...new Set(errors)];
    log('Pageerrors:', unique.length);
    unique.slice(0, 8).forEach(e => log('  ERR: ' + e.substring(0, 160)));

    const pass = descText.includes('Crack') && thumbs === 2 && counter1 === '1 / 2' && counter2 === '2 / 2' && counter3 === '1 / 2' && viewerHidden === true;
    log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
  } catch (e) {
    log('TEST ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();

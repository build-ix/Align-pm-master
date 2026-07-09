const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') errors.push('[' + msg.type() + '] ' + msg.text()); });
  page.on('pageerror', err => errors.push('[pageerror] ' + err.message));

  // Sign in
  await page.goto('http://localhost:3002/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#auth-login-username', 'admin');
  await page.fill('#auth-login-password', 'Alfredo25');
  await page.click('.auth-signin-btn');
  await page.waitForTimeout(3000);

  // Select Test Project (second card)
  const cards = await page.$$('.ps-card');
  console.log(`Projects: ${cards.length}`);
  let pid = null;
  if (cards.length >= 2) {
    pid = await cards[1].getAttribute('data-pid');
    const name = await cards[1].$eval('.ps-card-name', el => el.textContent);
    console.log(`Selecting: ${name} (${pid})`);
    await page.evaluate((projectId) => {
      return new Promise((resolve) => {
        var switcher = window.AlignStorage.switchProject || window.AlignStorage.setActiveProject;
        var promise = switcher.call(window.AlignStorage, projectId);
        if (promise && promise.then) promise.then(resolve); else resolve();
      });
    }, pid);
    await page.evaluate(() => { location.hash = ''; });
    await page.waitForTimeout(1500);
  }

  // Open Drawings tile
  const tiles = await page.$$('.tile');
  for (const tile of tiles) {
    const label = await tile.$eval('.tile-label', el => el.textContent).catch(() => '');
    if (label === 'Drawings') { await tile.click(); break; }
  }
  await page.waitForTimeout(3000);

  const gridCountBefore = await page.$$eval('.dr-card', els => els.length).catch(() => 0);
  const loadMore = await page.$('#dr-load-more');
  console.log(`Grid cards visible before upload: ${gridCountBefore}, LoadMore present: ${!!loadMore}`);

  // Open Add Drawing modal
  await page.click('#dr-add-btn');
  await page.waitForTimeout(500);

  // Upload the multi-page PDF via the hidden file input
  const input = await page.$('#dr-file-input');
  if (!input) { console.log('FAIL: #dr-file-input not found'); await browser.close(); return; }
  await input.setInputFiles('/tmp/test-multipage.pdf');

  // Wait for split processing
  await page.waitForTimeout(6000);

  // Inspect the preview state
  const banner = await page.$('.dr-pdf-banner');
  console.log(`\n=== AUTO-SPLIT ===`);
  console.log(`PDF banner present: ${!!banner}`);
  if (banner) console.log(`Banner text: ${await banner.textContent()}`);

  const pageNames = await page.$$eval('.dr-preview-page .dr-preview-info strong', els => els.map(e => e.textContent));
  console.log(`\n=== SHEET DETECTION & SORTING (expect A-101, A-102, E-301, S-201) ===`);
  pageNames.forEach((n, i) => console.log(`  Page slot ${i + 1}: "${n}"`));

  // Thumbnails — naturalWidth 0 means broken image
  const thumbs = await page.$$eval('.dr-preview-page .dr-preview-thumb img', els =>
    els.map(e => ({ src: e.src.substring(0, 40), naturalWidth: e.naturalWidth, naturalHeight: e.naturalHeight })));
  console.log(`\n=== PREVIEW THUMBNAILS ===`);
  thumbs.forEach((t, i) => console.log(`  Thumb ${i + 1}: ${t.src}... ${t.naturalWidth}x${t.naturalHeight} ${t.naturalWidth === 0 ? '← BROKEN' : 'OK'}`));

  // Save
  const saveBtn = await page.$('#dr-save-btn');
  console.log(`\nSave button label: ${saveBtn ? await saveBtn.textContent() : 'MISSING'}`);
  if (saveBtn) {
    await saveBtn.click();
    await page.waitForTimeout(8000);
  }

  // Check the grid after save
  const uploadErr = await page.$eval('.dr-error', el => el.textContent).catch(() => null);
  if (uploadErr) console.log(`UPLOAD ERROR SHOWN: ${uploadErr}`);
  const modalStill = await page.$('.dr-modal-overlay');
  console.log(`Modal still open after save: ${!!modalStill}`);
  const namesAfter = await page.$$eval('.dr-card .dr-card-name', els => els.map(e => e.textContent));
  console.log(`\n=== GRID AFTER SAVE (${namesAfter.length} visible) ===`);
  namesAfter.slice(0, 25).forEach(n => console.log(`  ${n}`));

  console.log(`\n=== Console errors/warnings (${errors.length}) ===`);
  errors.slice(0, 25).forEach(e => console.log(`  ${e.substring(0, 200)}`));

  await browser.close();
})();

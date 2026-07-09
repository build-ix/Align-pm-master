const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  // Sign in
  await page.goto('http://localhost:3002/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#auth-login-username', 'admin');
  await page.fill('#auth-login-password', 'Alfredo25');
  await page.click('.auth-signin-btn');
  await page.waitForTimeout(3000);

  // Select second project (Test Project - has 46 files)
  const cards = await page.$$('.ps-card');
  console.log(`Projects: ${cards.length}`);
  if (cards.length >= 2) {
    const name = await cards[1].$eval('.ps-card-name', el => el.textContent);
    console.log(`Selecting: ${name}`);
    
    // Use switchProject and wait
    const pid = await cards[1].getAttribute('data-pid');
    console.log(`PID: ${pid}`);
    
    await page.evaluate((projectId) => {
      return new Promise((resolve) => {
        var switcher = window.AlignStorage.switchProject || window.AlignStorage.setActiveProject;
        var promise = switcher.call(window.AlignStorage, projectId);
        if (promise && promise.then) {
          promise.then(resolve);
        } else {
          resolve();
        }
      });
    }, pid);
    
    console.log('switchProject complete, navigating to dashboard');
    await page.evaluate(() => { location.hash = ''; });
    await page.waitForTimeout(2000);

    // Click drawings tile
    const tiles = await page.$$('.tile');
    console.log(`Tiles: ${tiles.length}`);
    for (const tile of tiles) {
      const label = await tile.$eval('.tile-label', el => el.textContent).catch(() => '');
      if (label === 'Drawings') {
        console.log('Clicking drawings...');
        await tile.click();
        break;
      }
    }
    
    // Wait for content
    await page.waitForTimeout(5000);
    
    // Check what's visible
    const sectionBody = await page.$('#section-body');
    if (sectionBody) {
      const html = await sectionBody.innerHTML();
      console.log(`Content length: ${html.length}`);
      console.log(`First 300 chars: ${html.substring(0, 300)}`);
    }
    
    // Check for the dr-wrap or empty state
    const drWrap = await page.$('.dr-wrap');
    const drEmpty = await page.$('.dr-empty');
    console.log(`dr-wrap: ${!!drWrap}, dr-empty: ${!!drEmpty}`);
  }

  console.log(`\n=== Errors (${errors.length}) ===`);
  errors.slice(0, 20).forEach(e => console.log(`  ${e.substring(0, 150)}`));

  await browser.close();
})();

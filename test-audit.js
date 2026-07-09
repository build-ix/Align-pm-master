const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', err => errors.push({ msg: err.message, url: page.url() }));

  // === SIGN IN ===
  await page.goto('https://alignprojects.net/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#auth-login-username', 'admin');
  await page.fill('#auth-login-password', 'Alfredo25');
  await page.click('.auth-signin-btn');
  await page.waitForTimeout(3000);

  // === TEST BOTH PROJECTS ===
  let projects = await page.$$('.ps-card');
  console.log(`Projects found: ${projects.length}`);

  for (let pi = 0; pi < projects.length; pi++) {
    // Re-query since DOM changes
    const cards = await page.$$('.ps-card');
    if (pi >= cards.length) break;
    
    const name = await cards[pi].$eval('.ps-card-name', el => el.textContent).catch(() => `Project ${pi+1}`);
    console.log(`\n=== PROJECT: ${name} ===`);
    await cards[pi].click();
    await page.waitForTimeout(2000);

    // Check dashboard elements
    const header = await page.$('.app-header');
    const tileGrid = await page.$('.tile-grid');
    const userBadge = await page.$('#user-badge-container');
    console.log(`Dashboard: header=${!!header} tiles=${!!tileGrid} badge=${!!userBadge}`);

    // Click every tile
    const tiles = await page.$$('.tile');
    console.log(`Testing ${tiles.length} tiles...`);
    
    for (let ti = 0; ti < tiles.length; ti++) {
      // Re-query tiles after navigation
      const currentTiles = await page.$$('.tile');
      if (ti >= currentTiles.length) break;
      
      const label = await currentTiles[ti].$eval('.tile-label', el => el.textContent).catch(() => '?');
      await currentTiles[ti].click();
      await page.waitForTimeout(1500);

      // Check if section page opened properly
      const sectionBody = await page.$('#section-body');
      const sectionTitle = await page.$('#section-title');
      const titleText = sectionTitle ? await sectionTitle.textContent() : '?';
     
      let content = sectionBody ? await sectionBody.innerHTML() : '';
      const hasContent = content.length > 80; // More than just empty wrapper
      const hasError = content.includes('Error') || content.includes('error');
      
      console.log(`  ${label}: content=${hasContent} title="${titleText}"${hasError ? ' ERROR' : ''}`);

      // Go back to dashboard
      const backBtn = await page.$('#section-back');
      if (backBtn) await backBtn.click();
      else await page.goBack();
      await page.waitForTimeout(500);
    }

    // Navigate back to project selection
    const picker = await page.$('#project-picker');
    if (picker) await picker.click();
    await page.waitForTimeout(2000);
  }

  console.log(`\n=== CONSOLE ERRORS (${errors.length}) ===`);
  const unique = [...new Set(errors.map(e => e.msg))];
  unique.slice(0, 20).forEach(e => console.log(`  ${e.substring(0, 150)}`));

  await browser.close();
})();

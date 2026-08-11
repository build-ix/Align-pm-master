// Playwright mobile reproduction test for Align bottom nav bugs
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3002';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  // Collect console messages
  const consoleMsgs = [];
  page.on('console', msg => {
    consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleMsgs.push(`[PAGE_ERROR] ${err.message}`);
  });

  console.log('=== Navigating to app ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Check if bottom nav is visible
  const navVisible = await page.evaluate(() => {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return 'bottom-nav element not found';
    const style = window.getComputedStyle(nav);
    return { display: style.display, visibility: style.visibility };
  });
  console.log('Bottom nav visibility:', JSON.stringify(navVisible));

  // Dismiss auth overlay if present (test environment may not be signed in)
  const authOverlay = await page.$('#align-auth-overlay');
  if (authOverlay) {
    const aoDisplay = await page.evaluate(() => {
      const ao = document.getElementById('align-auth-overlay');
      return ao ? window.getComputedStyle(ao).display + ' / z-index:' + window.getComputedStyle(ao).zIndex : 'gone';
    });
    console.log('Auth overlay:', aoDisplay);
    // Force close it so bottom nav clicks work
    await page.evaluate(() => {
      const ao = document.getElementById('align-auth-overlay');
      if (ao) ao.style.display = 'none';
      // Also add auth-ready class if needed
      document.body.classList.add('auth-ready');
    });
  }

  // Check what the hash router would do with each format
  console.log('\n=== Testing hash format ===');
  // Test hash format by examining location.hash behavior directly
  // First, navigate via tile grid click (uses #key format, known to work)
  // Then try #/key format manually
  const hashTest = await page.evaluate(() => {
    // Get all section keys by reading the _handleRoute source approach:
    // Check what location.hash looks like after a known-good tile click simulation
    // Also check if 'sections' is accessible via various means
    return { note: 'Will test via actual navigation below' };
  });
  console.log('Hash format test:', JSON.stringify(hashTest, null, 2));

  // Test 1: Click "Logs" tab in bottom nav (href="#/daily-logs")
  console.log('\n=== Test 1: Click Logs tab ===');
  const logsTab = page.locator('#bottom-nav [data-bn="logs"]');
  const logsTabCount = await logsTab.count();
  console.log('Logs tab found:', logsTabCount > 0);
  
  if (logsTabCount > 0) {
    const logsHref = await logsTab.getAttribute('href');
    console.log('Logs tab href:', logsHref);
    
    await logsTab.click();
    await page.waitForTimeout(1000);
    
    const hashAfterLogs = await page.evaluate(() => location.hash);
    console.log('Hash after clicking Logs:', hashAfterLogs || '(empty)');
    
    const sectionPageDisplay = await page.evaluate(() => {
      const sp = document.getElementById('section-page');
      return sp ? window.getComputedStyle(sp).display : 'not found';
    });
    console.log('Section page display:', sectionPageDisplay);
  }

  // Navigate back home
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1000);

  // Test 2: Click "All Tools" tab (JS handler sets #/all-tools)
  console.log('\n=== Test 2: Click All Tools tab ===');
  const allToolsTab = page.locator('#bottom-nav [data-bn="all-tools"]');
  const attCount = await allToolsTab.count();
  console.log('All Tools tab found:', attCount > 0);
  
  if (attCount > 0) {
    const attHref = await allToolsTab.getAttribute('href');
    console.log('All Tools tab href:', attHref);
    
    await allToolsTab.click();
    await page.waitForTimeout(1000);
    
    const hashAfterAT = await page.evaluate(() => location.hash);
    console.log('Hash after clicking All Tools:', hashAfterAT || '(empty)');
    
    const sectionPageDisplay = await page.evaluate(() => {
      const sp = document.getElementById('section-page');
      return sp ? window.getComputedStyle(sp).display : 'not found';
    });
    console.log('Section page display:', sectionPageDisplay);
    
    const sectionTitle = await page.evaluate(() => {
      const st = document.getElementById('section-title');
      return st ? st.textContent : 'not found';
    });
    console.log('Section title:', sectionTitle);
  }

  // Navigate back home
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1000);

  // Test 3: Click FAB to open Quick Add sheet, then click an option
  console.log('\n=== Test 3: Quick Add sheet ===');
  const fab = page.locator('#bn-add');
  const fabCount = await fab.count();
  console.log('FAB found:', fabCount > 0);
  
  if (fabCount > 0) {
    // Check sheet initial state
    const sheetInitial = await page.evaluate(() => {
      const sheet = document.getElementById('bn-sheet');
      const overlay = document.getElementById('bn-sheet-overlay');
      return {
        sheetTransform: sheet ? window.getComputedStyle(sheet).transform : 'not found',
        overlayDisplay: overlay ? window.getComputedStyle(overlay).display : 'not found',
      };
    });
    console.log('Sheet initial state:', JSON.stringify(sheetInitial));
    
    await fab.click();
    await page.waitForTimeout(500);
    
    const sheetAfter = await page.evaluate(() => {
      const sheet = document.getElementById('bn-sheet');
      const overlay = document.getElementById('bn-sheet-overlay');
      return {
        sheetTransform: sheet ? window.getComputedStyle(sheet).transform : 'not found',
        overlayDisplay: overlay ? window.getComputedStyle(overlay).display : 'not found',
        sheetClasses: sheet ? sheet.className : 'not found',
        overlayClasses: overlay ? overlay.className : 'not found',
      };
    });
    console.log('Sheet after FAB click:', JSON.stringify(sheetAfter));
    
    // Click "Daily Log" sheet item
    const dailyLogItem = page.locator('[data-bn-action="daily-log"]');
    const dliCount = await dailyLogItem.count();
    console.log('Daily Log sheet item found:', dliCount > 0);
    
    if (dliCount > 0) {
      await dailyLogItem.click();
      await page.waitForTimeout(1000);
      
      const hashAfterSheet = await page.evaluate(() => location.hash);
      console.log('Hash after clicking Daily Log in sheet:', hashAfterSheet || '(empty)');
      
      const sectionPageDisplay = await page.evaluate(() => {
        const sp = document.getElementById('section-page');
        return sp ? window.getComputedStyle(sp).display : 'not found';
      });
      console.log('Section page display:', sectionPageDisplay);
    }
  }

  // Test 4: For comparison, click a tile from the main grid (should work)
  console.log('\n=== Test 4: Click a tile from grid (control test) ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1000);
  
  const tiles = page.locator('.tile');
  const tileCount = await tiles.count();
  console.log('Tiles found:', tileCount);
  
  if (tileCount > 0) {
    const firstTileSection = await tiles.first().getAttribute('data-section');
    console.log('First tile data-section:', firstTileSection);
    
    await tiles.first().click();
    await page.waitForTimeout(1000);
    
    const hashAfterTile = await page.evaluate(() => location.hash);
    console.log('Hash after clicking tile:', hashAfterTile || '(empty)');
    
    const sectionPageDisplay = await page.evaluate(() => {
      const sp = document.getElementById('section-page');
      return sp ? window.getComputedStyle(sp).display : 'not found';
    });
    console.log('Section page display:', sectionPageDisplay);
  }

  // Test 5: Direct route test — set hash manually and observe
  console.log('\n=== Test 5: Direct hash navigation test ===');
  
  // Reset to home
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1000);
  
  // Navigate using #/daily-logs (bottom nav format)
  await page.evaluate(() => { location.hash = '#/daily-logs'; });
  await page.waitForTimeout(1000);
  let hash1 = await page.evaluate(() => location.hash);
  let spDisplay1 = await page.evaluate(() => {
    const sp = document.getElementById('section-page');
    return sp ? window.getComputedStyle(sp).display : 'not found';
  });
  let st1 = await page.evaluate(() => {
    const st = document.getElementById('section-title');
    return st ? st.textContent : 'not found';
  });
  console.log(`#/daily-logs → hash="${hash1}", section-page:${spDisplay1}, title:"${st1}"`);
  
  // Navigate using #daily-logs (tile grid format)
  await page.evaluate(() => { location.hash = '#daily-logs'; });
  await page.waitForTimeout(1000);
  let hash2 = await page.evaluate(() => location.hash);
  let spDisplay2 = await page.evaluate(() => {
    const sp = document.getElementById('section-page');
    return sp ? window.getComputedStyle(sp).display : 'not found';
  });
  let st2 = await page.evaluate(() => {
    const st = document.getElementById('section-title');
    return st ? st.textContent : 'not found';
  });
  console.log(`#daily-logs  → hash="${hash2}", section-page:${spDisplay2}, title:"${st2}"`);

  // Print console messages
  console.log('\n=== Browser Console (last 30) ===');
  const recent = consoleMsgs.slice(-30);
  recent.forEach(m => console.log(m));

  await browser.close();
  console.log('\n=== Done ===');
})();

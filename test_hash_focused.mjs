// Focused test: Prove hash format mismatch in Align bottom nav
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3002';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  // Collect console/errors
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('[CONSOLE_ERROR] ' + msg.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Hide auth overlay
  await page.evaluate(() => {
    const ao = document.getElementById('align-auth-overlay');
    if (ao) ao.style.display = 'none';
    document.body.classList.add('auth-ready');
    // Show tile grid and header (may be hidden behind auth)
    const tg = document.querySelector('.tile-grid');
    const ah = document.querySelector('.app-header');
    if (tg) tg.style.display = '';
    if (ah) ah.style.display = '';
  });
  await page.waitForTimeout(500);

  // ====== THE KEY TEST ======
  console.log('=== Hash Format Test ===');
  console.log('');

  // Test A: Set hash to #/daily-logs (bottom nav format)
  console.log('Test A: Setting location.hash = "#/daily-logs" (bottom nav format)');
  await page.evaluate(() => { location.hash = '#/daily-logs'; });
  await page.waitForTimeout(500);
  let resultA = await page.evaluate(() => ({
    hash: location.hash,
    sectionPageDisplay: window.getComputedStyle(document.getElementById('section-page')).display,
    sectionTitle: document.getElementById('section-title').textContent,
    sectionBodyHTML: document.getElementById('section-body').innerHTML.substring(0, 100),
  }));
  console.log(JSON.stringify(resultA, null, 2));
  console.log('');

  // Navigate home
  await page.evaluate(() => { location.hash = ''; });
  await page.waitForTimeout(500);

  // Test B: Set hash to #daily-logs (tile grid format — the correct one)
  console.log('Test B: Setting location.hash = "#daily-logs" (tile grid format)');
  await page.evaluate(() => { location.hash = '#daily-logs'; });
  await page.waitForTimeout(500);
  let resultB = await page.evaluate(() => ({
    hash: location.hash,
    sectionPageDisplay: window.getComputedStyle(document.getElementById('section-page')).display,
    sectionTitle: document.getElementById('section-title').textContent,
    sectionBodyHTML: document.getElementById('section-body').innerHTML.substring(0, 100),
  }));
  console.log(JSON.stringify(resultB, null, 2));
  console.log('');

  // Navigate home
  await page.evaluate(() => { location.hash = ''; });
  await page.waitForTimeout(500);

  // Test C: Set hash to #/all-tools (bottom nav format for All Tools)
  console.log('Test C: Setting location.hash = "#/all-tools" (All Tools tab format)');
  await page.evaluate(() => { location.hash = '#/all-tools'; });
  await page.waitForTimeout(500);
  let resultC = await page.evaluate(() => ({
    hash: location.hash,
    sectionPageDisplay: window.getComputedStyle(document.getElementById('section-page')).display,
    sectionTitle: document.getElementById('section-title').textContent,
    sectionBodyHTML: document.getElementById('section-body').innerHTML.substring(0, 100),
  }));
  console.log(JSON.stringify(resultC, null, 2));
  console.log('');

  // Test D: Simulate what _handleRoute actually does
  console.log('=== Simulating _handleRoute logic ===');
  await page.evaluate(() => {
    const testHashes = ['#/daily-logs', '#daily-logs', '#/all-tools', '#/home'];
    testHashes.forEach(h => {
      const hash = h.replace(/^#/, '') || '';
      const parts = hash.split('/');
      const sectionKey = parts[0] || null;
      console.log(`Hash "${h}" → stripped="${hash}" → parts[0]="${sectionKey}" → sectionKey=${sectionKey || 'null (HOME)'}`);
    });
  });
  await page.waitForTimeout(500);

  // Print console
  console.log('\n=== Browser console ===');
  const recentErrors = errors.slice(-20);
  recentErrors.forEach(e => console.log(e));
  if (recentErrors.length === 0) console.log('(no errors)');

  await browser.close();
  console.log('\n=== Diagnosis complete ===');
})();

import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3002';
const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(MOBILE);
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#bottom-nav', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(1000);

  // Hide auth
  await page.evaluate(() => {
    const overlay = document.getElementById('auth-overlay') || document.getElementById('align-auth-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.add('auth-ready');
    }
  });

  await page.waitForFunction(() => {
    const nav = document.getElementById('bottom-nav');
    return nav && getComputedStyle(nav).display !== 'none';
  }, null, { timeout: 5000 });

  // Open the sheet AND immediately measure — same timing as test
  const fab = page.locator('#bn-add');
  await fab.tap();

  // Wait for .open — this is exactly what the test does
  await page.waitForFunction(() => document.getElementById('bn-sheet')?.classList.contains('open'), null, { timeout: 3000 });

  // IMMEDIATELY measure — replicating assertCenterHit timing
  const immediate = await page.evaluate(() => {
    const sheet = document.getElementById('bn-sheet');
    const firstBtn = sheet.querySelector('.bn-sheet-item');
    const rect = firstBtn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const resolved = document.elementFromPoint(centerX, centerY);
    return {
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom },
      center: { x: centerX, y: centerY },
      elementFromPoint: resolved ? { tag: resolved.tagName, cls: resolved.className?.substring?.(0,30) } : null,
      resolvesToSelfOrDescendant: resolved ? (resolved === firstBtn || firstBtn.contains(resolved)) : false,
      sheetTransform: getComputedStyle(sheet).transform,
      sheetTop: sheet.getBoundingClientRect().top,
      performanceNow: performance.now()
    };
  });
  console.log('=== IMMEDIATE (t~0) ===');
  console.log(JSON.stringify(immediate, null, 2));

  // Wait 300ms (transition is 250ms)
  await page.waitForTimeout(300);

  const afterTransition = await page.evaluate(() => {
    const sheet = document.getElementById('bn-sheet');
    const firstBtn = sheet.querySelector('.bn-sheet-item');
    const rect = firstBtn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const resolved = document.elementFromPoint(centerX, centerY);
    return {
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom },
      center: { x: centerX, y: centerY },
      elementFromPoint: resolved ? { tag: resolved.tagName, cls: resolved.className?.substring?.(0,30) } : null,
      resolvesToSelfOrDescendant: resolved ? (resolved === firstBtn || firstBtn.contains(resolved)) : false,
      sheetTransform: getComputedStyle(sheet).transform,
      sheetTop: sheet.getBoundingClientRect().top,
      performanceNow: performance.now()
    };
  });
  console.log('=== AFTER 300ms ===');
  console.log(JSON.stringify(afterTransition, null, 2));

  await browser.close();
})();

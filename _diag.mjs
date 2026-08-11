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

  // Navigate
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#bottom-nav', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(1000);

  // Hide auth overlay
  const authSetup = await page.evaluate(() => {
    const overlay = document.getElementById('auth-overlay') || document.getElementById('align-auth-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.add('auth-ready');
      return 'auth overlay hidden';
    }
    return 'no auth overlay';
  });
  console.log(`AUTH: ${authSetup}`);

  // ===== DIAGNOSTIC 1: Browser context + viewport =====
  const env = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    devicePixelRatio: window.devicePixelRatio,
    visualViewport: window.visualViewport ? {
      width: window.visualViewport.width,
      height: window.visualViewport.height,
      offsetTop: window.visualViewport.offsetTop,
      offsetLeft: window.visualViewport.offsetLeft,
      scale: window.visualViewport.scale
    } : null,
    metaViewport: (() => {
      const m = document.querySelector('meta[name="viewport"]');
      return m ? m.getAttribute('content') : null;
    })() || 'none',
    screenWidth: screen.width,
    screenHeight: screen.height,
    navigatorMaxTouchPoints: navigator.maxTouchPoints,
    ontouchstart: 'ontouchstart' in window
  }));
  console.log('=== ENVIRONMENT ===');
  console.log(JSON.stringify(env, null, 2));

  // ===== DIAGNOSTIC 2: HTML/BODY dimensions =====
  const rootDims = await page.evaluate(() => ({
    html: {
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      offsetWidth: document.documentElement.offsetWidth,
      offsetHeight: document.documentElement.offsetHeight,
      scrollTop: document.documentElement.scrollTop,
      scrollLeft: document.documentElement.scrollLeft
    },
    body: {
      clientWidth: document.body.clientWidth,
      clientHeight: document.body.clientHeight,
      scrollWidth: document.body.scrollWidth,
      scrollHeight: document.body.scrollHeight,
      offsetWidth: document.body.offsetWidth,
      offsetHeight: document.body.offsetHeight,
      scrollTop: document.body.scrollTop,
      scrollLeft: document.body.scrollLeft
    }
  }));
  console.log('=== ROOT DIMS ===');
  console.log(JSON.stringify(rootDims, null, 2));

  // ===== DIAGNOSTIC 3: Bottom nav =====
  const bottomNavInfo = await page.evaluate(() => {
    const el = document.getElementById('bottom-nav');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom },
      position: style.position,
      bottom: style.bottom,
      transform: style.transform,
      zIndex: style.zIndex,
      display: style.display,
      contain: style.contain
    };
  });
  console.log('=== BOTTOM NAV ===');
  console.log(JSON.stringify(bottomNavInfo, null, 2));

  // ===== DIAGNOSTIC 4: Open the sheet =====
  const fab = page.locator('#bn-add');
  const fabCount = await fab.count();
  console.log(`Fab count: ${fabCount}`);

  // Get fab info before opening
  const fabInfo = await page.evaluate(() => {
    const el = document.getElementById('bn-add');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom } };
  });
  console.log('=== FAB (before open) ===');
  console.log(JSON.stringify(fabInfo, null, 2));

  // Open the sheet
  await fab.tap();
  await page.waitForFunction(() => document.getElementById('bn-sheet')?.classList.contains('open'), null, { timeout: 3000 });
  await page.waitForTimeout(500);

  // ===== DIAGNOSTIC 5: Sheet details =====
  const sheetInfo = await page.evaluate(() => {
    const el = document.getElementById('bn-sheet');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right },
      position: style.position,
      bottom: style.bottom,
      left: style.left,
      right: style.right,
      transform: style.transform,
      transformOrigin: style.transformOrigin,
      zIndex: style.zIndex,
      display: style.display,
      overflow: style.overflow,
      contain: style.contain,
      padding: style.padding,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      hasOpenClass: el.classList.contains('open'),
      scrollHeight: el.scrollHeight,
      offsetHeight: el.offsetHeight,
      clientHeight: el.clientHeight
    };
  });
  console.log('=== #BN-SHEET ===');
  console.log(JSON.stringify(sheetInfo, null, 2));

  // ===== DIAGNOSTIC 6: Overlay =====
  const overlayInfo = await page.evaluate(() => {
    const el = document.getElementById('bn-sheet-overlay');
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      display: style.display,
      opacity: style.opacity,
      hasOpenClass: el.classList.contains('open'),
      zIndex: style.zIndex
    };
  });
  console.log('=== OVERLAY ===');
  console.log(JSON.stringify(overlayInfo, null, 2));

  // ===== DIAGNOSTIC 7: Grid and items =====
  const gridInfo = await page.evaluate(() => {
    const grid = document.querySelector('.bn-sheet-grid');
    if (!grid) return null;
    const gridRect = grid.getBoundingClientRect();
    const gridStyle = getComputedStyle(grid);
    const items = grid.querySelectorAll('.bn-sheet-item');
    const itemData = [];
    items.forEach((item, i) => {
      const r = item.getBoundingClientRect();
      const s = getComputedStyle(item);
      const centerX = r.left + r.width / 2;
      const centerY = r.top + r.height / 2;
      const resolved = document.elementFromPoint(centerX, centerY);
      itemData.push({
        index: i,
        dataAction: item.getAttribute('data-bn-action'),
        text: item.textContent.trim().substring(0, 20),
        rect: { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom },
        center: { x: centerX, y: centerY },
        elementFromPoint: resolved ? {
          tag: resolved.tagName,
          id: resolved.id,
          cls: resolved.className && typeof resolved.className === 'string' ? resolved.className.substring(0, 40) : ''
        } : null,
        resolvesToSelfOrDescendant: resolved ? (resolved === item || item.contains(resolved)) : false,
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
      });
    });
    return {
      gridRect: { top: gridRect.top, left: gridRect.left, width: gridRect.width, height: gridRect.height, bottom: gridRect.bottom },
      gridDisplay: gridStyle.display,
      gridTemplateColumns: gridStyle.gridTemplateColumns,
      gap: gridStyle.gap,
      items: itemData,
      totalItems: items.length
    };
  });
  console.log('=== GRID + ITEMS ===');
  console.log(JSON.stringify(gridInfo, null, 2));

  // ===== DIAGNOSTIC 8: Header =====
  const headerInfo = await page.evaluate(() => {
    const header = document.querySelector('.bn-sheet-header');
    if (!header) return null;
    const rect = header.getBoundingClientRect();
    const style = getComputedStyle(header);
    return {
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom },
      marginBottom: style.marginBottom,
      display: style.display,
      justifyContent: style.justifyContent
    };
  });
  console.log('=== HEADER ===');
  console.log(JSON.stringify(headerInfo, null, 2));

  // ===== DIAGNOSTIC 9: All matching CSS rules for #bn-sheet =====
  const sheetCSS = await page.evaluate(() => {
    const el = document.getElementById('bn-sheet');
    if (!el) return [];
    const rules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText && (
            rule.selectorText.includes('#bn-sheet') || 
            rule.selectorText.includes('.bn-sheet')
          )) {
            rules.push({
              selector: rule.selectorText,
              cssText: rule.style.cssText
            });
          }
        }
      } catch (e) {}
    }
    return rules;
  });
  console.log('=== MATCHING CSS RULES ===');
  console.log(JSON.stringify(sheetCSS, null, 2));

  // ===== DIAGNOSTIC 10: Check for any ancestor transform/contain =====
  const ancestors = await page.evaluate(() => {
    const el = document.getElementById('bn-sheet');
    if (!el) return [];
    const chain = [];
    let current = el.parentElement;
    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current);
      chain.push({
        tag: current.tagName,
        id: current.id,
        cls: current.className && typeof current.className === 'string' ? current.className.substring(0, 40) : '',
        position: style.position,
        transform: style.transform !== 'none' ? style.transform : 'none',
        contain: style.contain !== 'none' ? style.contain : 'none',
        overflow: style.overflow,
        zIndex: style.zIndex,
        display: style.display
      });
      current = current.parentElement;
    }
    return chain;
  });
  console.log('=== ANCESTOR CHAIN ===');
  console.log(JSON.stringify(ancestors, null, 2));

  // ===== DIAGNOSTIC 11: All .bn-sheet-item CSS rules =====
  const itemCSS = await page.evaluate(() => {
    const rules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText && rule.selectorText.includes('bn-sheet-item')) {
            rules.push({
              selector: rule.selectorText,
              cssText: rule.style.cssText
            });
          }
        }
      } catch (e) {}
    }
    return rules;
  });
  console.log('=== ITEM CSS RULES ===');
  console.log(JSON.stringify(itemCSS, null, 2));

  await browser.close();
})();

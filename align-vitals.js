/* align-vitals.js — Core Web Vitals Reporter
 * ─────────────────────────────────────────────────────────────────────────────
 * Measures LCP, CLS, and INP and reports to the server error log for analysis.
 * Load after the error monitoring hook (index.html head) to share the same
 * /api/errors/report endpoint.
 *
 * Thresholds: LCP < 2.5s (good), CLS < 0.1 (good), INP < 200ms (good)
 */

(function () {
  'use strict';

  // Only run in production (not on localhost dev)
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  var reported = {};

  function reportVital(name, value, rating) {
    var key = name + ':' + rating;
    // Only report once per page load per metric+rating combination
    if (reported[key]) return;
    reported[key] = true;

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/errors/report', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({
        message: '[Web Vital] ' + name + ': ' + Math.round(value) + ' (' + rating + ')',
        url: location.pathname,
        userAgent: 'vitals-reporter',
        timestamp: new Date().toISOString()
      }));
    } catch (e) {}
  }

  // ── LCP (Largest Contentful Paint) ───────────────────────────────────
  try {
    new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      if (entries.length === 0) return;
      var lastEntry = entries[entries.length - 1];
      var lcp = lastEntry.renderTime || lastEntry.loadTime;
      var rating = lcp <= 2500 ? 'good' : lcp <= 4000 ? 'needs-improvement' : 'poor';
      reportVital('LCP', lcp, rating);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}

  // ── CLS (Cumulative Layout Shift) ────────────────────────────────────
  try {
    var clsValue = 0;
    new PerformanceObserver(function (list) {
      for (var entry of list.getEntries()) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
      var rating = clsValue <= 0.1 ? 'good' : clsValue <= 0.25 ? 'needs-improvement' : 'poor';
      reportVital('CLS', clsValue, rating);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}

  // ── INP (Interaction to Next Paint) ──────────────────────────────────
  try {
    new PerformanceObserver(function (list) {
      for (var entry of list.getEntries()) {
        var inp = entry.duration;
        var rating = inp <= 200 ? 'good' : inp <= 500 ? 'needs-improvement' : 'poor';
        reportVital('INP', inp, rating);
      }
    }).observe({ type: 'first-input', buffered: true });
  } catch (e) {}

  console.log('[Vitals] Web Vitals reporter active — LCP/CLS/INP → /api/errors/report');
})();

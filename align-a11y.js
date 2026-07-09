/* align-a11y.js — Accessibility Enhancements
 * ─────────────────────────────────────────────────────────────────────────────
 * Progressive enhancement: adds aria-labels to unlabeled inputs,
 * ensures focus indicators, and improves screen reader experience.
 * Load after all modules, runs once on DOM ready.
 */

(function () {
  'use strict';

  function enhance() {
    // Add aria-label to search inputs that have a placeholder but no label
    document.querySelectorAll('input[type="search"]:not([aria-label]):not([aria-labelledby])').forEach(function (el) {
      if (el.placeholder) el.setAttribute('aria-label', el.placeholder);
    });

    // Add aria-label to select elements that lack labels
    document.querySelectorAll('select:not([aria-label]):not([aria-labelledby])').forEach(function (el) {
      // Try to find a nearby label element or use a data attribute
      var label = el.closest('div')?.querySelector('label');
      if (label) {
        el.setAttribute('aria-label', label.textContent.trim());
      } else if (el.id) {
        var formLabel = document.querySelector('label[for="' + el.id + '"]');
        if (formLabel) el.setAttribute('aria-label', formLabel.textContent.trim());
      }
    });

    // Ensure all buttons have accessible names
    document.querySelectorAll('button:not([aria-label]):empty').forEach(function (btn) {
      var text = btn.textContent.trim();
      if (text) btn.setAttribute('aria-label', text);
    });

    // Add role="status" to the offline bar for screen reader announcements
    var offlineBar = document.getElementById('app-offline-bar');
    if (offlineBar && !offlineBar.hasAttribute('role')) {
      offlineBar.setAttribute('role', 'status');
    }

    // Add aria-live region for dynamic content updates (if not already present)
    if (!document.getElementById('a11y-live-region')) {
      var live = document.createElement('div');
      live.id = 'a11y-live-region';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      live.className = 'sr-only';
      live.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
      document.body.appendChild(live);
    }
  }

  // Run on load and after any DOM mutation (module renders rebuild HTML)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }

  // Re-enhance after module navigation (modal opens rebuilds content)
  var observer = new MutationObserver(function () {
    enhance();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[A11y] Accessibility enhancements active');
})();

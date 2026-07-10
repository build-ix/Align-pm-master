/* offline.js — Align PM offline detection banner
 * Shows when network drops, hides when back online.
 */

(function () {
  'use strict';

  var _banner = null;

  function init() {
    _banner = document.createElement('div');
    _banner.id = 'offline-banner';
    _banner.className = 'offline-banner';
    _banner.textContent = 'No connection — showing saved data';
    _banner.style.display = navigator.onLine ? 'none' : 'block';
    document.body.insertBefore(_banner, document.body.firstChild);

    window.addEventListener('online', function () {
      if (_banner) _banner.style.display = 'none';
    });
    window.addEventListener('offline', function () {
      if (_banner) _banner.style.display = 'block';
    });
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

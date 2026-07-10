/* lazyLoad.js — lazy image loading via IntersectionObserver
 * Add class="lazy-img" and data-src="url" to any <img> element.
 * Observer loads images when they scroll into view.
 */

(function () {
  'use strict';

  if (!('IntersectionObserver' in window)) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var img = entry.target;
      var src = img.getAttribute('data-src');
      if (src) {
        img.src = src;
        img.removeAttribute('data-src');
      }
      observer.unobserve(img);
    });
  }, { rootMargin: '200px' });

  // Watch all existing .lazy-img elements
  function watch() {
    document.querySelectorAll('.lazy-img').forEach(function (img) {
      observer.observe(img);
    });
  }

  // Watch new elements added to DOM
  if (window.MutationObserver && document.body) {
    var mo = new MutationObserver(function () { watch(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }
})();

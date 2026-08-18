/* Align PM — shared skeleton loader (ES5) */
(function () {
  'use strict';

  // Returns skeleton HTML: n card-shaped blocks, each with two lines.
  function skeletonHTML(n) {
    var count = n || 3;
    var html = '<div class="sk" aria-hidden="true">';
    for (var i = 0; i < count; i++) {
      html += '<div class="sk-block">' +
                '<div style="padding:14px 16px;">' +
                  '<div class="sk-line sk-line--w60"></div>' +
                  '<div class="sk-line sk-line--w40"></div>' +
                '</div>' +
              '</div>';
    }
    html += '</div>';
    return html;
  }

  // Renders skeleton into a container element or selector.
  function showSkeleton(target, n) {
    var el = (typeof target === 'string') ? document.querySelector(target) : target;
    if (el) { el.innerHTML = skeletonHTML(n); }
    return el;
  }

  window.AlignSkeleton = {
    html: skeletonHTML,
    show: showSkeleton
  };
})();

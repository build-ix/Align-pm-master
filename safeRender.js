/* safeRender.js — Align PM error isolation for tile rendering
 * Every tile is wrapped in try/catch. Async errors via AlignX.tileError.
 * Failed tiles show error card — never crash the app.
 */

(function () {
  'use strict';

  /* HTML-escape utility */
  window._esc = function (s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };

  /* Render error card into a tile element */
  window.tileError = function (tileEl, tileId, err) {
    console.error('[tile:' + tileId + ']', err);
    // Log to server if API available
    if (window.Api && window.Api.post) {
      try {
        window.Api.post('/api/client-errors', {
          scope: 'tile',
          tile: tileId,
          message: String(err && err.message || err),
          stack: err && err.stack ? String(err.stack).slice(0, 2000) : ''
        });
      } catch (_) {}
    }
    if (!tileEl) return;
    tileEl.classList.add('tile-error');
    tileEl.innerHTML =
      '<div class="tile-error-inner">' +
        '<div class="tile-error-title">Something went wrong</div>' +
        '<div class="tile-error-sub">This section encountered an error. The rest of the app is fine.</div>' +
        '<button class="tile-retry-btn" data-retry="' + window._esc(tileId) + '">Retry</button>' +
      '</div>';
  };

  /* Safe tile render — wraps def.render() in try/catch */
  window.safeRenderTile = function (def, containerEl, ctx) {
    var tileEl = document.createElement('div');
    tileEl.className = 'tile';
    tileEl.setAttribute('data-tile', def.id);
    containerEl.appendChild(tileEl);
    try {
      def.render(tileEl, ctx || {});
    } catch (err) {
      window.tileError(tileEl, def.id, err);
    }
  };

  /* Global retry handler — delegated, survives re-renders */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-retry]');
    if (!btn) return;
    var id = btn.getAttribute('data-retry');
    var def = window.TileRegistry && window.TileRegistry.get(id);
    var tileEl = btn.closest('.tile');
    if (def && tileEl) {
      tileEl.classList.remove('tile-error');
      tileEl.innerHTML = '';
      try { def.render(tileEl, {}); }
      catch (err) { window.tileError(tileEl, id, err); }
    }
  });
})();

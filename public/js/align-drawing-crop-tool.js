/*
 * align-drawing-crop-tool.js
 * Polygon crop tool for punchlist per-list pin-location maps.
 *
 * Self-contained state machine. The drawings viewer owns pointer routing
 * (it delegates single-finger/mouse events to this tool in crop mode) and
 * supplies a screen→normalized adapter. Vertices are stored NORMALIZED 0-1
 * relative to the full drawing sheet — the same space as punch pins.
 *
 * The draft SVG lives INSIDE the scaled viewer stage so lines + fill follow
 * the drawing. Point markers/labels are inverse-scaled each render so they
 * stay a fixed ~12px on screen at any zoom. A rAF-coalesced refresh() is
 * subscribed to the viewer's transform changes (onTransformChanged) so
 * markers re-size correctly while the user pinch-zooms and pans.
 *
 * Exposes: window.DrawingCropTool = { create }
 */
(function (global) {
  'use strict';

  var MIN_POINTS = 4;      // minimum vertices before a polygon can close
  var HANDLE_RADIUS_PX = 12;   // fixed screen radius of point handles
  var LABEL_SIZE_PX = 13;      // fixed screen font size of number labels

  function create(adapter) {
    if (!adapter || !adapter.overlayHost || !adapter.screenToNormalized) {
      console.warn('[CropTool] Missing adapter');
      return null;
    }
    if (typeof adapter.getCanvas !== 'function' && !adapter.canvas) {
      console.warn('[CropTool] Missing canvas (getCanvas or canvas required)');
      return null;
    }

    var state = {
      phase: 'first',       // 'first' | 'second' | 'extend' | 'saving'
      committed: [],        // [{x,y}] normalized, in order
      candidate: null,      // {x,y} normalized (not yet committed)
      pointerId: null,
      lastClient: null,
      svg: null,
      controls: null,
      destroyed: false
    };

    var refreshRaf = 0;
    var unsubscribeTransform = null;

    function _getCanvas() {
      return typeof adapter.getCanvas === 'function' ? adapter.getCanvas() : adapter.canvas;
    }

    var canvas = _getCanvas();
    var W = (canvas && canvas.width) || 1;
    var H = (canvas && canvas.height) || 1;

    // ── Draft SVG overlay (inside the scaled stage) ──────────────────────────
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'crop-draft-svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = W + 'px';
    svg.style.height = H + 'px';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '90';
    svg.setAttribute('data-crop-draft', '1');
    adapter.overlayHost.style.position = adapter.overlayHost.style.position || 'relative';
    adapter.overlayHost.appendChild(svg);
    state.svg = svg;

    // ── Control bar ──────────────────────────────────────────────────────────
    var controls = document.createElement('div');
    controls.className = 'crop-controls';
    controls.innerHTML =
      '<button type="button" class="crop-btn crop-cancel" data-act="cancel">Cancel</button>' +
      '<span class="crop-hint" data-hint></span>' +
      '<button type="button" class="crop-btn crop-undo" data-act="undo" disabled>Undo</button>' +
      '<button type="button" class="crop-btn crop-primary" data-act="primary" disabled>Start</button>' +
      '<button type="button" class="crop-btn crop-add" data-act="add" style="display:none" disabled>Add point</button>';
    var host = adapter.controlsHost || document.body;
    host.appendChild(controls);
    state.controls = controls;

    controls.addEventListener('click', function (e) {
      var btn = e.target.closest('.crop-btn');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'cancel') return cancel();
      if (act === 'undo') return undo();
      if (act === 'primary') return primaryAction();
      if (act === 'add') return addPoint();
    });

    // ── Public pointer API (called by the viewer) ────────────────────────────
    function pointerDown(clientX, clientY) {
      if (state.destroyed || state.phase === 'saving') return;
      state.lastClient = { x: clientX, y: clientY };
      state.candidate = _normalize(clientX, clientY);
      _render();
    }

    function pointerMove(clientX, clientY) {
      if (state.destroyed || state.phase === 'saving') return;
      state.lastClient = { x: clientX, y: clientY };
      state.candidate = _normalize(clientX, clientY);
      _render();
    }

    function pointerUp(clientX, clientY) {
      if (state.destroyed || state.phase === 'saving') return;
      // Touch end arrives with no coords — fall back to the last known position.
      if (clientX === undefined || clientY === undefined) {
        if (state.lastClient) { clientX = state.lastClient.x; clientY = state.lastClient.y; }
        else return;
      }
      state.candidate = _normalize(clientX, clientY);
      // In 'second' phase a placed point auto-commits (no "Add point" button yet).
      if (state.phase === 'second') {
        _commitCandidate();
        state.phase = 'extend';
      }
      _render();
    }

    // ── Button actions ───────────────────────────────────────────────────────
    function primaryAction() {
      if (state.phase === 'first') {
        if (!state.candidate) return;
        state.committed = [state.candidate];
        state.candidate = null;
        state.phase = 'second';
        _render();
      } else {
        complete();
      }
    }

    function addPoint() {
      if (state.phase === 'extend' && state.candidate) {
        _commitCandidate();
        _render();
      }
    }

    function undo() {
      if (state.committed.length > 0) {
        state.committed.pop();
        if (state.committed.length < 2) {
          state.phase = state.committed.length === 1 ? 'second' : 'first';
        }
        state.candidate = null;
        _render();
      }
    }

    function cancel() {
      if (state.destroyed) return;
      state.destroyed = true;
      _cleanup();
      if (adapter.onCancel) adapter.onCancel();
    }

    function complete() {
      if (state.committed.length < MIN_POINTS) return;
      state.phase = 'saving';
      _render();
      if (adapter.onComplete) adapter.onComplete(state.committed.slice());
    }

    // ── Internals ────────────────────────────────────────────────────────────
    function _normalize(clientX, clientY) {
      var p = adapter.screenToNormalized(clientX, clientY);
      return {
        x: Math.max(0, Math.min(1, p.x)),
        y: Math.max(0, Math.min(1, p.y))
      };
    }

    function _commitCandidate() {
      if (!state.candidate) return;
      state.committed.push(state.candidate);
      state.candidate = null;
    }

    // CSS screen pixels per SVG user-space unit. Uses the rendered rect vs the
    // viewBox so it works for both image (stage-scale) and PDF (CSS-size) modes,
    // and for Retina backing stores. Returns null when not yet laid out.
    function _getRenderedScale() {
      var c = _getCanvas();
      if (!c || !c.isConnected) return null;
      var rect = c.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      var vbW = W || c.width || 1;
      var vbH = H || c.height || 1;
      if (vbW <= 0 || vbH <= 0) return null;
      return { x: rect.width / vbW, y: rect.height / vbH };
    }

    function _render() {
      if (state.destroyed) return;
      // Re-read canvas + viewBox (may change after zoom re-render / PDF page).
      var c = _getCanvas();
      if (c) {
        W = c.width || W;
        H = c.height || H;
      }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.style.width = W + 'px';
      svg.style.height = H + 'px';

      var scale = _getRenderedScale();
      if (!scale) {
        // Not laid out yet — leave as-is; the next refresh() will retry.
        return;
      }
      var s = (scale.x + scale.y) / 2;
      if (s <= 0) return;
      var handleR = HANDLE_RADIUS_PX / s;
      var labelSize = LABEL_SIZE_PX / s;

      var parts = [];
      var pts = state.committed.slice();
      var lastCommitted = pts.length > 0 ? pts[pts.length - 1] : null;

      // Live polygon fill: committed points + candidate (auto-closes visually).
      var fillPts = pts.slice();
      if (state.candidate) fillPts.push(state.candidate);
      if (fillPts.length >= 3) {
        var fillStr = fillPts.map(function (p) { return (p.x * W) + ',' + (p.y * H); }).join(' ');
        parts.push('<polygon class="crop-fill" points="' + fillStr + '" />');
      }

      // Committed segments
      if (pts.length >= 2) {
        var ptsStr = pts.map(function (p) { return (p.x * W) + ',' + (p.y * H); }).join(' ');
        parts.push('<polyline class="crop-line" points="' + ptsStr + '" />');
      }

      // Candidate preview (dashed) from last committed to candidate
      if (state.candidate && lastCommitted) {
        parts.push('<line class="crop-line crop-line-draft" x1="' + (lastCommitted.x * W) + '" y1="' + (lastCommitted.y * H) +
          '" x2="' + (state.candidate.x * W) + '" y2="' + (state.candidate.y * H) + '" />');
      }

      // Closing preview (dashed) last → first
      if (pts.length >= 3) {
        var first = pts[0], last = pts[pts.length - 1];
        parts.push('<line class="crop-line crop-line-close" x1="' + (first.x * W) + '" y1="' + (first.y * H) +
          '" x2="' + (last.x * W) + '" y2="' + (last.y * H) + '" />');
      }

      // Point handles (fixed screen size)
      pts.forEach(function (p, i) {
        parts.push('<circle class="crop-handle" cx="' + (p.x * W) + '" cy="' + (p.y * H) + '" r="' + handleR + '"></circle>');
        parts.push('<text class="crop-handle-label" x="' + (p.x * W) + '" y="' + (p.y * H) + '" font-size="' + labelSize + '">' + (i + 1) + '</text>');
      });
      if (state.candidate) {
        parts.push('<circle class="crop-handle crop-handle-candidate" cx="' + (state.candidate.x * W) + '" cy="' + (state.candidate.y * H) + '" r="' + handleR + '"></circle>');
      }

      svg.innerHTML = parts.join('');

      _renderControls();
    }

    function _renderControls() {
      var primary = controls.querySelector('[data-act="primary"]');
      var addBtn = controls.querySelector('[data-act="add"]');
      var undoBtn = controls.querySelector('[data-act="undo"]');
      var hint = controls.querySelector('[data-hint]');

      undoBtn.disabled = state.committed.length === 0;

      if (state.phase === 'first') {
        primary.textContent = 'Start';
        primary.disabled = !state.candidate;
        addBtn.style.display = 'none';
        hint.textContent = 'Tap or drag to position the first point';
      } else if (state.phase === 'second') {
        primary.textContent = 'Complete';
        primary.disabled = true; // needs >=4 points
        addBtn.style.display = 'none';
        hint.textContent = 'Tap to place the second point';
      } else if (state.phase === 'extend') {
        primary.textContent = 'Complete';
        primary.disabled = state.committed.length < MIN_POINTS;
        addBtn.style.display = '';
        addBtn.disabled = !state.candidate;
        hint.textContent = state.committed.length < MIN_POINTS
          ? ('Add points (' + (MIN_POINTS - state.committed.length) + ' more needed)')
          : 'Add points or press Complete';
      } else if (state.phase === 'saving') {
        primary.textContent = 'Saving…';
        primary.disabled = true;
        addBtn.style.display = 'none';
        hint.textContent = 'Saving crop…';
      }
    }

    // rAF-coalesced refresh so a pinch storm produces at most one render/frame.
    function refresh() {
      if (state.destroyed || refreshRaf) return;
      refreshRaf = requestAnimationFrame(function () {
        refreshRaf = 0;
        if (state.destroyed || !svg.isConnected) return;
        _render();
      });
    }

    function _cleanup() {
      if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
      if (controls && controls.parentNode) controls.parentNode.removeChild(controls);
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      if (refreshRaf) { cancelAnimationFrame(refreshRaf); refreshRaf = 0; }
      if (typeof unsubscribeTransform === 'function') { try { unsubscribeTransform(); } catch (e) {} unsubscribeTransform = null; }
      _cleanup();
    }

    // Subscribe to the viewer's transform changes.
    if (typeof adapter.onTransformChanged === 'function') {
      unsubscribeTransform = adapter.onTransformChanged(refresh);
    }

    refresh(); // initial render at the already-active transform

    return {
      pointerDown: pointerDown,
      pointerMove: pointerMove,
      pointerUp: pointerUp,
      refresh: refresh,
      destroy: destroy,
      getVertices: function () { return state.committed.slice(); },
      isActive: function () { return !state.destroyed; }
    };
  }

  global.DrawingCropTool = { create: create };
})(window);

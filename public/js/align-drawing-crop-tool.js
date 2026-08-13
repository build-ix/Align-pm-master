/*
 * align-drawing-crop-tool.js
 * Polygon crop tool for punchlist per-list pin-location maps.
 *
 * Gesture model (tap / pan / move-point):
 *   - TAP (release within 10px of pointer-down) = add a point at the exact
 *     release location.
 *   - DRAG on empty area = pan the drawing (single finger).
 *   - DRAG starting on an existing point = move that point.
 * Two-finger pinch/pan is owned by the viewer (intercepted before delegation).
 *
 * Markers are sized in DRAWING units (proportional to the drawing), so they
 * scale with the drawing like the text inside it — not a fixed screen size.
 *
 * Points are stored NORMALIZED 0-1 relative to the full sheet. The draft SVG
 * lives inside the scaled viewer stage so lines + fill follow the drawing.
 * A rAF-coalesced refresh() re-renders on viewer transform changes.
 *
 * Exposes: window.DrawingCropTool = { create }
 */
(function (global) {
  'use strict';

  var MIN_POINTS = 4;
  var DRAG_THRESHOLD_PX = 10;   // tap vs drag
  var HIT_RADIUS_PX = 24;       // minimum touch hit radius (client px)

  function create(adapter) {
    if (!adapter || !adapter.overlayHost || typeof adapter.clientToNormalized !== 'function' ||
        typeof adapter.normalizedToClient !== 'function' || typeof adapter.requestPan !== 'function') {
      console.warn('[CropTool] Missing adapter');
      return null;
    }

    var state = {
      points: [],              // committed [{x,y}] normalized, in order
      cropState: 'collecting', // 'collecting' | 'saving'
      svg: null,
      controls: null,
      destroyed: false
    };
    var gesture = {
      state: 'idle',           // idle | pending-empty | pending-handle | panning | dragging-handle
      pointerId: null,
      downClientX: 0, downClientY: 0,
      lastClientX: 0, lastClientY: 0,
      downNormalized: null,
      handleIndex: -1,
      handleStartNormalized: null
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
      '<button type="button" class="crop-btn crop-primary" data-act="primary" disabled>Complete</button>';
    var host = adapter.controlsHost || document.body;
    host.appendChild(controls);
    state.controls = controls;

    controls.addEventListener('click', function (e) {
      var btn = e.target.closest('.crop-btn');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'cancel') return cancel();
      if (act === 'undo') return undo();
      if (act === 'primary') return complete();
    });

    // ── Pointer API (driven by the viewer) ───────────────────────────────────
    function pointerDown(clientX, clientY, meta) {
      if (state.destroyed || state.cropState === 'saving' || gesture.state !== 'idle') return;
      meta = meta || {};
      var normalized = adapter.clientToNormalized(clientX, clientY);
      var handleIndex = _hitTestHandle(clientX, clientY);

      gesture.pointerId = (meta.pointerId !== undefined && meta.pointerId !== null) ? meta.pointerId : null;
      gesture.downClientX = clientX;
      gesture.downClientY = clientY;
      gesture.lastClientX = clientX;
      gesture.lastClientY = clientY;
      gesture.downNormalized = normalized;
      gesture.handleIndex = handleIndex;

      if (handleIndex >= 0) {
        var p = state.points[handleIndex];
        gesture.state = 'pending-handle';
        gesture.handleStartNormalized = { x: p.x, y: p.y };
      } else {
        gesture.state = 'pending-empty';
        gesture.handleStartNormalized = null;
      }
    }

    function pointerMove(clientX, clientY, meta) {
      if (gesture.state === 'idle') return;
      var dxFromDown = clientX - gesture.downClientX;
      var dyFromDown = clientY - gesture.downClientY;
      var distance = Math.sqrt(dxFromDown * dxFromDown + dyFromDown * dyFromDown);

      if (gesture.state === 'pending-empty') {
        if (distance < DRAG_THRESHOLD_PX) return;
        gesture.state = 'panning';
        if (adapter.beginPan) adapter.beginPan(gesture.downClientX, gesture.downClientY);
        adapter.requestPan(dxFromDown, dyFromDown);
        gesture.lastClientX = clientX;
        gesture.lastClientY = clientY;
        return;
      }

      if (gesture.state === 'pending-handle') {
        if (distance < DRAG_THRESHOLD_PX) return;
        gesture.state = 'dragging-handle';
        _updateDraggedHandle(clientX, clientY);
        gesture.lastClientX = clientX;
        gesture.lastClientY = clientY;
        return;
      }

      if (gesture.state === 'panning') {
        var dx = clientX - gesture.lastClientX;
        var dy = clientY - gesture.lastClientY;
        adapter.requestPan(dx, dy);
        gesture.lastClientX = clientX;
        gesture.lastClientY = clientY;
        return;
      }

      if (gesture.state === 'dragging-handle') {
        _updateDraggedHandle(clientX, clientY);
        gesture.lastClientX = clientX;
        gesture.lastClientY = clientY;
      }
    }

    function pointerUp(clientX, clientY, meta) {
      if (gesture.state === 'idle') return;
      switch (gesture.state) {
        case 'pending-empty': {
          // A tap — add a point at the exact release location.
          var p = adapter.clientToNormalized(clientX, clientY);
          if (p && state.cropState === 'collecting') {
            state.points.push({ x: _clamp01(p.x), y: _clamp01(p.y) });
            _render();
          }
          break;
        }
        case 'pending-handle':
          // Tap on an existing handle — no-op (do not add a duplicate point).
          break;
        case 'panning':
          if (adapter.endPan) adapter.endPan();
          break;
        case 'dragging-handle':
          _updateDraggedHandle(clientX, clientY);
          break;
      }
      _resetGesture();
    }

    function pointerCancel() {
      if (gesture.state === 'dragging-handle' && gesture.handleIndex >= 0 && gesture.handleStartNormalized) {
        state.points[gesture.handleIndex] = { x: gesture.handleStartNormalized.x, y: gesture.handleStartNormalized.y };
        _render();
      }
      if (gesture.state === 'panning' && adapter.endPan) adapter.endPan();
      _resetGesture();
    }

    // ── Buttons ──────────────────────────────────────────────────────────────
    function complete() {
      if (state.points.length < MIN_POINTS) return;
      state.cropState = 'saving';
      _render();
      if (adapter.onComplete) adapter.onComplete(state.points.slice());
    }

    function undo() {
      if (state.points.length) {
        state.points.pop();
        _render();
      }
    }

    function cancel() {
      if (state.destroyed) return;
      state.destroyed = true;
      _cleanup();
      if (adapter.onCancel) adapter.onCancel();
    }

    // ── Internals ────────────────────────────────────────────────────────────
    function _clamp01(v) { return Math.max(0, Math.min(1, v)); }

    function _resetGesture() {
      gesture.state = 'idle';
      gesture.pointerId = null;
      gesture.handleIndex = -1;
      gesture.handleStartNormalized = null;
      gesture.downNormalized = null;
    }

    // Hit-test existing handles in CLIENT space (so touch target is stable
    // regardless of zoom), with a minimum 24px radius.
    function _hitTestHandle(clientX, clientY) {
      var best = -1;
      var bestDist = Infinity;
      for (var i = 0; i < state.points.length; i++) {
        var s = adapter.normalizedToClient(state.points[i].x, state.points[i].y);
        var d = Math.sqrt((clientX - s.x) * (clientX - s.x) + (clientY - s.y) * (clientY - s.y));
        if (d <= HIT_RADIUS_PX && d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    }

    function _updateDraggedHandle(clientX, clientY) {
      if (gesture.handleIndex < 0 || gesture.handleIndex >= state.points.length) return;
      var current = adapter.clientToNormalized(clientX, clientY);
      if (!current || !gesture.downNormalized) return;
      var dx = current.x - gesture.downNormalized.x;
      var dy = current.y - gesture.downNormalized.y;
      state.points[gesture.handleIndex] = {
        x: _clamp01(gesture.handleStartNormalized.x + dx),
        y: _clamp01(gesture.handleStartNormalized.y + dy)
      };
      _render();
    }

    function _render() {
      if (state.destroyed) return;
      var c = _getCanvas();
      if (c) {
        W = c.width || W;
        H = c.height || H;
      }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.style.width = W + 'px';
      svg.style.height = H + 'px';

      // Drawing-unit marker sizing (scales with the drawing like the text).
      var D = Math.min(W, H);
      if (!D || D <= 0) D = 1;
      var markerR = 0.004 * D;
      var markerStroke = 0.0008 * D;
      var lineStroke = 0.0010 * D;
      var labelSize = 0.009 * D;
      var labelOff = 0.009 * D;

      var parts = [];
      var pts = state.points;

      // Filled polygon (light blue) once there are >= 3 points.
      if (pts.length >= 3) {
        var fillStr = pts.map(function (p) { return (p.x * W) + ',' + (p.y * H); }).join(' ');
        parts.push('<polygon class="crop-fill" points="' + fillStr + '" />');
      }

      // Connecting lines (including the closing segment once complete/saving).
      if (pts.length >= 2) {
        var linePts = pts.map(function (p) { return (p.x * W) + ',' + (p.y * H); }).join(' ');
        parts.push('<polyline class="crop-line" stroke-width="' + lineStroke + '" points="' + linePts + '" />');
      }
      if (pts.length >= 3) {
        var first = pts[0], last = pts[pts.length - 1];
        parts.push('<line class="crop-line crop-line-close" stroke-width="' + lineStroke + '" x1="' + (first.x * W) + '" y1="' + (first.y * H) + '" x2="' + (last.x * W) + '" y2="' + (last.y * H) + '" />');
      }

      // Point handles + number labels.
      pts.forEach(function (p, i) {
        parts.push('<circle class="crop-handle" cx="' + (p.x * W) + '" cy="' + (p.y * H) + '" r="' + markerR + '" stroke-width="' + markerStroke + '"></circle>');
        parts.push('<text class="crop-handle-label" x="' + (p.x * W + labelOff) + '" y="' + (p.y * H - labelOff) + '" font-size="' + labelSize + '" stroke-width="' + (labelSize * 0.35) + '">' + (i + 1) + '</text>');
      });

      svg.innerHTML = parts.join('');
      _renderControls();
    }

    function _renderControls() {
      var primary = controls.querySelector('[data-act="primary"]');
      var undoBtn = controls.querySelector('[data-act="undo"]');
      var hint = controls.querySelector('[data-hint]');
      var n = state.points.length;

      undoBtn.disabled = n === 0;
      primary.disabled = n < MIN_POINTS;

      if (state.cropState === 'saving') {
        primary.textContent = 'Saving…';
        hint.textContent = 'Saving crop…';
      } else if (n === 0) {
        hint.textContent = 'Tap to add the first point';
      } else if (n < MIN_POINTS) {
        hint.textContent = 'Tap to add points (' + (MIN_POINTS - n) + ' more needed) — drag to pan';
      } else {
        hint.textContent = 'Tap to add points, drag to pan, or press Complete';
      }
    }

    // rAF-coalesced refresh for transform changes.
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

    if (typeof adapter.onTransformChanged === 'function') {
      unsubscribeTransform = adapter.onTransformChanged(refresh);
    }

    refresh();

    return {
      pointerDown: pointerDown,
      pointerMove: pointerMove,
      pointerUp: pointerUp,
      pointerCancel: pointerCancel,
      refresh: refresh,
      destroy: destroy,
      getVertices: function () { return state.points.slice(); },
      isActive: function () { return !state.destroyed; }
    };
  }

  global.DrawingCropTool = { create: create };
})(window);

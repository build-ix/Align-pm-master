/*
 * align-drawing-crop-tool.js
 * Polygon crop tool for punchlist per-list pin-location maps.
 *
 * Self-contained state machine. The drawings viewer owns pointer routing
 * (it delegates single-finger/mouse events to this tool in crop mode) and
 * supplies a screen→normalized adapter. Vertices are stored NORMALIZED 0-1
 * relative to the full drawing sheet — the same space as punch pins.
 *
 * Exposes: window.DrawingCropTool = { create }
 */
(function (global) {
  'use strict';

  var MIN_POINTS = 4;      // minimum vertices before a polygon can close
  var TAP_SLOP = 8;        // px movement threshold to distinguish tap vs drag

  function create(adapter) {
    if (!adapter || !adapter.overlayHost || !adapter.canvas || !adapter.screenToNormalized) {
      console.warn('[CropTool] Missing adapter');
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

    var W = adapter.canvas.width || 1;
    var H = adapter.canvas.height || 1;

    // ── Draft SVG overlay ────────────────────────────────────────────────────
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
      // position candidate on pointer down (drag can refine it)
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
        // "Start" — lock candidate as point 1
        if (!state.candidate) return;
        state.committed = [state.candidate];
        state.candidate = null;
        state.phase = 'second';
        _render();
      } else {
        // "Complete" — close polygon + save
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
        // After undoing below 2 committed points, return to 'second'
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
      // Ignore any uncommitted candidate (or require it committed first via Add point)
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

    function _render() {
      if (state.destroyed) return;
      // Re-read canvas size (may change after zoom re-render)
      W = adapter.canvas.width || W;
      H = adapter.canvas.height || H;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

      var parts = [];
      var pts = state.committed.slice();
      var lastCommitted = pts.length > 0 ? pts[pts.length - 1] : null;

      // Solid committed segments
      if (pts.length >= 2) {
        var ptsStr = pts.map(function (p) { return (p.x * W) + ',' + (p.y * H); }).join(' ');
        parts.push('<polyline class="crop-line" points="' + ptsStr + '" />');
      }

      // Candidate preview (dashed) from last committed to candidate
      if (state.candidate && lastCommitted) {
        parts.push('<line class="crop-line crop-line-draft" x1="' + (lastCommitted.x * W) + '" y1="' + (lastCommitted.y * H) +
          '" x2="' + (state.candidate.x * W) + '" y2="' + (state.candidate.y * H) + '" />');
      }

      // Point handles
      pts.forEach(function (p, i) {
        parts.push('<circle class="crop-handle" cx="' + (p.x * W) + '" cy="' + (p.y * H) + '" r="10" data-i="' + i + '"></circle>');
        parts.push('<text class="crop-handle-label" x="' + (p.x * W) + '" y="' + (p.y * H) + '">' + (i + 1) + '</text>');
      });
      if (state.candidate) {
        parts.push('<circle class="crop-handle crop-handle-candidate" cx="' + (state.candidate.x * W) + '" cy="' + (state.candidate.y * H) + '" r="10"></circle>');
      }

      // Closing preview when >=3 committed (show what Complete would do)
      if (state.phase !== 'first' && pts.length >= 3) {
        var first = pts[0], last = pts[pts.length - 1];
        parts.push('<line class="crop-line crop-line-close" x1="' + (first.x * W) + '" y1="' + (first.y * H) +
          '" x2="' + (last.x * W) + '" y2="' + (last.y * H) + '" />');
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

    function _cleanup() {
      if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
      if (controls && controls.parentNode) controls.parentNode.removeChild(controls);
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      _cleanup();
    }

    _render();

    return {
      pointerDown: pointerDown,
      pointerMove: pointerMove,
      pointerUp: pointerUp,
      destroy: destroy,
      getVertices: function () { return state.committed.slice(); },
      isActive: function () { return !state.destroyed; }
    };
  }

  global.DrawingCropTool = { create: create };
})(window);

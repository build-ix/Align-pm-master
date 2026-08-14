/*
 * align-drawing-pins.js
 * Phase 3: Render punch item pins on the drawing viewer as a viewport-space
 * overlay that stays GLUED to the drawing under pan/zoom.
 *
 * Coordinate model:
 *   - Stored pin coords are full-sheet normalized (0..1), possibly transformed
 *     through coordMapper into canvas BACKING-STORE pixels.
 *   - The overlay is a separate SVG sized to the DISPLAYED canvas rectangle
 *     (viewport space), so we project backing-store px -> displayed px using
 *     getBoundingClientRect() ratios. This keeps pins attached for both the
 *     image path (stage translate+scale) and the PDF path (canvas CSS resize).
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MARKER_SCALE = 0.42; // small on-screen marker, like crop vertices

  function _makePinShape(pin, idx) {
    // Teardrop marker in a 36x46 nominal box, tip anchored at (18, 46).
    var g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'pin-group');
    g.setAttribute('data-pin-id', pin.id);
    g.setAttribute('data-item-id', pin.punch_item_id);
    g.style.pointerEvents = 'auto';
    g.setAttribute('aria-label', 'Punch item pin ' + (idx + 1));

    var shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('class', 'drawing-pin__shape');
    shape.setAttribute('d', 'M18 1 C8.6 1 2 7.8 2 17 C2 28.2 12.2 37.4 18 45 C23.8 37.4 34 28.2 34 17 C34 7.8 27.4 1 18 1 Z');

    var face = document.createElementNS(SVG_NS, 'circle');
    face.setAttribute('class', 'drawing-pin__face');
    face.setAttribute('cx', '18');
    face.setAttribute('cy', '17');
    face.setAttribute('r', '10.5');

    var text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'drawing-pin__number');
    text.setAttribute('x', '18');
    text.setAttribute('y', '17');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('pointer-events', 'none');
    text.textContent = String(idx + 1);

    g.appendChild(shape);
    g.appendChild(face);
    g.appendChild(text);
    return g;
  }

  var PinOverlay = {
    canvas: null,
    drawingId: null,
    overlayHost: null,
    currentSheet: 0,
    pins: [],
    overlay: null,
    coordMapper: null,
    _transformFrame: null,

    init: function (canvasElement, drawingId, overlayHost) {
      this.canvas = canvasElement;
      this.drawingId = drawingId;
      this.overlayHost = overlayHost || canvasElement.parentElement;
      this.currentSheet = 0;
      this.pins = [];

      var hostStyle = getComputedStyle(this.overlayHost);
      if (hostStyle.position === 'static') this.overlayHost.style.position = 'relative';

      this.overlay = document.createElementNS(SVG_NS, 'svg');
      this.overlay.setAttribute('class', 'pin-overlay');
      Object.assign(this.overlay.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        zIndex: '100',
        overflow: 'hidden',
        pointerEvents: 'none'
      });
      this.overlay.setAttribute('preserveAspectRatio', 'none');
      this.overlayHost.appendChild(this.overlay);

      this._syncOverlaySize();
      window.addEventListener('resize', () => this._syncOverlaySize());

      this.loadPins();
    },

    loadPins: function (sheet) {
      if (sheet !== undefined) this.currentSheet = sheet;
      const url = `/api/drawings/${this.drawingId}/punch-items?sheet=${this.currentSheet}`;
      return fetch(url)
        .then(res => res.json())
        .then(items => {
          this.pins = items || [];
          this.render();
          return items;
        })
        .catch(err => {
          console.error('[PinOverlay] Load failed:', err);
          throw err;
        });
    },

    _pinToCanvasPixels: function (pin) {
      if (this.coordMapper) {
        const mapped = this.coordMapper(pin.x, pin.y);
        if (mapped && this.canvas) {
          return { x: mapped.x * this.canvas.width, y: mapped.y * this.canvas.height };
        }
      }
      return { x: pin.x * this.canvas.width, y: pin.y * this.canvas.height };
    },

    _canvasToOverlayPixels: function (canvasPoint) {
      const canvasRect = this.canvas.getBoundingClientRect();
      const overlayRect = this.overlay.getBoundingClientRect();
      return {
        x: (canvasRect.left - overlayRect.left) + canvasPoint.x * (canvasRect.width / this.canvas.width),
        y: (canvasRect.top - overlayRect.top) + canvasPoint.y * (canvasRect.height / this.canvas.height)
      };
    },

    _syncOverlaySize: function () {
      if (!this.overlay) return;
      const rect = this.overlay.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      this.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    },

    render: function () {
      if (!this.overlay || !this.canvas) return;
      this._syncOverlaySize();
      this.overlay.replaceChildren();

      this.pins.forEach((pin, idx) => {
        const canvasPoint = this._pinToCanvasPixels(pin);
        const screenPoint = this._canvasToOverlayPixels(canvasPoint);

        const g = _makePinShape(pin, idx);
        // Anchor the tip (18,46) at the projected point, scaled to a small marker.
        g.setAttribute('transform',
          `translate(${screenPoint.x} ${screenPoint.y}) scale(${MARKER_SCALE}) translate(-18 -46)`);

        g.addEventListener('click', (e) => {
          e.stopPropagation();
          this._onPinClick(pin);
        });

        this.overlay.appendChild(g);
      });
    },

    updateSheet: function (sheetNumber) {
      if (this.currentSheet !== sheetNumber) {
        this.currentSheet = sheetNumber;
        this.loadPins();
      }
    },

    updateTransform: function () {
      if (this._transformFrame) return;
      this._transformFrame = requestAnimationFrame(() => {
        this._transformFrame = null;
        this._syncOverlaySize();
        this.render();
      });
    },

    _onPinClick: function (pin) {
      if (this.selectedPinId) {
        const prevPin = this.overlay.querySelector(`[data-pin-id="${this.selectedPinId}"]`);
        if (prevPin) prevPin.classList.remove('selected');
      }
      this.selectedPinId = pin.id;
      const g = this.overlay.querySelector(`[data-pin-id="${pin.id}"]`);
      if (g) g.classList.add('selected');

      const event = new CustomEvent('pinClicked', {
        detail: { pinId: pin.id, punchItemId: pin.punch_item_id, pin: pin },
        bubbles: true
      });
      this.overlay.dispatchEvent(event);
    },

    clearSelection: function () {
      if (this.selectedPinId) {
        const pin = this.overlay.querySelector(`[data-pin-id="${this.selectedPinId}"]`);
        if (pin) pin.classList.remove('selected');
      }
      this.selectedPinId = null;
    },

    addPin: function (punchItemId, x, y) {
      const data = {
        sheet: this.currentSheet,
        x, y,
        projectId: window.currentProjectId || 'unknown',
        userId: window.currentUserId || 'system'
      };
      const url = `/api/drawings/${this.drawingId}/punch-items/${punchItemId}`;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(res => res.json())
        .then(result => {
          if (result.error) {
            console.error('[PinOverlay] Add failed:', result.error);
          } else {
            this.loadPins();
          }
        })
        .catch(err => console.error('[PinOverlay] Add error:', err));
    },

    removePin: function (punchItemId) {
      const url = `/api/drawings/${this.drawingId}/punch-items/${punchItemId}?sheet=${this.currentSheet}`;
      fetch(url, { method: 'DELETE' })
        .then(() => this.loadPins())
        .catch(err => console.error('[PinOverlay] Remove error:', err));
    }
  };

  global.PinOverlay = PinOverlay;
})(window);

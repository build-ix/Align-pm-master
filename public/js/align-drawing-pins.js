/*
 * align-drawing-pins.js
 * Phase 3: Render punch item pins on PDF viewer as overlay
 * 
 * Usage:
 *   - When drawing viewer loads: initPinOverlay(canvas, drawing_id)
 *   - On sheet change: updatePinSheet(sheet_number)
 *   - On zoom/pan change: repositionPins(pan_x, pan_y, zoom_level)
 */

(function(global) {
  'use strict';

  const PinOverlay = {
    canvas: null,
    drawingId: null,
    currentSheet: 0,
    pins: [],
    overlay: null, // SVG container for pins
    viewTransform: { panX: 0, panY: 0, zoom: 1 },
    selectedPinId: null, // Track which pin is selected
    coordMapper: null,   // optional fn(nx, ny) -> {x, y} document px (crop image)

    /**
     * Init: Create overlay layer and fetch initial pins
     */
    init: function(canvasElement, drawingId) {
      this.canvas = canvasElement;
      this.drawingId = drawingId;
      this.currentSheet = 0;
      this.pins = [];

      // Create SVG overlay (positioned absolute on top of canvas)
      this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.overlay.setAttribute('class', 'pin-overlay');
      this.overlay.style.position = 'absolute';
      this.overlay.style.top = '0';
      this.overlay.style.left = '0';
      this.overlay.style.pointerEvents = 'auto';
      this.overlay.style.zIndex = '100';

      const parent = canvasElement.parentElement;
      parent.style.position = 'relative';
      parent.appendChild(this.overlay);

      // Resize overlay to match canvas
      this._syncOverlaySize();
      window.addEventListener('resize', () => this._syncOverlaySize());

      // ── PHASE 3: DEBUG HANDLER — Coordinate round-trip validation ──────────
      // Click anywhere on the canvas to log normalized coordinates
      // This validates the inverse transform (screen pixels → normalized 0-1 coords)
      var self = this;
      this.canvas.addEventListener('click', function(e) {
        var rect = self.canvas.getBoundingClientRect();
        var screenX = e.clientX - rect.left;
        var screenY = e.clientY - rect.top;
        
        // Convert screen pixels to normalized coords (0-1)
        var normX = screenX / self.canvas.width;
        var normY = screenY / self.canvas.height;
        
        // Round to 3 decimals for readability
        normX = Math.round(normX * 1000) / 1000;
        normY = Math.round(normY * 1000) / 1000;
        
        var msg = `[DEBUG] Clicked at screen (${Math.round(screenX)}, ${Math.round(screenY)}) = normalized (${normX}, ${normY})`;
        console.log(msg);
        
        // Also show in UI as ghost text
        var ghost = document.createElement('div');
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        ghost.style.color = '#0f0';
        ghost.style.fontFamily = 'monospace';
        ghost.style.fontSize = '12px';
        ghost.style.padding = '8px 12px';
        ghost.style.borderRadius = '4px';
        ghost.style.top = (e.clientY + 10) + 'px';
        ghost.style.left = (e.clientX + 10) + 'px';
        ghost.style.zIndex = '9999';
        ghost.style.whiteSpace = 'nowrap';
        ghost.textContent = `(${normX}, ${normY})`;
        document.body.appendChild(ghost);
        
        // Fade out after 1.5 seconds
        setTimeout(function() {
          ghost.style.transition = 'opacity 0.5s ease-out';
          ghost.style.opacity = '0';
          setTimeout(function() { ghost.remove(); }, 500);
        }, 1500);
      });
      // ────────────────────────────────────────────────────────────────────────

      // Fetch and render pins for initial sheet
      this.loadPins();
    },

    /**
     * Load pins from API for current sheet
     */
    loadPins: function(sheet) {
      if (sheet !== undefined) {
        this.currentSheet = sheet;
      }
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

    /**
     * Render all pins as SVG circles on the overlay
     */
    render: function() {
      // Clear existing pins
      this.overlay.innerHTML = '';

      this.pins.forEach((pin, idx) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'pin-group');
        g.setAttribute('data-pin-id', pin.id);
        g.setAttribute('data-item-id', pin.punch_item_id);

        // Convert normalized coords (0-1) to canvas pixel coords, via the
        // coord mapper (full-sheet normalized -> document normalized) when a
        // crop document is active.
        let cx, cy;
        if (this.coordMapper) {
          const doc = this.coordMapper(pin.x, pin.y);
          cx = doc.x * this.canvas.width;
          cy = doc.y * this.canvas.height;
        } else {
          cx = pin.x * this.canvas.width;
          cy = pin.y * this.canvas.height;
        }

        // Teardrop map-pin marker (number in the face, tip = exact coordinate).
        const pinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        pinSvg.setAttribute('class', 'drawing-pin__svg');
        pinSvg.setAttribute('viewBox', '0 0 36 46');
        pinSvg.setAttribute('width', '36');
        pinSvg.setAttribute('height', '46');
        pinSvg.setAttribute('x', cx - 18);
        pinSvg.setAttribute('y', cy - 46);
        pinSvg.setAttribute('overflow', 'visible');
        pinSvg.setAttribute('aria-hidden', 'true');

        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('class', 'drawing-pin__shape');
        shape.setAttribute('d', 'M18 1 C8.6 1 2 7.8 2 17 C2 28.2 12.2 37.4 18 45 C23.8 37.4 34 28.2 34 17 C34 7.8 27.4 1 18 1 Z');

        const face = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        face.setAttribute('class', 'drawing-pin__face');
        face.setAttribute('cx', '18');
        face.setAttribute('cy', '17');
        face.setAttribute('r', '10.5');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'drawing-pin__number');
        text.setAttribute('x', '18');
        text.setAttribute('y', '17');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('pointer-events', 'none');
        text.textContent = (idx + 1).toString();

        pinSvg.appendChild(shape);
        pinSvg.appendChild(face);
        pinSvg.appendChild(text);
        g.appendChild(pinSvg);

        // Click handler
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          this._onPinClick(pin);
        });

        this.overlay.appendChild(g);
      });
    },

    /**
     * Update sheet and reload pins
     */
    updateSheet: function(sheetNumber) {
      if (this.currentSheet !== sheetNumber) {
        this.currentSheet = sheetNumber;
        this.loadPins();
      }
    },

    /**
     * Reposition pins when viewer pans/zooms
     * (Currently not using transforms — pins stay in absolute canvas coords)
     */
    updateTransform: function(panX, panY, zoom) {
      this.viewTransform = { panX, panY, zoom };
      // If using canvas transforms, would update pin positions here
      // For now, pins are always in canvas pixel space
    },

    /**
     * Sync overlay size to canvas
     */
    _syncOverlaySize: function() {
      const rect = this.canvas.getBoundingClientRect();
      this.overlay.setAttribute('width', this.canvas.width);
      this.overlay.setAttribute('height', this.canvas.height);
      this.overlay.setAttribute('viewBox', `0 0 ${this.canvas.width} ${this.canvas.height}`);
    },

    /**
     * Handle pin click — open punch item detail + set selection state
     */
    _onPinClick: function(pin) {
      // Clear previous selection
      if (this.selectedPinId) {
        const prevPin = document.querySelector(`[data-pin-id="${this.selectedPinId}"]`);
        if (prevPin) prevPin.classList.remove('selected');
      }
      
      // Set new selection
      this.selectedPinId = pin.id;
      const g = document.querySelector(`[data-pin-id="${pin.id}"]`);
      if (g) g.classList.add('selected');
      
      // Dispatch custom event so the caller can handle it
      const event = new CustomEvent('pinClicked', {
        detail: { pinId: pin.id, punchItemId: pin.punch_item_id, pin: pin },
        bubbles: true
      });
      this.overlay.dispatchEvent(event);
      
      // Also log for now
      console.log('[PinOverlay] Clicked pin:', pin.punch_item_id);
    },
    
    /**
     * Clear selection (called when drawer closes)
     */
    clearSelection: function() {
      if (this.selectedPinId) {
        const pin = document.querySelector(`[data-pin-id="${this.selectedPinId}"]`);
        if (pin) pin.classList.remove('selected');
      }
      this.selectedPinId = null;
    },

    /**
     * Add a new pin at normalized coordinates
     */
    addPin: function(punchItemId, x, y) {
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
            this.loadPins(); // Refresh
          }
        })
        .catch(err => console.error('[PinOverlay] Add error:', err));
    },

    /**
     * Remove a pin
     */
    removePin: function(punchItemId) {
      const url = `/api/drawings/${this.drawingId}/punch-items/${punchItemId}?sheet=${this.currentSheet}`;
      fetch(url, { method: 'DELETE' })
        .then(() => this.loadPins())
        .catch(err => console.error('[PinOverlay] Remove error:', err));
    }
  };

  // Export
  global.PinOverlay = PinOverlay;

})(window);

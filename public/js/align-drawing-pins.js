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

      // Fetch and render pins for initial sheet
      this.loadPins();
    },

    /**
     * Load pins from API for current sheet
     */
    loadPins: function() {
      const url = `/api/drawings/${this.drawingId}/punch-items?sheet=${this.currentSheet}`;
      
      fetch(url)
        .then(res => res.json())
        .then(items => {
          this.pins = items || [];
          this.render();
        })
        .catch(err => console.error('[PinOverlay] Load failed:', err));
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

        // Convert normalized coords (0-1) to canvas pixel coords
        const cx = pin.x * this.canvas.width;
        const cy = pin.y * this.canvas.height;

        // Draw circle (pin)
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', '20'); // 20px radius
        circle.setAttribute('fill', '#ef4444'); // Red
        circle.setAttribute('opacity', '0.85');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        circle.style.cursor = 'pointer';

        // Draw number inside circle
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', cx);
        text.setAttribute('y', cy);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', '#fff');
        text.setAttribute('pointer-events', 'none');
        text.textContent = (idx + 1).toString();

        g.appendChild(circle);
        g.appendChild(text);

        // Click handler
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          this._onPinClick(pin);
        });

        // Hover
        g.addEventListener('mouseenter', () => {
          circle.setAttribute('r', '24');
          circle.setAttribute('opacity', '1');
        });
        g.addEventListener('mouseleave', () => {
          circle.setAttribute('r', '20');
          circle.setAttribute('opacity', '0.85');
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
     * Handle pin click — open punch item detail
     */
    _onPinClick: function(pin) {
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

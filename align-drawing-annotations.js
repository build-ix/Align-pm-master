/* align-drawing-annotations.js
 * Annotation layer for Align Drawings — Bluebeam/PDF Expert-style annotations.
 * Extends the existing markup system with:
 *   Link pins (clickable URLs / Align section references)
 *   Image stamps (uploaded images placed on drawings)
 *   Punchlist pins (numbered markers linked to punchlist items)
 *   RFI pins (numbered markers linked to RFI items)
 *
 * Data model per annotation:
 *   { id, type, page, x, y, width, height, data: { url?, itemId?, imageData?, label? }, createdBy, createdAt }
 *
 * Storage: records table, category='drawing-annotations', indexed by project_id + drawing_id
 */

(function (global) {
  'use strict';

  var _pid, _drawingId;
  var _annotations = [];     // loaded from storage
  var _selectedAnno = null;  // currently selected annotation id
  var _activeTool = null;    // 'link' | 'image' | 'punchlist' | 'rfi' | null
  var _placing = false;      // waiting for user to click on the drawing
  var _imageFile = null;      // pending image upload for stamp tool

  var S = function () { return window.AlignStorage; };

  // ── Annotation icons (SVG) ──────────────────────────────────────────────

  var ICONS = {
    link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    image: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    punchlist: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    rfi: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    pin: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#ef4444" stroke="#fff" stroke-width="1.5"><circle cx="12" cy="10" r="8"/><text x="12" y="14" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">{N}</text></svg>'
  };

  // ── Public API ──────────────────────────────────────────────────────────

  function init(projectId, drawingId) {
    _pid = projectId;
    _drawingId = drawingId;
    _annotations = [];
    _selectedAnno = null;
    _activeTool = null;
    _loadAnnotations();
  }

  /** Call this when the viewer opens to inject annotation tools into the toolbar */
  function injectToolbarButtons(toolbarEl) {
    if (!toolbarEl) return;
    // Add a separator and our tools
    var sep = document.createElement('div');
    sep.className = 'dr-mv-sep';
    toolbarEl.appendChild(sep);

    var group = document.createElement('div');
    group.className = 'dr-mv-tool-group';
    group.id = 'dr-anno-tools';
    group.innerHTML = [
      '<button class="dr-mv-tool-btn dr-anno-tool" data-anno-tool="link" title="Link — place a clickable link">' + ICONS.link + '</button>',
      '<button class="dr-mv-tool-btn dr-anno-tool" data-anno-tool="image" title="Image Stamp — place an image">' + ICONS.image + '</button>',
      '<button class="dr-mv-tool-btn dr-anno-tool" data-anno-tool="punchlist" title="Punchlist Pin — link to a punchlist item">' + ICONS.punchlist + '</button>',
      '<button class="dr-mv-tool-btn dr-anno-tool" data-anno-tool="rfi" title="RFI Pin — link to an RFI">' + ICONS.rfi + '</button>'
    ].join('');
    toolbarEl.appendChild(group);

    _bindToolButtons(group);
  }

  /** Render all annotations onto the canvas context */
  function renderAnnotations(ctx, zoom, panX, panY, canvasW, canvasH) {
    if (!ctx) return;
    for (var i = 0; i < _annotations.length; i++) {
      var a = _annotations[i];
      var sx = a.x * zoom + panX;
      var sy = a.y * zoom + panY;
      var sw = (a.width || 40) * zoom;
      var sh = (a.height || 40) * zoom;

      // Skip if off-screen
      if (sx + sw < 0 || sy + sh < 0 || sx > canvasW || sy > canvasH) continue;

      _renderAnnotation(ctx, a, sx, sy, sw, sh, zoom);
    }
  }

  /** Find annotation at canvas coordinates (for click detection) */
  function hitTest(canvasX, canvasY, zoom, panX, panY) {
    for (var i = _annotations.length - 1; i >= 0; i--) {
      var a = _annotations[i];
      var sx = a.x * zoom + panX;
      var sy = a.y * zoom + panY;
      var sw = (a.width || 40) * zoom;
      var sh = (a.height || 40) * zoom;
      if (canvasX >= sx && canvasX <= sx + sw && canvasY >= sy && canvasY <= sy + sh) {
        return a;
      }
    }
    return null;
  }

  /** Handle click on annotation (navigate, open item, etc.) */
  function handleClick(annotation) {
    if (!annotation) return;
    switch (annotation.type) {
      case 'link':
        if (annotation.data && annotation.data.url) {
          // Check if it's an Align internal link (starts with #)
          if (annotation.data.url.charAt(0) === '#') {
            window.location.hash = annotation.data.url;
          } else {
            window.open(annotation.data.url, '_blank');
          }
        }
        break;
      case 'punchlist':
        if (annotation.data && annotation.data.itemId) {
          // Navigate to punchlist and open that item
          window.location.hash = '#punchlist';
          // Store item ID for the punchlist module to pick up
          try { localStorage.setItem('align-open-punchlist-item', annotation.data.itemId); } catch (e) {}
        }
        break;
      case 'rfi':
        if (annotation.data && annotation.data.itemId) {
          window.location.hash = '#rfis';
          try { localStorage.setItem('align-open-rfi-item', annotation.data.itemId); } catch (e) {}
        }
        break;
      case 'image':
        // Open image in fullscreen/new tab
        if (annotation.data && annotation.data.imageData) {
          var w = window.open('', '_blank');
          if (w) {
            w.document.write('<img src="' + annotation.data.imageData + '" style="max-width:100%;">');
          }
        }
        break;
    }
  }

  /** Is an annotation tool active? (so canvas click means place annotation, not draw) */
  function isAnnotationToolActive() {
    return _activeTool !== null;
  }

  function getActiveTool() { return _activeTool; }

  /** Place a new annotation at drawing coordinates */
  function placeAnnotation(x, y, callback) {
    var tool = _activeTool;
    _activeTool = null;
    _placing = false;

    switch (tool) {
      case 'link':
        _promptLink(x, y, callback);
        break;
      case 'image':
        _promptImage(x, y, callback);
        break;
      case 'punchlist':
        _promptPunchlist(x, y, callback);
        break;
      case 'rfi':
        _promptRfi(x, y, callback);
        break;
    }
  }

  function getAnnotations() { return _annotations; }
  function selectAnnotation(id) { _selectedAnno = id; }
  function clearSelection() { _selectedAnno = null; }

  function deleteAnnotation(id, callback) {
    _annotations = _annotations.filter(function (a) { return a.id !== id; });
    _saveAnnotations(callback);
  }

  function moveAnnotation(id, x, y, callback) {
    var a = _findById(id);
    if (!a) return;
    a.x = x;
    a.y = y;
    _saveAnnotations(callback);
  }

  // ── Internal ────────────────────────────────────────────────────────────

  function _findById(id) {
    for (var i = 0; i < _annotations.length; i++) {
      if (_annotations[i].id === id) return _annotations[i];
    }
    return null;
  }

  function _uid() {
    return 'anno_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function _bindToolButtons(group) {
    group.querySelectorAll('.dr-anno-tool').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var tool = btn.getAttribute('data-anno-tool');

        // Toggle: if already active, deactivate
        if (_activeTool === tool) {
          _activeTool = null;
          _placing = false;
          _imageFile = null;
          group.querySelectorAll('.dr-anno-tool').forEach(function (b) { b.classList.remove('active'); });
          return;
        }

        // Deactivate any existing markup tool
        _activeTool = tool;
        _placing = true;

        // Update button states
        group.querySelectorAll('.dr-anno-tool').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');

        // If image tool, open file picker immediately
        if (tool === 'image') {
          _pickImage();
        }
      });
    });
  }

  function _pickImage() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function () {
          _imageFile = reader.result;
          // Now waiting for user to click on drawing to place
        };
        reader.readAsDataURL(input.files[0]);
      }
    });
    input.click();
  }

  function _promptLink(x, y, callback) {
    var url = prompt('Enter URL or Align section:\nExamples: https://example.com  or  #punchlist  or  #rfis  or  #photos');
    if (!url) { _activeTool = null; return; }
    var anno = {
      id: _uid(),
      type: 'link',
      page: 1,
      x: x, y: y,
      width: 40, height: 40,
      data: { url: url, label: url.length > 30 ? url.slice(0, 30) + '...' : url },
      createdBy: _getCurrentUser(),
      createdAt: new Date().toISOString()
    };
    _annotations.push(anno);
    _saveAnnotations(function () { if (callback) callback(anno); });
  }

  function _promptImage(x, y, callback) {
    if (!_imageFile) {
      // No image selected yet, pick one
      _activeTool = 'image';
      _placing = true;
      _pickImage();
      return;
    }
    var anno = {
      id: _uid(),
      type: 'image',
      page: 1,
      x: x - 50, y: y - 50,  // center the 100x100 stamp on click point
      width: 100, height: 100,
      data: { imageData: _imageFile },
      createdBy: _getCurrentUser(),
      createdAt: new Date().toISOString()
    };
    _imageFile = null;
    _annotations.push(anno);
    _saveAnnotations(function () { if (callback) callback(anno); });
  }

  function _promptPunchlist(x, y, callback) {
    var itemId = prompt('Enter punchlist item number or ID:');
    if (!itemId) { _activeTool = null; return; }
    var label = prompt('Pin label (e.g. "42"):', itemId);
    if (!label) { _activeTool = null; return; }
    var anno = {
      id: _uid(),
      type: 'punchlist',
      page: 1,
      x: x - 12, y: y - 12,
      width: 24, height: 24,
      data: { itemId: itemId, label: label },
      createdBy: _getCurrentUser(),
      createdAt: new Date().toISOString()
    };
    _annotations.push(anno);
    _saveAnnotations(function () { if (callback) callback(anno); });
  }

  function _promptRfi(x, y, callback) {
    var itemId = prompt('Enter RFI number or ID:');
    if (!itemId) { _activeTool = null; return; }
    var label = prompt('Pin label (e.g. "RFI-12"):', 'RFI-' + itemId);
    if (!label) { _activeTool = null; return; }
    var anno = {
      id: _uid(),
      type: 'rfi',
      page: 1,
      x: x - 12, y: y - 12,
      width: 24, height: 24,
      data: { itemId: itemId, label: label },
      createdBy: _getCurrentUser(),
      createdAt: new Date().toISOString()
    };
    _annotations.push(anno);
    _saveAnnotations(function () { if (callback) callback(anno); });
  }

  function _renderAnnotation(ctx, a, sx, sy, sw, sh, zoom) {
    ctx.save();
    switch (a.type) {
      case 'link':
        // Blue circle with link icon
        ctx.fillStyle = a === _selectedAnno ? '#3b82f6' : 'rgba(59,130,246,0.85)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx + sw / 2, sy + sh / 2, sw / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Link chain symbol
        ctx.fillStyle = '#fff';
        ctx.font = (14 * zoom) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔗', sx + sw / 2, sy + sh / 2);
        break;

      case 'image':
        // Image thumbnail with border
        if (a.data && a.data.imageData) {
          var img = new Image();
          img.src = a.data.imageData;
          if (img.complete) {
            ctx.drawImage(img, sx, sy, sw, sh);
          }
          // Draw border
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx, sy, sw, sh);
        }
        break;

      case 'punchlist':
        // Red numbered pin
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.arc(sx + sw / 2, sy + sh / 2 - 2 * zoom, sw / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Pointy bottom
        ctx.beginPath();
        ctx.moveTo(sx + sw / 2 - 4 * zoom, sy + sh - 2 * zoom);
        ctx.lineTo(sx + sw / 2, sy + sh + 2 * zoom);
        ctx.lineTo(sx + sw / 2 + 4 * zoom, sy + sh - 2 * zoom);
        ctx.fill();
        // Number
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + (10 * zoom) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.data.label || '?', sx + sw / 2, sy + sh / 2 - 2 * zoom);
        break;

      case 'rfi':
        // Purple numbered pin
        ctx.fillStyle = '#8b5cf6';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.arc(sx + sw / 2, sy + sh / 2 - 2 * zoom, sw / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + sw / 2 - 4 * zoom, sy + sh - 2 * zoom);
        ctx.lineTo(sx + sw / 2, sy + sh + 2 * zoom);
        ctx.lineTo(sx + sw / 2 + 4 * zoom, sy + sh - 2 * zoom);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + (9 * zoom) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.data.label || '?', sx + sw / 2, sy + sh / 2 - 2 * zoom);
        break;
    }
    ctx.restore();
  }

  function _getCurrentUser() {
    try {
      var u = JSON.parse(localStorage.getItem('align-user') || '{}');
      return u.name || u.username || 'unknown';
    } catch (e) { return 'unknown'; }
  }

  // ── Storage ─────────────────────────────────────────────────────────────

  function _loadAnnotations() {
    if (!_pid || !_drawingId) return;
    var s = S();
    if (!s) return;
    var records = s.listRecords(_pid, 'drawing-annotations') || [];
    _annotations = records.filter(function (r) {
      return r.data && r.data.drawingId === _drawingId;
    }).map(function (r) { return r.data; });
  }

  function _saveAnnotations(callback) {
    if (!_pid || !_drawingId) return;
    var s = S();
    if (!s) return;
    // Delete old annotations for this drawing
    var existing = s.listRecords(_pid, 'drawing-annotations') || [];
    existing.forEach(function (r) {
      if (r.data && r.data.drawingId === _drawingId) {
        s.deleteRecord(_pid, 'drawing-annotations', r.id);
      }
    });
    // Save new batch
    _annotations.forEach(function (a) {
      s.saveRecord(_pid, 'drawing-annotations', {
        id: a.id,
        drawingId: _drawingId,
        data: a
      });
    });
    if (callback) callback();
  }

  // ── Export ──────────────────────────────────────────────────────────────

  window.AlignDrawingAnnotations = {
    init: init,
    injectToolbarButtons: injectToolbarButtons,
    renderAnnotations: renderAnnotations,
    hitTest: hitTest,
    handleClick: handleClick,
    isAnnotationToolActive: isAnnotationToolActive,
    getActiveTool: getActiveTool,
    placeAnnotation: placeAnnotation,
    getAnnotations: getAnnotations,
    selectAnnotation: selectAnnotation,
    clearSelection: clearSelection,
    deleteAnnotation: deleteAnnotation,
    moveAnnotation: moveAnnotation
  };

})(window);

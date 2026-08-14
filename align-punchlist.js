/* align-punchlist.js — Two-step punchlist lists and items */
(function (global) {
  'use strict';

  function A() { return window.AlignAuth; }
  var CATEGORY = 'punchlist';
  var STATUSES = ['open', 'in_progress', 'resolved', 'verified'];
  var PRIORITIES = ['low', 'medium', 'high', 'critical'];
  var state = {
    container: null, chrome: null, projectId: null,
    apartments: [],
    lists: [], activeList: null,
    editingList: null, editingItem: null,
    activeApt: null, detailItem: null, formReturnView: null,
    viewMode: 'lists', // lists | list-form | list | item-form | detail | profile-edit
    items: [], allItems: [], listItems: {},
    listCrop: null,          // {configured, drawingId, sheetNumber, cropMode, vertices}
    itemAssignments: {},     // { itemId: [{user_id, name, email}] } (batch-loaded)
    mapDrawings: [],         // drawings list for the map picker
    mapPickOpen: false,      // map picker overlay open
    mapPickStep: 'pick',     // 'pick' | 'choose-mode'
    mapPickDrawing: null     // drawing selected in picker
  };
  var viewer = {
    el: null, image: null, stage: null, canvasEl: null, counter: null, filename: null, status: null, title: null,
    downloadButton: null, closeButton: null, prevButton: null, nextButton: null, headerEl: null, footerEl: null,
    images: [], index: 0, open: false, returnFocus: null, backgroundState: [],
    scale: 1, tx: 0, ty: 0,
    gesture: null, suppressClickUntil: 0, pendingSingleTap: 0, lastTap: null
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowISO() { return new Date().toISOString(); }
  function statusLabel(s) { return ({open:'Open', in_progress:'In Progress', resolved:'Resolved', verified:'Verified'})[s] || s || ''; }
  function statusColor(s) { return ({open:'var(--danger)', in_progress:'var(--warning)', resolved:'var(--brand)', verified:'var(--success)'})[s] || 'var(--muted)'; }
  function currentUser() {
    try { var u = A() && A().getActiveUser && A().getActiveUser(); return u ? (u.name || u.id || 'Unknown') : 'Unknown'; } catch (e) { return 'Unknown'; }
  }
  function api(path, options) {
    options = options || {};
    options.credentials = 'include';
    options.headers = Object.assign({'Content-Type': 'application/json'},
      window.AlignAPI && window.AlignAPI.authHeaders ? window.AlignAPI.authHeaders() : {}, options.headers || {});
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || 'Request failed');
        return body;
      });
    });
  }
  function projectPath(suffix) { return '/api/projects/' + encodeURIComponent(state.projectId) + '/punchlist-lists' + (suffix || ''); }
  function resolveProject() {
    var storage = window.AlignStorage;
    var project = storage && storage.getActiveProject && storage.getActiveProject();
    state.projectId = project ? project.id : null;
  }
  function notifyError(error) { alert(error && error.message ? error.message : 'Something went wrong.'); }

  function render(container, chrome) {
    state.container = container;
    state.chrome = chrome || null;
    state.viewMode = 'lists'; state.activeList = null; state.editingList = null; state.editingItem = null;
    state.lists = []; state.items = []; state.allItems = []; state.listItems = {}; state.detailItem = null; state.formReturnView = null; // Reset all data on re-render
    resolveProject();
    _bindContainer();
    _paint();
  }

  function _paint() {
    resolveProject();
    if (!state.container) return;
    _renderHeader();
    if (!state.projectId) {
      state.container.innerHTML = '<div class="pl-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
      return;
    }
    if (state.viewMode === 'list-form') { state.container.innerHTML = _listFormHtml(); _bindListForm(); return; }
    if (state.viewMode === 'item-form') { state.container.innerHTML = _itemFormHtml(); _bindItemForm(); return; }
    if (state.viewMode === 'detail' && state.detailItem) { state.container.innerHTML = _detailHtml(state.detailItem); _bindDetail(); return; }
    if (state.viewMode === 'list' && state.activeList) { state.container.innerHTML = _listHtml(); return; }
    _loadLists();
  }

  function createNewList() { state.editingList = {}; state.viewMode = 'list-form'; _paint(); }

  function _renderHeader() {
    if (!state.chrome || !state.chrome.setHeader) return;
    var view = state.viewMode;
    if (view === 'lists') {
      state.chrome.setHeader({ title: 'Punchlist', backLabel: 'Back', actions: [{ id: 'pl-create-list', label: '+ Create List', variant: 'primary', onClick: createNewList }] });
    } else if (view === 'list' && state.activeList) {
      state.chrome.setHeader({
        title: state.activeList.name || 'List', backLabel: 'All Lists',
        actions: [
          { id: 'pl-edit-list', label: 'Edit List', variant: 'secondary', onClick: function () { state.editingList = JSON.parse(JSON.stringify(state.activeList)); state.viewMode = 'list-form'; _paint(); } }
        ]
      });
    } else if (view === 'detail' && state.detailItem) {
      state.chrome.setHeader({ title: state.detailItem.title || 'Item', backLabel: 'Back to List' });
    } else if (view === 'list-form') {
      var editingList = Boolean(state.editingList && state.editingList.id);
      state.chrome.setHeader({ title: editingList ? 'Edit List' : 'Create List', backLabel: state.activeList ? 'Back to List' : 'All Lists', actions: [{ id: 'pl-save-list', label: 'Save', variant: 'primary', type: 'submit', form: 'pl-list-form' }] });
    } else if (view === 'item-form') {
      var editingItem = Boolean(state.editingItem && state.editingItem.id);
      state.chrome.setHeader({ title: editingItem ? 'Edit Item' : 'Create Item', backLabel: 'Back to List', actions: [{ id: 'pl-save-item', label: 'Save', variant: 'primary', type: 'submit', form: 'pl-item-form' }] });
    }
  }

  function handleBack() {
    switch (state.viewMode) {
      case 'lists': return false;
      case 'list': state.activeList = null; state.viewMode = 'lists'; _loadLists(); return true;
      case 'detail': state.detailItem = null; state.viewMode = 'list'; _loadListItems(); return true;
      case 'list-form': state.editingList = null; if (state.activeList) { state.viewMode = 'list'; _loadListItems(); } else { state.viewMode = 'lists'; _loadLists(); } return true;
      case 'item-form': state.editingItem = null; state.viewMode = 'list'; _loadListItems(); return true;
      default: return false;
    }
  }

  function _loadLists() {
    _renderHeader();
    state.container.innerHTML = '<div class="pl-empty">Loading punchlist lists…</div>';
    api(projectPath()).then(function (data) {
      state.lists = data.lists || [];
      return Promise.all(state.lists.map(function (list) {
        return api(projectPath('/' + encodeURIComponent(list.id) + '/items')).then(function (items) {
          state.listItems[list.id] = items.items || [];
        }).catch(function () { state.listItems[list.id] = []; });
      }));
    }).then(function () {
      state.allItems = state.lists.reduce(function (items, list) {
        return items.concat(state.listItems[list.id] || []);
      }, []);
      if (state.viewMode === 'lists') { state.container.innerHTML = _listsHtml(); }
    }).catch(notifyError);
  }

  function getOpenCount() {
    return state.allItems.filter(function (item) { return item.status === 'open'; }).length;
  }
  function getCriticalCount() {
    return state.allItems.filter(function (item) { return item.priority === 'critical'; }).length;
  }
  function getClosedCount() {
    return state.allItems.filter(function (item) { return item.status === 'resolved' || item.status === 'verified'; }).length;
  }

  /* Lists are the first-level tiles. The apartment label is the only card content. */
  function _listsHtml() {
    var h = ['<div class="pl-wrap"><div class="summary-row">',
      '<div class="summary-item summary-open"><span class="summary-count">' + getOpenCount() + '</span><span class="summary-label">Open</span></div>',
      '<div class="summary-item summary-critical"><span class="summary-count">' + getCriticalCount() + '</span><span class="summary-label">Critical</span></div>',
      '<div class="summary-item summary-closed"><span class="summary-count">' + getClosedCount() + '</span><span class="summary-label">Closed</span></div>',
      '</div>'];
    if (!state.lists.length) h.push('<div class="pl-empty">No punchlist lists yet. Create a list to get started.</div>');
    h.push('<div class="pl-apt-grid pl-list-grid">');
    state.lists.forEach(function (list) {
      h.push('<div class="pl-apt-tile pl-list-tile" data-pl-list="' + esc(list.id) + '">');
      var items = state.listItems[list.id] || [], openCount = items.filter(function (item) { return item.status === 'open'; }).length;
      h.push('<div class="pl-apt-name">' + esc(list.apartment_label || list.name) + '</div>');
      if (openCount > 0) {
        h.push('<span class="pl-item-badge">' + openCount + ' Opened</span>');
      }
      h.push('</div>');
    });
    h.push('</div></div>');
    return h.join('');
  }
  function _handleListsClick(event) {
    if (event.target.closest('#pl-new-list')) { state.editingList = {}; state.viewMode = 'list-form'; _paint(); return; }
    var tile = event.target.closest('[data-pl-list]');
    if (!tile) return;
    state.activeList = state.lists.find(function (l) { return l.id === tile.getAttribute('data-pl-list'); }) || null;
    if (state.activeList) { state.viewMode = 'list'; _loadListItems(); }
  }

  function _loadListItems() {
    _renderHeader();
    if (state.viewMode === 'list') state.container.innerHTML = '<div class="pl-empty">Loading list…</div>';
    var itemsPromise = api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/items'));
    var cropPromise = api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/crop')).catch(function () { return { configured: false }; });
    var assignPromise = api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/assignments')).catch(function () { return { items: {} }; });
    Promise.all([itemsPromise, cropPromise, assignPromise]).then(function (results) {
      state.items = results[0].items || [];
      state.listCrop = results[1] || { configured: false };
      state.itemAssignments = (results[2] && results[2].items) || {};
      if (state.viewMode === 'list') { state.container.innerHTML = _listHtml(); }
      else if (state.viewMode === 'list-form') { state.container.innerHTML = _listFormHtml(); _bindListForm(); }
    }).catch(notifyError);
  }
  function _listHtml() {
    var list = state.activeList, h = [];
    h.push('<div class="pl-wrap">');
    h.push('<div class="pl-list-toolbar">' +
      '<button type="button" class="pm-btn primary" data-pl-act="add-item">+ Add Item</button>' +
      '<button type="button" class="pm-btn" data-pl-act="notify-all">Notify All</button>' +
      '<button type="button" class="pm-btn" data-pl-act="export-pdf">Export PDF</button>' +
    '</div>');
    if (list.apartment_label) h.push('<div class="pl-detail-section">Apartment: <strong>' + esc(list.apartment_label) + '</strong></div>');
    if (list.description) h.push('<div class="pl-detail-section pl-detail-desc">' + esc(list.description) + '</div>');
    if (!state.items.length) h.push('<div class="pl-empty">No items yet.</div>');
    else {
      h.push('<div class="pl-items">');
      state.items.forEach(function (item, index) {
        var assigns = state.itemAssignments[item.id] || [];
        var assignedNames = assigns.length ? assigns.map(function (a) { return a.name; }).join(', ') : 'Unassigned';
        h.push('<div class="pl-item-row" data-pl-item="' + esc(item.id) + '">' +
          '<div class="pl-item-media">' + _itemThumbHtml(item) + '</div>' +
          '<div class="pl-item-body">' +
            '<div class="pl-item-head"><span class="pl-item-title">' + esc(item.title || 'Untitled') + '</span><span class="pl-item-status" style="background:' + statusColor(item.status) + '">' + statusLabel(item.status) + '</span></div>' +
            '<div class="pl-item-num">Item #' + String(index + 1).padStart(3, '0') + '</div>' +
            '<button type="button" class="pl-item-assigned" data-pl-act="assign-item" data-pl-id="' + esc(item.id) + '"><span class="pl-item-assigned-label">Assigned To:</span><span class="pl-item-assigned-names">' + esc(assignedNames) + '</span></button>' +
            '<button type="button" class="pl-item-notify" data-pl-act="notify-item" data-pl-id="' + esc(item.id) + '"' + (assigns.length ? '' : ' disabled') + '>Notify Now</button>' +
          '</div>' +
        '</div>');
      });
      h.push('</div>');
    }
    h.push('</div>'); return h.join('');
  }

  function _itemThumbHtml(item) {
    var img = null;
    if (Array.isArray(item.images)) {
      img = item.images.find(function (i) { return i && i.fileId && String(i.mimeType || '').indexOf('image/') === 0; });
    }
    if (img) return '<img class="pl-item-thumb" src="/api/files/' + esc(img.fileId) + '?thumb=1" alt="" loading="lazy" decoding="async">';
    return '<div class="pl-item-thumb-placeholder">No photo</div>';
  }

  function _mapSectionHtml() {
    var crop = state.listCrop;
    var h = ['<div class="pl-map-section">'];
    if (crop && crop.configured) {
      h.push('<div class="pl-map-info"><span class="pl-map-title">Location map</span><span class="pl-map-mode">' + (crop.cropMode === 'polygon' ? 'Cropped area' : 'Whole plan') + '</span></div>');
      h.push('<button type="button" class="pm-btn small" data-pl-act="edit-map">Change map</button>');
    } else {
      h.push('<div class="pl-map-info"><span class="pl-map-title">Location map</span><span class="pl-map-mode pl-map-mode-none">Not set</span></div>');
      h.push('<button type="button" class="pm-btn small" data-pl-act="set-map">Set map</button>');
    }
    h.push('</div>');
    return h.join('');
  }

  /* ── Location map: drawing picker + crop/pin flows ─────────────────────── */
  function _openMapPicker() {
    var listDrawings = window.AlignDrawings && window.AlignDrawings.listDrawings;
    if (!listDrawings) { alert('Drawings module is not available.'); return; }
    state.mapPickOpen = true;
    state.mapPickStep = 'pick';
    state.mapPickDrawing = null;
    _renderMapPicker();
    listDrawings(state.projectId).then(function (drawings) {
      state.mapDrawings = drawings || [];
      if (state.mapPickOpen) _renderMapPicker();
    }).catch(function () {
      state.mapDrawings = [];
      if (state.mapPickOpen) _renderMapPicker();
    });
  }

  function _renderMapPicker() {
    var existing = document.getElementById('pl-map-picker');
    if (existing) existing.remove();
    if (!state.mapPickOpen) return;

    var h = ['<div class="pl-map-picker-overlay" id="pl-map-picker">',
      '<div class="pl-map-picker-modal">',
      '<div class="pl-map-picker-header"><span class="pl-map-picker-title">' + (state.mapPickStep === 'pick' ? 'Choose a drawing' : 'Use this drawing') + '</span><button type="button" class="pl-map-picker-close" data-map-act="close">✕</button></div>'];

    if (state.mapPickStep === 'pick') {
      h.push('<div class="pl-map-picker-body">');
      if (!state.mapDrawings.length) h.push('<div class="pl-empty">No drawings yet. Upload drawings in the Drawings section first.</div>');
      state.mapDrawings.forEach(function (d) {
        var isImage = d.mimeType && d.mimeType.indexOf('image/') === 0;
        var isPdf = d.mimeType === 'application/pdf';
        var icon = isPdf ? '📄' : (isImage ? '🖼️' : '📁');
        h.push('<button type="button" class="pl-map-picker-drawing" data-map-act="pick" data-map-id="' + esc(d.id) + '"><span class="pl-map-picker-icon">' + icon + '</span><span class="pl-map-picker-name">' + esc(d.name || 'Drawing') + '</span></button>');
      });
      h.push('</div>');
    } else {
      var d = state.mapPickDrawing;
      h.push('<div class="pl-map-picker-body">');
      h.push('<div class="pl-map-picker-selected">' + esc((d && d.name) || 'Drawing') + '</div>');
      h.push('<button type="button" class="pl-map-picker-mode" data-map-act="full">Use whole plan as-is</button>');
      h.push('<button type="button" class="pl-map-picker-mode" data-map-act="crop">Crop area</button>');
      h.push('<button type="button" class="pl-map-picker-back" data-map-act="back">← Back</button>');
      h.push('</div>');
    }

    h.push('</div></div>');
    var el = document.createElement('div');
    el.innerHTML = h.join('');
    var overlay = el.firstElementChild;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (event) {
      var target = event.target.closest('[data-map-act]');
      if (!target) return;
      var act = target.getAttribute('data-map-act');
      if (act === 'close') { _closeMapPicker(); return; }
      if (act === 'pick') {
        var id = target.getAttribute('data-map-id');
        state.mapPickDrawing = state.mapDrawings.find(function (dd) { return dd.id === id; }) || null;
        if (state.mapPickDrawing) { state.mapPickStep = 'choose-mode'; _renderMapPicker(); }
        return;
      }
      if (act === 'back') { state.mapPickStep = 'pick'; _renderMapPicker(); return; }
      if (act === 'full') { _setMapFull(); return; }
      if (act === 'crop') { _setMapCrop(); return; }
    });
  }

  function _closeMapPicker() {
    state.mapPickOpen = false;
    var el = document.getElementById('pl-map-picker');
    if (el) el.remove();
  }

  function _setMapFull() {
    var d = state.mapPickDrawing;
    if (!d) return;
    _closeMapPicker();
    api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/crop'), {
      method: 'PUT',
      body: JSON.stringify({ drawingId: d.id, sheetNumber: 0, cropMode: 'full', vertices: null })
    }).then(function () { _loadListItems(); }).catch(notifyError);
  }

  function _setMapCrop() {
    var d = state.mapPickDrawing;
    if (!d) return;
    _closeMapPicker();
    if (!window.AlignDrawings || !window.AlignDrawings.openListCrop) { alert('Drawings module is not available.'); return; }
    window.AlignDrawings.openListCrop({
      projectId: state.projectId,
      drawingId: d.id,
      sheet: 0,
      listId: state.activeList.id,
      onSaved: function () { _loadListItems(); },
      onCancel: function () {}
    }).catch(notifyError);
  }

  function _placePin(itemId) {
    var crop = state.listCrop;
    if (!crop || !crop.configured) { alert('Set a location map for this list first.'); return; }
    if (!window.AlignDrawings || !window.AlignDrawings.openListPin) { alert('Drawings module is not available.'); return; }
    window.AlignDrawings.openListPin({
      projectId: state.projectId,
      drawingId: crop.drawingId,
      sheet: crop.sheetNumber || 0,
      listId: state.activeList.id,
      itemId: itemId,
      cropMode: crop.cropMode,
      vertices: crop.vertices,
      cropRenderStatus: crop.cropRenderStatus,
      cropImage: crop.cropImage,
      cropRenderMeta: crop.cropRenderMeta,
      onPlaced: function () { _loadListItems(); },
      onCancel: function () {}
    }).catch(notifyError);
  }

  function _handleListClick(event) {
    var action = event.target.closest('[data-pl-act]');
    if (action) {
      var act = action.getAttribute('data-pl-act');
      if (act === 'set-map' || act === 'edit-map') { _openMapPicker(); return; }
      if (act === 'assign-item') { _openAssignSheet(action.getAttribute('data-pl-id')); return; }
      if (act === 'notify-item') { _notifyItem(action); return; }
      if (act === 'add-item') { _addItem(); return; }
      if (act === 'notify-all') { _notifyAllList(action); return; }
      if (act === 'export-pdf') { _exportListPdf(action); return; }
      return;
    }
    var row = event.target.closest('[data-pl-item]');
    if (row) { state.detailItem = state.items.find(function (i) { return i.id === row.getAttribute('data-pl-item'); }) || null; if (state.detailItem) { state.viewMode = 'detail'; _paint(); } }
  }

  function _openAssignSheet(itemId) {
    if (!window.PunchlistAssignments) { alert('Assignments module not available.'); return; }
    window.PunchlistAssignments.openAssignmentSheet({
      projectId: state.projectId,
      punchItemId: itemId,
      onSaved: function () { _loadListItems(); }
    });
  }

  function _notifyItem(button) {
    if (!window.PunchlistAssignments) { alert('Assignments module not available.'); return; }
    var itemId = button.getAttribute('data-pl-id');
    if (!itemId) return;
    var orig = button.textContent;
    button.disabled = true;
    button.textContent = 'Queuing…';
    window.PunchlistAssignments.notifyItem(itemId).then(function () {
      button.textContent = 'Queued';
      setTimeout(function () { button.disabled = false; button.textContent = orig; }, 2500);
    }).catch(function (err) {
      alert('Notify failed: ' + err.message);
      button.disabled = false;
      button.textContent = orig;
    });
  }

  function _addItem() {
    state.editingItem = {};
    state.viewMode = 'item-form';
    _paint();
  }

  function _exportListPdf(button) {
    var orig = button.textContent;
    button.disabled = true;
    button.textContent = 'Generating…';
    api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/export'), { method: 'POST', body: JSON.stringify({}) })
      .then(function (data) {
        button.disabled = false;
        button.textContent = orig;
        if (data && data.file && data.file.url) window.open(data.file.url, '_blank');
        else alert('Export ready.');
      })
      .catch(function (err) {
        button.disabled = false;
        button.textContent = orig;
        alert('Export failed: ' + (err && err.message ? err.message : err));
      });
  }

  function _notifyAllList(button) {
    if (!confirm('Send one email (with a filtered PDF) to every contact assigned to an item in this list?')) return;
    var orig = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing…';
    api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/notify-all'), { method: 'POST', body: JSON.stringify({}) })
      .then(function (data) {
        button.disabled = false;
        button.textContent = orig;
        var skipped = data.skipped ? data.skipped.length : 0;
        alert('Queued ' + (data.queuedCount || 0) + ' notification(s)' + (skipped ? ' (' + skipped + ' skipped — no email)' : '') + '.');
      })
      .catch(function (err) {
        button.disabled = false;
        button.textContent = orig;
        alert('Notify failed: ' + (err && err.message ? err.message : err));
      });
  }

  function _onContainerClick(event) {
    if (state.viewMode === 'lists') { _handleListsClick(event); return; }
    if (state.viewMode === 'list') { _handleListClick(event); return; }
    if (state.viewMode === 'list-form') { _handleListClick(event); return; }
    if (state.viewMode === 'detail') { _handleDetailClick(event); return; }
  }

  function _handleDetailClick(event) {
    var btn = event.target.closest('[data-pl-detail-act]');
    if (btn) {
      var act = btn.getAttribute('data-pl-detail-act');
      var id = btn.getAttribute('data-pl-id');
      if (act === 'edit-item') { state.editingItem = JSON.parse(JSON.stringify(state.detailItem || state.items.find(function (i) { return i.id === id; }) || {})); state.viewMode = 'item-form'; _paint(); return; }
      if (act === 'pin-item') { _placePin(id); return; }
      if (act === 'delete-item' && confirm('Delete this item?')) {
        api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/items/' + encodeURIComponent(id)), {method:'DELETE'}).then(function () { state.detailItem = null; state.viewMode = 'list'; _loadListItems(); }).catch(notifyError);
      }
      return;
    }
    var link = event.target.closest('.pl-image-link[data-image-index]');
    if (!link) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    var grid = link.closest('.pl-detail-images');
    if (!grid) return;
    var links = Array.prototype.slice.call(grid.querySelectorAll('a[data-image-index]'));
    var images = links.map(function (l, i) {
      return { url: l.getAttribute('data-full-url') || l.href, filename: l.getAttribute('data-filename') || ('Attachment ' + (i + 1)) };
    });
    var startIndex = links.indexOf(link);
    if (startIndex < 0) startIndex = 0;
    _openImageViewer(images, startIndex, link);
  }

  function _bindContainer() {
    if (state._boundEl === state.container) return;
    state._boundEl = state.container;
    state.container.addEventListener('click', _onContainerClick);
  }

  /* Dedicated list form: no priority, images, location, or trade controls. */
  function _listFormHtml() {
    var list = state.editingList || {};
    var privacy = list.privacy === 'public' ? 'public' : 'private';
    var deleteBtn = list.id ? '<button class="pm-btn danger" id="pl-list-form-delete" type="button">Delete List</button>' : '';
    // Location map is managed from the Edit List menu (existing lists only).
    var mapSection = list.id ? _mapSectionHtml() : '';
    return '<form id="pl-list-form" class="pl-form-wrap pl-list-form"><div class="pl-form-section"><label class="pl-field-label" for="pl-list-name">Name</label><input class="pl-input" id="pl-list-name" value="' + esc(list.name) + '" maxlength="120" required></div><div class="pl-form-section"><span class="pl-field-label">Privacy</span><div class="pl-privacy-options" role="radiogroup" aria-label="Privacy"><label class="pl-privacy-option"><input type="radio" name="pl-list-privacy" value="private"' + (privacy === 'private' ? ' checked' : '') + '> <span>Private</span></label><label class="pl-privacy-option"><input type="radio" name="pl-list-privacy" value="public"' + (privacy === 'public' ? ' checked' : '') + '> <span>Public</span></label></div></div>' + mapSection + (deleteBtn ? '<div class="pl-form-footer">' + deleteBtn + '</div>' : '') + '</form>';
  }
  function _bindListForm() {
    var form = document.getElementById('pl-list-form');
    var submitting = false;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submitting) return;
      var name = document.getElementById('pl-list-name').value.trim();
      var privacyInput = document.querySelector('input[name="pl-list-privacy"]:checked');
      var privacy = privacyInput ? privacyInput.value : '';
      if (!name) { alert('Name is required.'); return; }
      if (name.length > 120) { alert('Name must be 120 characters or fewer.'); return; }
      if (privacy !== 'private' && privacy !== 'public') { alert('Privacy must be private or public.'); return; }
      var payload = {name:name, privacy:privacy, scope_type:'project', status:'open'};
      submitting = true;
      var saveButton = document.getElementById('pl-save-list');
      if (saveButton) { saveButton.disabled = true; saveButton.setAttribute('aria-busy', 'true'); }
      var request = state.editingList.id ? api(projectPath('/' + encodeURIComponent(state.editingList.id)), {method:'PATCH', body:JSON.stringify(payload)}) : api(projectPath(), {method:'POST', body:JSON.stringify(payload)});
      request.then(function (data) { state.activeList = data.list || state.activeList; state.editingList = null; state.viewMode = state.activeList ? 'list' : 'lists'; if (state.activeList) _loadListItems(); else _loadLists(); }).catch(function (error) { submitting = false; if (saveButton) { saveButton.disabled = false; saveButton.removeAttribute('aria-busy'); } notifyError(error); });
    });
    var deleteButton = document.getElementById('pl-list-form-delete');
    if (deleteButton) {
      deleteButton.addEventListener('click', function () {
        if (!confirm('Delete this list and all items? This cannot be undone.')) return;
        api(projectPath('/' + encodeURIComponent(state.editingList.id)), {method:'DELETE'}).then(function () { state.activeList = null; state.editingList = null; state.viewMode = 'lists'; _loadLists(); }).catch(notifyError);
      });
    }
  }

  /* Dedicated item form: no name, description, apartment, scope, or list controls. */
  function _itemFormHtml() {
    var item = state.editingItem || {};
    return '<form id="pl-item-form" class="pl-form-wrap pl-item-form"><div class="pl-form-section pl-attachments-section"><label class="pl-field-label">Attachments</label><div class="pl-image-upload"><button type="button" class="pl-upload-btn" id="pl-upload-attachments">Attachments</button></div><div id="pl-images-preview" class="pl-images-preview"></div><input type="file" id="pl-file-input" accept="image/*,video/*,.pdf" style="display:none" multiple></div><div class="pl-form-section"><label class="pl-field-label" for="pl-item-title">Title</label><input class="pl-input" id="pl-item-title" value="' + esc(item.title) + '" required></div><div class="pl-form-section"><label class="pl-field-label" for="pl-item-description">Description</label><textarea class="pl-textarea" id="pl-item-description" rows="3" placeholder="Describe the issue…">' + esc(item.description) + '</textarea></div><div class="pl-form-section"><label class="pl-field-label">Location</label><button type="button" class="pm-btn" id="pl-item-pin-location">Pin Location</button></div><div class="pl-form-section"><label class="pl-field-label" for="pl-item-priority">Priority</label><select class="pl-input" id="pl-item-priority">' + PRIORITIES.map(function (p) { return '<option value="' + p + '"' + (item.priority === p || (!item.priority && p === 'medium') ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; }).join('') + '</select></div></form>';
  }
  function _bindItemForm() {
    var form = document.getElementById('pl-item-form');
    var input = document.getElementById('pl-file-input');
    document.getElementById('pl-upload-attachments').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { Array.prototype.forEach.call(input.files || [], _addImage); input.value = ''; });
    var submitting = false;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submitting) return;
      var title = document.getElementById('pl-item-title').value.trim();
      if (!title) { alert('Title is required.'); return; }
      submitting = true;
      var saveButton = document.getElementById('pl-save-item');
      if (saveButton) { saveButton.disabled = true; saveButton.setAttribute('aria-busy', 'true'); }
      _saveItem().catch(function (error) { submitting = false; if (saveButton) { saveButton.disabled = false; saveButton.removeAttribute('aria-busy'); } notifyError(error); });
    });
    (state.editingItem.images || []).forEach(function (image) { _showImage(image); });
  }
  function _imageUrl(image) {
    if (image.previewUrl) return image.previewUrl;
    if (image.fileId) return '/api/files/' + encodeURIComponent(image.fileId) + '?thumb=1';
    if (image.data) return image.data; // legacy base64
    return '';
  }
  function _fullImageUrl(image) {
    if (image.fileId) return '/api/files/' + encodeURIComponent(image.fileId);
    if (image.data) return image.data;
    return '';
  }
  function _addImage(file) {
    var image = { id: uid(), file: file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file), timestamp: nowISO() };
    if (!state.editingItem.images) state.editingItem.images = [];
    state.editingItem.images.push(image);
    _showImage(image);
  }
  function _showImage(image) {
    var preview = document.getElementById('pl-images-preview');
    if (!preview) return;
    var url = _imageUrl(image);
    if (!url) return;
    var key = image.id || image.fileId;
    var thumb = document.createElement('div');
    thumb.className = 'pl-image-thumb';
    thumb.style.backgroundImage = 'url(' + url + ')';
    thumb.title = 'Click to remove';
    thumb.onclick = function () {
      state.editingItem.images = (state.editingItem.images || []).filter(function (i) { return (i.id || i.fileId) !== key; });
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
      thumb.remove();
    };
    preview.appendChild(thumb);
  }
  function _uploadFile(file) {
    var formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('project_id', state.projectId);
    formData.append('type', 'punchlist');
    var headers = window.AlignAPI && window.AlignAPI.authHeaders ? window.AlignAPI.authHeaders() : {};
    return fetch('/api/files/upload', { method: 'POST', credentials: 'include', headers: headers, body: formData }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || 'Upload failed');
        return { fileId: body.file.id, name: body.file.original_name, mimeType: body.file.mime_type };
      });
    });
  }
  function _saveItem() {
    var pending = (state.editingItem.images || []).filter(function (i) { return i.file && !i.fileId; });
    var uploads = pending.map(function (image) {
      return _uploadFile(image.file).then(function (uploaded) {
        image.fileId = uploaded.fileId;
        image.name = uploaded.name;
        image.mimeType = uploaded.mimeType;
        if (image.previewUrl) { URL.revokeObjectURL(image.previewUrl); delete image.previewUrl; }
        delete image.file;
      });
    });
    return Promise.all(uploads).then(function () {
      var images = (state.editingItem.images || []).map(function (i) {
        if (i.fileId) return { fileId: i.fileId, name: i.name, mimeType: i.mimeType };
        return i; // preserve legacy base64 object
      });
      var title = document.getElementById('pl-item-title').value.trim();
      var payload = { title: title, description: document.getElementById('pl-item-description').value.trim(), location: state.editingItem.location || '', priority: document.getElementById('pl-item-priority').value, images: images };
      var base = projectPath('/' + encodeURIComponent(state.activeList.id) + '/items');
      var request = state.editingItem.id ? api(base + '/' + encodeURIComponent(state.editingItem.id), { method: 'PATCH', body: JSON.stringify(payload) }) : api(base, { method: 'POST', body: JSON.stringify(payload) });
      return request.then(function () { state.editingItem = null; state.viewMode = 'list'; _loadListItems(); });
    });
  }

  function _detailHtml(item) {
    var h = [
      '<div class="pl-detail-wrap">',
      '<div class="pl-detail-section"><span class="pl-detail-status-badge" style="background:' + statusColor(item.status) + '">' + statusLabel(item.status) + '</span> <span class="pl-priority-badge">' + esc(item.priority || '') + '</span></div>'
    ];
    if (item.description) h.push('<div class="pl-detail-section"><span class="pl-detail-label">Description</span><div class="pl-detail-value">' + esc(item.description) + '</div></div>');
    var images = item.images || [];
    if (images.length) {
      h.push('<div class="pl-detail-section"><span class="pl-detail-label">Attachments</span><div class="pl-detail-images">');
      images.forEach(function (image, index) {
        var thumb = _imageUrl(image);
        var full = _fullImageUrl(image);
        if (!thumb) return;
        var name = image.name || ('Attachment ' + (index + 1));
        h.push('<a class="pl-image-link" href="' + full + '" data-image-index="' + index + '" data-full-url="' + full + '" data-filename="' + esc(name) + '" aria-label="Open ' + esc(name) + ', image ' + (index + 1) + ' of ' + images.length + '"><div class="pl-image-thumb" style="background-image:url(\'' + thumb + '\')" role="img" aria-label="' + esc(name) + '"></div></a>');
      });
      h.push('</div></div>');
    }
    h.push('<div class="pl-detail-section"><span class="pl-detail-label">Location</span><div class="pl-detail-value">' + esc(item.location || '—') + '</div></div>');
    h.push('<div class="pl-detail-section"><span class="pl-detail-label">Trade</span><div class="pl-detail-value">' + esc(item.trade || '—') + '</div></div>');
    h.push('<div class="pl-detail-actions">',
      '<button type="button" class="pm-btn" data-pl-detail-act="edit-item" data-pl-id="' + esc(item.id) + '">Edit</button>',
      '<button type="button" class="pm-btn" data-pl-detail-act="pin-item" data-pl-id="' + esc(item.id) + '">Pin Location</button>',
      '<button type="button" class="pm-btn danger" data-pl-detail-act="delete-item" data-pl-id="' + esc(item.id) + '">Delete</button>',
      '</div>');
    h.push('</div>');
    return h.join('');
  }
  function _bindDetail() {
    // Detail actions are handled via the container's delegated click (see _handleDetailClick).
  }

  /* ── In-page image viewer (lightbox) ─────────────────────────────────── */
  var VIEWER_SWIPE_THRESHOLD = 50;
  var VIEWER_AXIS_RATIO = 1.2;
  var VIEWER_TAP_MOVE_THRESHOLD = 10;
  var VIEWER_TAP_MAX_MS = 300;
  var VIEWER_DOUBLE_TAP_MS = 280;
  var VIEWER_DOUBLE_TAP_DISTANCE = 24;
  var VIEWER_MIN_SCALE = 1;
  var VIEWER_MAX_SCALE = 4;
  var VIEWER_DOUBLE_TAP_SCALE = 2.5;

  function _vclamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function _ensureImageViewer() {
    if (viewer.el) return viewer.el;
    var host = document.createElement('div');
    host.innerHTML = [
      '<div class="pl-image-viewer" role="dialog" aria-modal="true" aria-labelledby="pl-image-viewer-title" aria-describedby="pl-image-viewer-meta" aria-hidden="true" hidden>',
      '<div class="pl-image-viewer__backdrop" data-viewer-action="close" aria-hidden="true"></div>',
      '<div class="pl-image-viewer__shell">',
      '<header class="pl-image-viewer__header">',
      '<h2 id="pl-image-viewer-title" class="pl-image-viewer__title">Attachment preview</h2>',
      '<div class="pl-image-viewer__header-actions">',
      '<button type="button" class="pl-image-viewer__download" data-viewer-action="download" aria-label="Download image"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>',
      '<button type="button" class="pl-image-viewer__close" data-viewer-action="close" aria-label="Close image viewer"><span aria-hidden="true">&times;</span></button>',
      '</div></header>',
      '<main class="pl-image-viewer__stage">',
      '<div class="pl-image-viewer__canvas"><img class="pl-image-viewer__image" alt="" draggable="false"><div class="pl-image-viewer__status" role="status" aria-live="polite"></div></div>',
      '<button type="button" class="pl-image-viewer__nav pl-image-viewer__nav--prev" data-viewer-action="prev" aria-label="Previous image"><span aria-hidden="true">&#8249;</span></button>',
      '<button type="button" class="pl-image-viewer__nav pl-image-viewer__nav--next" data-viewer-action="next" aria-label="Next image"><span aria-hidden="true">&#8250;</span></button>',
      '</main>',
      '<footer id="pl-image-viewer-meta" class="pl-image-viewer__footer"><span class="pl-image-viewer__counter" aria-live="polite" aria-atomic="true"></span><span class="pl-image-viewer__filename"></span></footer>',
      '</div></div>'
    ].join('');
    viewer.el = host.firstElementChild;
    document.body.appendChild(viewer.el);
    viewer.image = viewer.el.querySelector('.pl-image-viewer__image');
    viewer.stage = viewer.el.querySelector('.pl-image-viewer__stage');
    viewer.canvasEl = viewer.el.querySelector('.pl-image-viewer__canvas');
    viewer.counter = viewer.el.querySelector('.pl-image-viewer__counter');
    viewer.filename = viewer.el.querySelector('.pl-image-viewer__filename');
    viewer.status = viewer.el.querySelector('.pl-image-viewer__status');
    viewer.title = viewer.el.querySelector('.pl-image-viewer__title');
    viewer.headerEl = viewer.el.querySelector('.pl-image-viewer__header');
    viewer.footerEl = viewer.el.querySelector('.pl-image-viewer__footer');
    viewer.downloadButton = viewer.el.querySelector('[data-viewer-action="download"]');
    viewer.closeButton = viewer.el.querySelector('.pl-image-viewer__close');
    viewer.prevButton = viewer.el.querySelector('[data-viewer-action="prev"]');
    viewer.nextButton = viewer.el.querySelector('[data-viewer-action="next"]');
    _bindImageViewerEvents();
    return viewer.el;
  }

  function _openImageViewer(images, startIndex, trigger) {
    if (!Array.isArray(images) || !images.length) return;
    _ensureImageViewer();
    viewer.images = images.filter(function (image) { return image && image.url; });
    if (!viewer.images.length) return;
    viewer.index = Math.max(0, Math.min(Number(startIndex) || 0, viewer.images.length - 1));
    viewer.returnFocus = (trigger instanceof HTMLElement) ? trigger : document.activeElement;
    viewer.open = true;
    viewer.el.hidden = false;
    viewer.el.setAttribute('aria-hidden', 'false');
    viewer.el.classList.add('pl-image-viewer--controls-visible');
    document.documentElement.classList.add('pl-viewer-open');
    document.body.classList.add('pl-viewer-open');
    _hideViewerBackground();
    _renderViewerImage();
    window.requestAnimationFrame(function () {
      viewer.el.classList.add('is-open');
      viewer.closeButton.focus();
    });
  }

  function _renderViewerImage() {
    var item = viewer.images[viewer.index];
    var total = viewer.images.length;
    var filename = item.filename || ('Attachment ' + (viewer.index + 1));
    var hasMultiple = total > 1;
    viewer.gesture = null;
    _resetImageTransform(false);
    viewer.el.classList.add('is-loading');
    viewer.status.textContent = 'Loading image';
    viewer.image.removeAttribute('src');
    viewer.image.alt = filename;
    viewer.title.textContent = filename;
    viewer.counter.textContent = String(viewer.index + 1) + ' / ' + String(total);
    viewer.filename.textContent = filename;
    viewer.prevButton.hidden = !hasMultiple;
    viewer.nextButton.hidden = !hasMultiple;
    viewer.image.src = item.url;
    _preloadAdjacentImages();
  }

  function _showViewerIndex(index) {
    var total = viewer.images.length;
    if (!viewer.open || total === 0) return;
    viewer.index = ((index % total) + total) % total;
    _renderViewerImage();
  }
  function _showPreviousImage() { if (viewer.images.length > 1) _showViewerIndex(viewer.index - 1); }
  function _showNextImage() { if (viewer.images.length > 1) _showViewerIndex(viewer.index + 1); }

  function _closeImageViewer() {
    if (!viewer.open) return;
    viewer.open = false;
    window.clearTimeout(viewer.pendingSingleTap);
    viewer.pendingSingleTap = 0;
    viewer.lastTap = null;
    viewer.gesture = null;
    viewer.el.classList.remove('is-open', 'is-loading', 'has-error', 'pl-image-viewer--controls-visible');
    viewer.el.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('pl-viewer-open');
    document.body.classList.remove('pl-viewer-open');
    _restoreViewerBackground();
    _resetImageTransform(false);
    window.setTimeout(function () {
      if (viewer.open) return;
      viewer.el.hidden = true;
      viewer.image.removeAttribute('src');
      viewer.image.alt = '';
      viewer.status.textContent = '';
      viewer.counter.textContent = '';
      viewer.filename.textContent = '';
    }, 180);
    var returnFocus = viewer.returnFocus;
    viewer.returnFocus = null;
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
  }

  /* ── Transform (zoom) ── */
  function _applyImageTransform(animate) {
    if (animate) viewer.image.classList.add('pl-image-viewer__image--animating');
    else viewer.image.classList.remove('pl-image-viewer__image--animating');
    viewer.image.style.transform = 'translate3d(' + viewer.tx + 'px,' + viewer.ty + 'px,0) scale(' + viewer.scale + ')';
  }
  function _resetImageTransform(animate) {
    viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
    _applyImageTransform(animate);
  }
  function _clampTranslation(scale, x, y) {
    var iw = viewer.image.offsetWidth, ih = viewer.image.offsetHeight;
    var sw = viewer.stage.clientWidth, sh = viewer.stage.clientHeight;
    var maxX = Math.max(0, (iw * scale - sw) / 2);
    var maxY = Math.max(0, (ih * scale - sh) / 2);
    return { x: _vclamp(x, -maxX, maxX), y: _vclamp(y, -maxY, maxY) };
  }
  function _setTransform(scale, x, y, animate) {
    scale = _vclamp(scale, VIEWER_MIN_SCALE, VIEWER_MAX_SCALE);
    if (scale === VIEWER_MIN_SCALE) { x = 0; y = 0; }
    else { var c = _clampTranslation(scale, x, y); x = c.x; y = c.y; }
    viewer.scale = scale; viewer.tx = x; viewer.ty = y;
    _applyImageTransform(animate);
  }

  /* ── Controls toggle + double-tap zoom ── */
  function _toggleControls(force) {
    var visible = typeof force === 'boolean' ? force : !viewer.el.classList.contains('pl-image-viewer--controls-visible');
    viewer.el.classList.toggle('pl-image-viewer--controls-visible', visible);
  }
  function _toggleDoubleTapZoom(clientX, clientY) {
    var nextScale = viewer.scale > VIEWER_MIN_SCALE ? VIEWER_MIN_SCALE : VIEWER_DOUBLE_TAP_SCALE;
    if (nextScale === VIEWER_MIN_SCALE) { _resetImageTransform(true); return; }
    var rect = viewer.stage.getBoundingClientRect();
    var tapX = clientX - rect.left, tapY = clientY - rect.top;
    var ox = viewer.stage.clientWidth / 2, oy = viewer.stage.clientHeight / 2;
    var ratio = nextScale / viewer.scale;
    var nextX = tapX - ox - ratio * (tapX - ox - viewer.tx);
    var nextY = tapY - oy - ratio * (tapY - oy - viewer.ty);
    _setTransform(nextScale, nextX, nextY, true);
  }
  function _scheduleImageTap(clientX, clientY) {
    var now = performance.now();
    if (viewer.lastTap && (now - viewer.lastTap.time <= VIEWER_DOUBLE_TAP_MS) && (Math.hypot(clientX - viewer.lastTap.x, clientY - viewer.lastTap.y) <= VIEWER_DOUBLE_TAP_DISTANCE)) {
      window.clearTimeout(viewer.pendingSingleTap);
      viewer.pendingSingleTap = 0;
      viewer.lastTap = null;
      _toggleDoubleTapZoom(clientX, clientY);
      return;
    }
    viewer.lastTap = { time: now, x: clientX, y: clientY };
    window.clearTimeout(viewer.pendingSingleTap);
    viewer.pendingSingleTap = window.setTimeout(function () {
      viewer.pendingSingleTap = 0;
      viewer.lastTap = null;
      _toggleControls();
    }, VIEWER_DOUBLE_TAP_MS);
  }

  /* ── Pinch / swipe gesture state machine ── */
  function _vpoint(t) { return { x: t.clientX, y: t.clientY }; }
  function _vdistance(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }
  function _vcentroid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
  function _beginPinch(first, second) {
    var rect = viewer.stage.getBoundingClientRect();
    var c = _vcentroid(first, second);
    viewer.gesture = {
      mode: 'pinch',
      startDistance: Math.max(1, _vdistance(first, second)),
      startScale: viewer.scale,
      startX: viewer.tx, startY: viewer.ty,
      startCenter: { x: c.x - rect.left, y: c.y - rect.top }
    };
  }
  function _onImageTouchStart(event) {
    var touches = event.targetTouches;
    if (touches.length === 1 && !viewer.gesture) {
      var p = _vpoint(touches[0]);
      viewer.gesture = { mode: 'swipe', startTime: performance.now(), startX: p.x, startY: p.y, lastX: p.x, lastY: p.y };
      return;
    }
    if (touches.length >= 2) { _beginPinch(touches[0], touches[1]); event.preventDefault(); }
  }
  function _onImageTouchMove(event) {
    if (!viewer.gesture) return;
    var touches = event.targetTouches;
    if (viewer.gesture.mode === 'swipe') {
      if (touches.length >= 2) { _beginPinch(touches[0], touches[1]); event.preventDefault(); return; }
      if (touches.length !== 1) return;
      if (viewer.scale > VIEWER_MIN_SCALE) {
        // Zoomed in: one finger pans the image instead of navigating.
        var dx = touches[0].clientX - viewer.gesture.lastX;
        var dy = touches[0].clientY - viewer.gesture.lastY;
        viewer.gesture.lastX = touches[0].clientX;
        viewer.gesture.lastY = touches[0].clientY;
        viewer.gesture.mode = 'pan';
        _setTransform(viewer.scale, viewer.tx + dx, viewer.ty + dy, false);
        event.preventDefault();
        return;
      }
      viewer.gesture.lastX = touches[0].clientX;
      viewer.gesture.lastY = touches[0].clientY;
      event.preventDefault();
      return;
    }
    if (viewer.gesture.mode === 'pan') {
      if (touches.length >= 2) { _beginPinch(touches[0], touches[1]); event.preventDefault(); return; }
      if (touches.length !== 1) return;
      var pdx = touches[0].clientX - viewer.gesture.lastX;
      var pdy = touches[0].clientY - viewer.gesture.lastY;
      viewer.gesture.lastX = touches[0].clientX;
      viewer.gesture.lastY = touches[0].clientY;
      _setTransform(viewer.scale, viewer.tx + pdx, viewer.ty + pdy, false);
      event.preventDefault();
      return;
    }
    if (viewer.gesture.mode === 'pinch') {
      if (touches.length < 2) { viewer.gesture.mode = 'pinch-wait'; event.preventDefault(); return; }
      var rect = viewer.stage.getBoundingClientRect();
      var cc = _vcentroid(touches[0], touches[1]);
      var currentCenter = { x: cc.x - rect.left, y: cc.y - rect.top };
      var rawScale = viewer.gesture.startScale * _vdistance(touches[0], touches[1]) / viewer.gesture.startDistance;
      var nextScale = _vclamp(rawScale, VIEWER_MIN_SCALE, VIEWER_MAX_SCALE);
      var ratio = nextScale / viewer.gesture.startScale;
      var ox = viewer.stage.clientWidth / 2, oy = viewer.stage.clientHeight / 2;
      var nextX = currentCenter.x - ox - ratio * (viewer.gesture.startCenter.x - ox - viewer.gesture.startX);
      var nextY = currentCenter.y - oy - ratio * (viewer.gesture.startCenter.y - oy - viewer.gesture.startY);
      _setTransform(nextScale, nextX, nextY, false);
      event.preventDefault();
      return;
    }
    if (viewer.gesture.mode === 'pinch-wait') event.preventDefault();
  }
  function _onImageTouchEnd(event) {
    if (!viewer.gesture) return;
    var remaining = event.targetTouches.length;
    if (viewer.gesture.mode === 'pinch') {
      if (remaining > 0) { viewer.gesture.mode = 'pinch-wait'; event.preventDefault(); return; }
      viewer.gesture = null;
      viewer.suppressClickUntil = Date.now() + 400;
      _setTransform(viewer.scale, viewer.tx, viewer.ty, true);
      return;
    }
    if (viewer.gesture.mode === 'pinch-wait') {
      if (remaining === 0) { viewer.gesture = null; viewer.suppressClickUntil = Date.now() + 400; _setTransform(viewer.scale, viewer.tx, viewer.ty, true); }
      event.preventDefault();
      return;
    }
    if (viewer.gesture.mode === 'pan') {
      viewer.gesture = null;
      viewer.suppressClickUntil = Date.now() + 400;
      _setTransform(viewer.scale, viewer.tx, viewer.ty, false);
      event.preventDefault();
      return;
    }
    if (viewer.gesture.mode === 'swipe') {
      if (remaining > 0) return;
      var changed = event.changedTouches[0];
      var endX = changed ? changed.clientX : viewer.gesture.lastX;
      var endY = changed ? changed.clientY : viewer.gesture.lastY;
      var dx = endX - viewer.gesture.startX;
      var dy = endY - viewer.gesture.startY;
      var elapsed = performance.now() - viewer.gesture.startTime;
      viewer.gesture = null;
      viewer.suppressClickUntil = Date.now() + 400;
      if (Math.abs(dx) < VIEWER_TAP_MOVE_THRESHOLD && Math.abs(dy) < VIEWER_TAP_MOVE_THRESHOLD && elapsed <= VIEWER_TAP_MAX_MS) {
        _scheduleImageTap(endX, endY);
        event.preventDefault();
        return;
      }
      if (Math.abs(dx) >= VIEWER_SWIPE_THRESHOLD && Math.abs(dx) >= Math.abs(dy) * VIEWER_AXIS_RATIO) {
        if (dx < 0) _showNextImage(); else _showPreviousImage();
        event.preventDefault();
        return;
      }
      if (Math.abs(dy) >= VIEWER_SWIPE_THRESHOLD && Math.abs(dy) >= Math.abs(dx) * VIEWER_AXIS_RATIO) {
        _closeImageViewer();
        event.preventDefault();
      }
    }
  }
  function _onImageTouchCancel() {
    viewer.gesture = null;
    viewer.suppressClickUntil = Date.now() + 400;
    _setTransform(viewer.scale, viewer.tx, viewer.ty, true);
  }

  /* ── Download ── */
  function _sanitizeFilename(value) {
    return String(value || 'attachment').replace(/[/\\?%*:|"<>]/g, '_').replace(/[\u0000-\u001F\u007F]/g, '').trim() || 'attachment';
  }
  function _downloadAttachment(url, filename) {
    var resolved = new URL(url, window.location.href);
    var name = _sanitizeFilename(filename);
    if (resolved.origin === window.location.origin) {
      var a = document.createElement('a');
      a.href = resolved.href; a.download = name; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      return Promise.resolve();
    }
    return fetch(resolved.href, { method: 'GET', credentials: 'include', headers: { Accept: 'image/*,application/octet-stream' } }).then(function (response) {
      if (!response.ok) throw new Error('Download failed: HTTP ' + response.status);
      return response.blob();
    }).then(function (blob) {
      var objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl; a.download = name; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 30000);
    });
  }

  function _bindImageViewerEvents() {
    viewer.el.addEventListener('click', function (event) {
      if (!viewer.open) return;
      if (Date.now() < viewer.suppressClickUntil) { event.preventDefault(); return; }
      var actionElement = event.target.closest('[data-viewer-action]');
      if (actionElement) {
        var action = actionElement.getAttribute('data-viewer-action');
        if (action === 'close') _closeImageViewer();
        else if (action === 'prev') _showPreviousImage();
        else if (action === 'next') _showNextImage();
        else if (action === 'download') {
          var item = viewer.images[viewer.index];
          if (item) {
            viewer.downloadButton.disabled = true;
            _downloadAttachment(item.url, item.filename).catch(function () { viewer.status.textContent = 'Unable to download'; }).then(function () { viewer.downloadButton.disabled = false; });
          }
        }
        return;
      }
      if (event.target === viewer.image) {
        event.stopPropagation();
        _scheduleImageTap(event.clientX, event.clientY);
        return;
      }
      if (event.target === viewer.canvasEl || event.target === viewer.stage) _closeImageViewer();
    });
    viewer.image.addEventListener('touchstart', _onImageTouchStart, { passive: false });
    viewer.image.addEventListener('touchmove', _onImageTouchMove, { passive: false });
    viewer.image.addEventListener('touchend', _onImageTouchEnd, { passive: false });
    viewer.image.addEventListener('touchcancel', _onImageTouchCancel, { passive: false });
    document.addEventListener('keydown', _onViewerKeyDown);
    viewer.image.addEventListener('load', function () { viewer.el.classList.remove('is-loading', 'has-error'); viewer.status.textContent = ''; });
    viewer.image.addEventListener('error', function () { viewer.el.classList.remove('is-loading'); viewer.el.classList.add('has-error'); viewer.status.textContent = 'Image could not be loaded'; });
    viewer.image.addEventListener('transitionend', function () { viewer.image.classList.remove('pl-image-viewer__image--animating'); });
    window.addEventListener('resize', function () { if (viewer.open) _setTransform(viewer.scale, viewer.tx, viewer.ty, false); });
  }

  function _onViewerKeyDown(event) {
    if (!viewer.open) return;
    if (event.key === 'Escape') { event.preventDefault(); _closeImageViewer(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); _showPreviousImage(); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); _showNextImage(); return; }
    if (event.key === 'Tab') _trapViewerFocus(event);
  }

  function _trapViewerFocus(event) {
    var focusable = Array.prototype.slice.call(viewer.el.querySelectorAll('button:not([hidden]):not([disabled]), [href]:not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])')).filter(function (element) { return element.getClientRects().length > 0; });
    if (!focusable.length) { event.preventDefault(); viewer.closeButton.focus(); return; }
    var first = focusable[0], last = focusable[focusable.length - 1], active = document.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    else if (!viewer.el.contains(active)) { event.preventDefault(); first.focus(); }
  }

  function _hideViewerBackground() {
    viewer.backgroundState = [];
    Array.prototype.forEach.call(document.body.children, function (element) {
      if (element === viewer.el || element.tagName === 'SCRIPT') return;
      viewer.backgroundState.push({ element: element, hadAriaHidden: element.hasAttribute('aria-hidden'), hadInert: element.hasAttribute('inert') });
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    });
  }
  function _restoreViewerBackground() {
    viewer.backgroundState.forEach(function (state) {
      if (!state.element.isConnected) return;
      if (state.hadAriaHidden) state.element.setAttribute('aria-hidden', 'true'); else state.element.removeAttribute('aria-hidden');
      if (state.hadInert) state.element.setAttribute('inert', ''); else state.element.removeAttribute('inert');
    });
    viewer.backgroundState = [];
  }

  function _preloadAdjacentImages() {
    var total = viewer.images.length;
    if (total < 2) return;
    var indexes = [(viewer.index - 1 + total) % total, (viewer.index + 1) % total];
    var seen = Object.create(null);
    indexes.forEach(function (index) {
      var url = viewer.images[index].url;
      if (!url || seen[url]) return;
      seen[url] = true;
      var preload = new Image();
      preload.decoding = 'async';
      preload.src = url;
    });
  }

  global.AlignPunchlist = Object.freeze({
    render: render,
    createNewList: createNewList,
    handleBack: handleBack,
    CATEGORY: CATEGORY
  });
  if (window.TileRegistry) window.TileRegistry.register({id:'punchlist', title:'Punchlist', icon:'/', route:'punchlist', roles:['user','admin'], order:2});
})(window);

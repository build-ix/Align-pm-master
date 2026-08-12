/* align-punchlist.js — Two-step punchlist lists and items */
(function (global) {
  'use strict';

  function A() { return window.AlignAuth; }
  var CATEGORY = 'punchlist';
  var STATUSES = ['open', 'in_progress', 'resolved', 'verified'];
  var PRIORITIES = ['low', 'medium', 'high', 'critical'];
  var state = {
    container: null, projectId: null,
    apartments: [],
    lists: [], activeList: null,
    editingList: null, editingItem: null,
    activeApt: null, detailItem: null,
    viewMode: 'lists', // lists | list-form | list | item-form | detail | profile-edit
    items: []
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
  function notifyError(error) { 
    var msg = error && error.message ? error.message : 'Something went wrong.';
    console.error('[PUNCHLIST]', msg, error);
    alert(msg);
  }

  function render(container) {
    state.container = container;
    state.viewMode = 'lists'; state.activeList = null; state.editingList = null; state.editingItem = null;
    resolveProject();
    _paint();
  }

  function _paint() {
    resolveProject();
    if (!state.container) return;
    if (!state.projectId) {
      state.container.innerHTML = '<div class="pl-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
      return;
    }
    if (state.viewMode === 'list-form') { state.container.innerHTML = _listFormHtml(); _bindListForm(); return; }
    if (state.viewMode === 'item-form') { state.container.innerHTML = _itemFormHtml(); _bindItemForm(); return; }
    if (state.viewMode === 'detail' && state.detailItem) { state.container.innerHTML = _detailHtml(state.detailItem); _bindDetail(); return; }
    if (state.viewMode === 'list' && state.activeList) { state.container.innerHTML = _listHtml(); _bindList(); return; }
    _loadLists();
  }

  function _loadLists() {
    state.container.innerHTML = '<div class="pl-empty">Loading punchlist lists…</div>';
    var url = projectPath();
    console.log('[PUNCHLIST] Loading lists from:', url);
    api(url).then(function (data) {
      console.log('[PUNCHLIST] Lists loaded:', data);
      state.lists = data.lists || [];
      if (state.viewMode === 'lists') { state.container.innerHTML = _listsHtml(); _bindLists(); }
    }).catch(notifyError);
  }

  /* Lists are the first-level tiles. Apartment labels are metadata, never implicit grouping. */
  function _listsHtml() {
    var h = ['<div class="pl-wrap"><div class="pl-titleblock"><h2>Punchlist Lists</h2><button class="pl-new-list-btn" id="pl-new-list">+ Create List</button></div>'];
    if (!state.lists.length) h.push('<div class="pl-empty">No punchlist lists yet. Create a list to get started.</div>');
    h.push('<div class="pl-apt-grid pl-list-grid">');
    state.lists.forEach(function (list) {
      h.push('<div class="pl-apt-tile pl-list-tile" data-pl-list="' + esc(list.id) + '">');
      h.push('<div class="pl-apt-name">' + esc(list.name) + '</div>');
      if (list.apartment_label) h.push('<div class="pl-apt-info">Apartment: ' + esc(list.apartment_label) + '</div>');
      h.push('<div class="pl-apt-info"><span>' + (list.item_count || 0) + ' item' + ((list.item_count || 0) === 1 ? '' : 's') + '</span><span class="pl-item-status" style="background:' + statusColor(list.status === 'archived' ? 'resolved' : list.status) + '">' + esc(list.status || 'open') + '</span></div>');
      if (list.description) h.push('<div class="pl-item-meta">' + esc(list.description) + '</div>');
      h.push('</div>');
    });
    h.push('</div></div>');
    return h.join('');
  }
  function _bindLists() {
    state.container.addEventListener('click', function (event) {
      if (event.target.closest('#pl-new-list')) { state.editingList = {}; state.viewMode = 'list-form'; _paint(); return; }
      var tile = event.target.closest('[data-pl-list]');
      if (!tile) return;
      state.activeList = state.lists.find(function (l) { return l.id === tile.getAttribute('data-pl-list'); }) || null;
      if (state.activeList) { state.viewMode = 'list'; _loadListItems(); }
    });
  }

  function _loadListItems() {
    state.container.innerHTML = '<div class="pl-empty">Loading list…</div>';
    api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/items')).then(function (data) {
      state.items = data.items || [];
      if (state.viewMode === 'list') { state.container.innerHTML = _listHtml(); _bindList(); }
    }).catch(notifyError);
  }
  function _listHtml() {
    var list = state.activeList, h = [];
    h.push('<div class="pl-wrap"><div class="pl-apt-nav"><button class="pm-btn small" id="pl-lists-back">← All Lists</button><div class="pl-apt-nav-center"><h3 class="pl-apt-nav-title">' + esc(list.name) + '</h3><span class="pl-apt-nav-count">' + state.items.length + ' item' + (state.items.length === 1 ? '' : 's') + '</span></div><button class="pm-btn small" id="pl-edit-list">Edit List</button><button class="pm-btn primary" id="pl-new-item">+ Add Item</button></div>');
    if (list.apartment_label) h.push('<div class="pl-detail-section">Apartment: <strong>' + esc(list.apartment_label) + '</strong></div>');
    if (list.description) h.push('<div class="pl-detail-section pl-detail-desc">' + esc(list.description) + '</div>');
    if (!state.items.length) h.push('<div class="pl-empty">No items yet — tap + Add Item above.</div>');
    else {
      h.push('<div class="pl-items">');
      state.items.forEach(function (item, index) {
        h.push('<div class="pl-item-row" data-pl-item="' + esc(item.id) + '"><div class="pl-item-info"><div class="pl-item-title">' + esc(item.title || 'Untitled') + '</div><div class="pl-item-meta">' + esc(item.location || '') + (item.trade ? ' • ' + esc(item.trade) : '') + ' • Item #' + String(index + 1).padStart(3, '0') + '</div></div><div class="pl-item-right"><span class="pl-item-status" style="background:' + statusColor(item.status) + '">' + statusLabel(item.status) + '</span><button class="pm-btn small" data-pl-act="edit-item" data-pl-id="' + esc(item.id) + '">Edit</button><button class="pm-btn small danger" data-pl-act="delete-item" data-pl-id="' + esc(item.id) + '">✕</button></div></div>');
      });
      h.push('</div>');
    }
    h.push('</div>'); return h.join('');
  }
  function _bindList() {
    state.container.addEventListener('click', function (event) {
      if (event.target.closest('#pl-lists-back')) { state.activeList = null; state.viewMode = 'lists'; _loadLists(); return; }
      if (event.target.closest('#pl-edit-list')) { state.editingList = JSON.parse(JSON.stringify(state.activeList)); state.viewMode = 'list-form'; _paint(); return; }
      if (event.target.closest('#pl-new-item')) { state.editingItem = {}; state.viewMode = 'item-form'; _paint(); return; }
      var action = event.target.closest('[data-pl-act]');
      if (action) {
        var id = action.getAttribute('data-pl-id');
        if (action.getAttribute('data-pl-act') === 'edit-item') { state.editingItem = JSON.parse(JSON.stringify(state.items.find(function (i) { return i.id === id; }) || {})); state.viewMode = 'item-form'; _paint(); }
        if (action.getAttribute('data-pl-act') === 'delete-item' && confirm('Delete this item?')) api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/items/' + encodeURIComponent(id)), {method:'DELETE'}).then(_loadListItems).catch(notifyError);
        return;
      }
      var row = event.target.closest('[data-pl-item]');
      if (row) { state.detailItem = state.items.find(function (i) { return i.id === row.getAttribute('data-pl-item'); }) || null; if (state.detailItem) { state.viewMode = 'detail'; _paint(); } }
    });
  }

  /* Dedicated list form: no priority, images, location, or trade controls. */
  function _listFormHtml() {
    var list = state.editingList || {};
    return '<div class="pl-form-wrap pl-list-form" data-form="list-form"><div class="pl-form-header"><button class="pm-btn" id="pl-list-form-back">← Cancel</button><h3 class="pl-form-title">' + (list.id ? 'Edit List' : 'Create List') + '</h3><button class="pm-btn primary" id="pl-list-form-save">Save</button></div><div class="pl-form-section"><label class="pl-field-label">Name</label><input class="pl-input" id="pl-list-name" value="' + esc(list.name) + '" required></div><div class="pl-form-section"><label class="pl-field-label">Description</label><textarea class="pl-input" id="pl-list-description" rows="3">' + esc(list.description) + '</textarea></div><div class="pl-form-row pl-form-row-2"><div class="pl-form-field"><label class="pl-field-label">Apartment Label</label><input class="pl-input" id="pl-list-apartment-label" value="' + esc(list.apartment_label) + '" placeholder="e.g. Apt 3A"></div><div class="pl-form-field"><label class="pl-field-label">Scope</label><select class="pl-input" id="pl-list-scope"><option value="apartment"' + (list.scope_type !== 'project' ? ' selected' : '') + '>Apartment</option><option value="project"' + (list.scope_type === 'project' ? ' selected' : '') + '>Project</option></select></div></div><div class="pl-form-section"><label class="pl-field-label">Status</label><select class="pl-input" id="pl-list-status"><option value="open"' + (list.status !== 'archived' ? ' selected' : '') + '>Open</option><option value="archived"' + (list.status === 'archived' ? ' selected' : '') + '>Archived</option></select></div></div>';
  }
  function _bindListForm() {
    document.getElementById('pl-list-form-back').addEventListener('click', function () { state.editingList = null; state.viewMode = state.activeList ? 'list' : 'lists'; if (state.activeList) _loadListItems(); else _loadLists(); });
    document.getElementById('pl-list-form-save').addEventListener('click', function () {
      var name = document.getElementById('pl-list-name').value.trim(), scope = document.getElementById('pl-list-scope').value, label = document.getElementById('pl-list-apartment-label').value.trim();
      if (!name || (scope === 'apartment' && !label)) { alert('Name is required; apartment scope requires an apartment label.'); return; }
      var payload = {name:name, description:document.getElementById('pl-list-description').value.trim(), apartment_label:label, scope_type:scope, status:document.getElementById('pl-list-status').value};
      var request = state.editingList.id ? api(projectPath('/' + encodeURIComponent(state.editingList.id)), {method:'PATCH', body:JSON.stringify(payload)}) : api(projectPath(), {method:'POST', body:JSON.stringify(payload)});
      request.then(function (data) { state.activeList = data.list || state.activeList; state.editingList = null; state.viewMode = state.activeList ? 'list' : 'lists'; if (state.activeList) _loadListItems(); else _loadLists(); }).catch(notifyError);
    });
  }

  /* Dedicated item form: no name, description, apartment, scope, or list controls. */
  function _itemFormHtml() {
    var item = state.editingItem || {};
    return '<div class="pl-form-wrap pl-item-form" data-form="item-form"><div class="pl-form-header"><button class="pm-btn" id="pl-item-form-back">← Back</button><h3 class="pl-form-title">' + (item.id ? 'Edit Item' : 'Create Item') + '</h3><button class="pm-btn primary" id="pl-item-form-save">Save</button></div><div class="pl-form-section"><label class="pl-field-label">Title</label><input class="pl-input" id="pl-item-title" value="' + esc(item.title) + '" required></div><div class="pl-form-row pl-form-row-2"><div class="pl-form-field"><label class="pl-field-label">Location</label><input class="pl-input" id="pl-item-location" value="' + esc(item.location) + '"></div><div class="pl-form-field"><label class="pl-field-label">Trade</label><input class="pl-input" id="pl-item-trade" value="' + esc(item.trade) + '"></div></div><div class="pl-form-row pl-form-row-2"><div class="pl-form-field"><label class="pl-field-label">Priority</label><select class="pl-input" id="pl-item-priority">' + PRIORITIES.map(function (p) { return '<option value="' + p + '"' + (item.priority === p || (!item.priority && p === 'medium') ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; }).join('') + '</select></div><div class="pl-form-field"><label class="pl-field-label">Status</label><select class="pl-input" id="pl-item-status">' + STATUSES.map(function (s) { return '<option value="' + s + '"' + (item.status === s || (!item.status && s === 'open') ? ' selected' : '') + '>' + statusLabel(s) + '</option>'; }).join('') + '</select></div></div><div class="pl-form-section"><label class="pl-field-label">Images</label><div class="pl-image-upload"><button type="button" class="pl-upload-btn" id="pl-upload-camera">Camera</button><button type="button" class="pl-upload-btn" id="pl-upload-album">Album</button></div><div id="pl-images-preview" class="pl-images-preview"></div><input type="file" id="pl-file-input" accept="image/*" style="display:none" multiple></div></div>';
  }
  function _bindItemForm() {
    document.getElementById('pl-item-form-back').addEventListener('click', function () { state.editingItem = null; state.viewMode = 'list'; _loadListItems(); });
    var input = document.getElementById('pl-file-input');
    function choose(capture) { input.capture = capture || ''; input.click(); }
    document.getElementById('pl-upload-camera').addEventListener('click', function () { choose('environment'); });
    document.getElementById('pl-upload-album').addEventListener('click', function () { choose(''); });
    input.addEventListener('change', function () { Array.prototype.forEach.call(input.files || [], _addImage); });
    document.getElementById('pl-item-form-save').addEventListener('click', function () {
      var title = document.getElementById('pl-item-title').value.trim();
      if (!title) { alert('Title is required.'); return; }
      var payload = {title:title, location:document.getElementById('pl-item-location').value.trim(), priority:document.getElementById('pl-item-priority').value, trade:document.getElementById('pl-item-trade').value.trim(), status:document.getElementById('pl-item-status').value, images:state.editingItem.images || []};
      var base = projectPath('/' + encodeURIComponent(state.activeList.id) + '/items');
      var request = state.editingItem.id ? api(base + '/' + encodeURIComponent(state.editingItem.id), {method:'PATCH', body:JSON.stringify(payload)}) : api(base, {method:'POST', body:JSON.stringify(payload)});
      request.then(function () { state.editingItem = null; state.viewMode = 'list'; _loadListItems(); }).catch(notifyError);
    });
    (state.editingItem.images || []).forEach(function (image) { _showImage(image); });
  }
  function _addImage(file) { var reader = new FileReader(); reader.onload = function (event) { var image = {id:uid(), data:event.target.result, timestamp:nowISO()}; if (!state.editingItem.images) state.editingItem.images = []; state.editingItem.images.push(image); _showImage(image); }; reader.readAsDataURL(file); }
  function _showImage(image) { var preview = document.getElementById('pl-images-preview'); if (!preview) return; var thumb = document.createElement('div'); thumb.className = 'pl-image-thumb'; thumb.style.backgroundImage = 'url(' + image.data + ')'; thumb.title = 'Click to remove'; thumb.onclick = function () { state.editingItem.images = (state.editingItem.images || []).filter(function (i) { return i.id !== image.id; }); thumb.remove(); }; preview.appendChild(thumb); }

  function _detailHtml(item) { return '<div class="pl-detail-wrap"><div class="pl-detail-header"><button class="pm-btn" id="pl-detail-back">← Back</button><h3 class="pl-detail-title">' + esc(item.title || 'Untitled') + '</h3><button class="pm-btn primary" id="pl-detail-edit">Edit</button></div><div class="pl-detail-section"><span class="pl-detail-status-badge" style="background:' + statusColor(item.status) + '">' + statusLabel(item.status) + '</span> <span class="pl-priority-badge">' + esc(item.priority || '') + '</span></div><div class="pl-detail-section"><span class="pl-detail-label">Location</span><div class="pl-detail-value">' + esc(item.location || '—') + '</div></div><div class="pl-detail-section"><span class="pl-detail-label">Trade</span><div class="pl-detail-value">' + esc(item.trade || '—') + '</div></div></div>'; }
  function _bindDetail() {
    document.getElementById('pl-detail-back').addEventListener('click', function () { state.detailItem = null; state.viewMode = 'list'; _loadListItems(); });
    document.getElementById('pl-detail-edit').addEventListener('click', function () { state.editingItem = JSON.parse(JSON.stringify(state.detailItem)); state.viewMode = 'item-form'; _paint(); });
  }

  global.AlignPunchlist = Object.freeze({render: render, CATEGORY: CATEGORY});
  if (window.TileRegistry) window.TileRegistry.register({id:'punchlist', title:'Punchlist', icon:'/', route:'punchlist', roles:['user','admin'], order:2});
})(window);

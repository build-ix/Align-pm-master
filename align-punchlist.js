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
    items: [], allItems: [], listItems: {}
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

  function render(container) {
    state.container = container;
    state.viewMode = 'lists'; state.activeList = null; state.editingList = null; state.editingItem = null;
    state.lists = []; state.items = []; state.allItems = []; state.listItems = {}; state.detailItem = null; // Reset all data on re-render
    resolveProject();
    _bindContainer();
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
    if (state.viewMode === 'list' && state.activeList) { state.container.innerHTML = _listHtml(); return; }
    _loadLists();
  }

  function _loadLists() {
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
    state.container.innerHTML = '<div class="pl-empty">Loading list…</div>';
    api(projectPath('/' + encodeURIComponent(state.activeList.id) + '/items')).then(function (data) {
      state.items = data.items || [];
      if (state.viewMode === 'list') { state.container.innerHTML = _listHtml(); }
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
        h.push('<div class="pl-item-row" data-pl-item="' + esc(item.id) + '"><div class="pl-item-info"><div class="pl-item-title">' + esc(item.title || 'Untitled') + '</div><div class="pl-item-meta">' + esc(item.location || '') + (item.trade ? ' • ' + esc(item.trade) : '') + ' • Item #' + String(index + 1).padStart(3, '0') + '</div></div><div class="pl-item-right"><span class="pl-item-status" style="background:' + statusColor(item.status) + '">' + statusLabel(item.status) + '</span><div class="pl-item-actions"><button type="button" class="pm-btn small" data-pl-act="edit-item" data-pl-id="' + esc(item.id) + '">Edit</button><button type="button" class="pm-btn small danger" data-pl-act="delete-item" data-pl-id="' + esc(item.id) + '">✕</button></div></div></div>');
      });
      h.push('</div>');
    }
    h.push('</div>'); return h.join('');
  }
  function _handleListClick(event) {
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
  }

  function _onContainerClick(event) {
    if (state.viewMode === 'lists') { _handleListsClick(event); return; }
    if (state.viewMode === 'list') { _handleListClick(event); return; }
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
    return '<div class="pl-form-wrap pl-list-form" data-form="list-form"><div class="pl-form-header"><button class="pm-btn" id="pl-list-form-back">← Cancel</button><h3 class="pl-form-title">' + (list.id ? 'Edit List' : 'Create List') + '</h3><div class="pl-form-actions"><button class="pm-btn primary" id="pl-list-form-save" type="button">Save</button>' + deleteBtn + '</div></div><div class="pl-form-section"><label class="pl-field-label" for="pl-list-name">Name</label><input class="pl-input" id="pl-list-name" value="' + esc(list.name) + '" maxlength="120" required></div><div class="pl-form-section"><span class="pl-field-label">Privacy</span><div class="pl-privacy-options" role="radiogroup" aria-label="Privacy"><label class="pl-privacy-option"><input type="radio" name="pl-list-privacy" value="private"' + (privacy === 'private' ? ' checked' : '') + '> <span>Private</span></label><label class="pl-privacy-option"><input type="radio" name="pl-list-privacy" value="public"' + (privacy === 'public' ? ' checked' : '') + '> <span>Public</span></label></div></div></div>';
  }
  function _bindListForm() {
    document.getElementById('pl-list-form-back').addEventListener('click', function () { state.editingList = null; state.viewMode = state.activeList ? 'list' : 'lists'; if (state.activeList) _loadListItems(); else _loadLists(); });
    var saveButton = document.getElementById('pl-list-form-save'), submitting = false;
    saveButton.addEventListener('click', function () {
      if (submitting) return;
      var name = document.getElementById('pl-list-name').value.trim();
      var privacyInput = document.querySelector('input[name="pl-list-privacy"]:checked');
      var privacy = privacyInput ? privacyInput.value : '';
      if (!name) { alert('Name is required.'); return; }
      if (name.length > 120) { alert('Name must be 120 characters or fewer.'); return; }
      if (privacy !== 'private' && privacy !== 'public') { alert('Privacy must be private or public.'); return; }
      var payload = {name:name, privacy:privacy, scope_type:'project', status:'open'};
      submitting = true;
      saveButton.disabled = true;
      saveButton.setAttribute('aria-disabled', 'true');
      saveButton.setAttribute('aria-busy', 'true');
      var request = state.editingList.id ? api(projectPath('/' + encodeURIComponent(state.editingList.id)), {method:'PATCH', body:JSON.stringify(payload)}) : api(projectPath(), {method:'POST', body:JSON.stringify(payload)});
      request.then(function (data) { state.activeList = data.list || state.activeList; state.editingList = null; state.viewMode = state.activeList ? 'list' : 'lists'; if (state.activeList) _loadListItems(); else _loadLists(); }).catch(function (error) { submitting = false; saveButton.disabled = false; saveButton.removeAttribute('aria-disabled'); saveButton.removeAttribute('aria-busy'); notifyError(error); });
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
    return '<div class="pl-form-wrap pl-item-form" data-form="item-form"><div class="pl-form-header"><button class="pm-btn" id="pl-item-form-back">← Back</button><h3 class="pl-form-title">' + (item.id ? 'Edit Item' : 'Create Item') + '</h3><button class="pm-btn primary" id="pl-item-form-save">Save</button></div><div class="pl-form-section pl-attachments-section"><label class="pl-field-label">Attachments</label><div class="pl-image-upload"><button type="button" class="pl-upload-btn" id="pl-upload-attachments">Attachments</button></div><div id="pl-images-preview" class="pl-images-preview"></div><input type="file" id="pl-file-input" accept="image/*,video/*,.pdf" style="display:none" multiple></div><div class="pl-form-section"><label class="pl-field-label" for="pl-item-title">Title</label><input class="pl-input" id="pl-item-title" value="' + esc(item.title) + '" required></div><div class="pl-form-section"><label class="pl-field-label">Location</label><button type="button" class="pm-btn" id="pl-item-pin-location">Pin Location</button></div><div class="pl-form-section"><label class="pl-field-label" for="pl-item-priority">Priority</label><select class="pl-input" id="pl-item-priority">' + PRIORITIES.map(function (p) { return '<option value="' + p + '"' + (item.priority === p || (!item.priority && p === 'medium') ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; }).join('') + '</select></div></div>';
  }
  function _bindItemForm() {
    document.getElementById('pl-item-form-back').addEventListener('click', function () { state.editingItem = null; state.viewMode = 'list'; _loadListItems(); });
    var input = document.getElementById('pl-file-input');
    document.getElementById('pl-upload-attachments').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { Array.prototype.forEach.call(input.files || [], _addImage); input.value = ''; });
    document.getElementById('pl-item-form-save').addEventListener('click', function () {
      var title = document.getElementById('pl-item-title').value.trim();
      if (!title) { alert('Title is required.'); return; }
      var payload = {title:title, location:state.editingItem.location || '', priority:document.getElementById('pl-item-priority').value, images:state.editingItem.images || []};
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

  global.AlignPunchlist = Object.freeze({
    render: render,
    createNewList: function () { state.editingList = {}; state.viewMode = 'list-form'; _paint(); },
    CATEGORY: CATEGORY
  });
  if (window.TileRegistry) window.TileRegistry.register({id:'punchlist', title:'Punchlist', icon:'/', route:'punchlist', roles:['user','admin'], order:2});
})(window);

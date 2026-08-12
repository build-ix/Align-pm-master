/* align-files.js
 * API-backed file manager — folders, upload, download, delete, preview, trash, drag-drop, bulk ops.
 * Restricted to project admins + server admin.
 */
(function (global) {
  'use strict';

  var _pid, _currentFolder, _breadcrumb, _container;
  var _cache = {};
  var _sortBy = 'name';
  var _viewMode = 'files'; // 'files' | 'trash'
  var _selected = {};      // {id: true} bulk selection
  var _selectAll = false;

  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _fs(size) {
    if (size < 1024) return size + ' B';
    if (size < 1048576) return (size/1024).toFixed(1) + ' KB';
    return (size/1048576).toFixed(1) + ' MB';
  }

  var FOLDER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var DOTS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  var TRASH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  var RESTORE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';

  function _iconSVG(ext) {
    var map = {
      pdf: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      dwg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
      rvt: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/></svg>',
      xls: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
      xlsx: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
      doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      docx: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      png: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      jpg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      jpeg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      gif: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      zip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
      csv: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
      txt: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
    };
    return map[ext] || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }

  // ── API helpers ──────────────────────────────────────────────────────────

  function _authHeaders() {
    var t = null;
    try { t = localStorage.getItem('align-token'); } catch(e) {}
    return { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + (t || '') };
  }

  function _apiGet(path) {
    var h = _authHeaders();
    return fetch(path, { headers: h }).then(function(r) { return r.json(); });
  }

  function _apiPost(path, body) {
    var h = _authHeaders();
    return fetch(path, { method:'POST', headers: h, body: JSON.stringify(body||{}) }).then(function(r) { return r.json(); });
  }

  function _apiDelete(path) {
    var h = _authHeaders();
    return fetch(path, { method:'DELETE', headers: h }).then(function(r) { return r.json(); });
  }

  function _apiPatch(path, body) {
    var h = _authHeaders();
    return fetch(path, { method:'PATCH', headers: h, body: JSON.stringify(body||{}) }).then(function(r) { return r.json(); });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  function render(container, projectId) {
    _pid = projectId;
    _container = container;
    _currentFolder = 'root';
    _breadcrumb = [{ id:'root', name:'Files' }];
    _cache = {};
    _viewMode = 'files';
    _selected = {};
    _selectAll = false;
    _paint();
  }

  function _paint() {
    if (!_container) return;
    _container.innerHTML = _html();
    _bind();
    if (_viewMode === 'trash') {
      _loadTrash();
    } else {
      _loadFolder(_currentFolder);
    }
  }

  function _html() {
    var inTrash = _viewMode === 'trash';
    var bc = '';
    if (!inTrash && _breadcrumb.length > 1) {
      bc = _breadcrumb.map(function(crumb, i) {
        if (i === _breadcrumb.length - 1) return '<span class="fm-crumb fm-crumb-current">' + _esc(crumb.name) + '</span>';
        return '<span class="fm-crumb" data-fm-nav="' + crumb.id + '">' + _esc(crumb.name) + ' \u203a</span>';
      }).join('');
    }
    if (inTrash) {
      bc = '<span class="fm-crumb fm-crumb-current">Trash</span><span class="fm-trash-note">Files deleted in the last 30 days</span>';
    }

    var selCount = Object.values(_selected).filter(Boolean).length;
    var bulkBar = '';
    if (selCount > 0) {
      bulkBar = '<div class="fm-bulk-bar"><span>' + selCount + ' selected</span>'
        + '<button class="pm-btn small" id="fm-bulk-move">Move</button>'
        + (inTrash
          ? '<button class="pm-btn small" id="fm-bulk-restore">Restore</button><button class="pm-btn small danger" id="fm-bulk-delete-forever">Delete Forever</button>'
          : '<button class="pm-btn small danger" id="fm-bulk-delete">Delete</button>')
        + '<button class="pm-btn small" id="fm-bulk-clear">Clear</button></div>';
    }

    var trashToggle = inTrash
      ? '<button class="pm-btn small" id="fm-btn-back-files">\u2190 Files</button>'
      : '<button class="pm-btn small" id="fm-btn-trash" title="Trash">' + TRASH_ICON + '</button>';

    return [
      '<div class="fm-toolbar">',
        '<div class="fm-breadcrumb">', bc, '</div>',
      '</div>',
      bulkBar,
      '<div class="fm-actions-bar">',
        '<div class="fm-actions-row1">',
          '<span class="fm-row1-left">',
            trashToggle,
          '</span>',
          '<span class="fm-row1-right">',
            inTrash ? '' : '<button class="pm-btn small" id="fm-btn-newfolder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg> New Folder</button>',
            inTrash ? '' : '<button class="pm-btn primary" id="fm-btn-upload"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload</button>',
          '</span>',
        '</div>',
        '<div class="fm-actions-row2">',
          '<input class="fm-search" id="fm-filter" placeholder="Search files...">',
          '<button class="fm-icon-btn" id="fm-btn-sort" title="Sort"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="16" y2="6"/><line x1="4" y1="12" x2="12" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/></svg></button>',
          '<div class="fm-sort-menu" id="fm-sort-menu" style="display:none;">',
            '<button data-fm-sort="name">Name A-Z</button>',
            '<button data-fm-sort="date">Newest First</button>',
            '<button data-fm-sort="size">Largest First</button>',
            '<button data-fm-sort="type">By Type</button>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="fm-list" id="fm-list"><p style="color:var(--muted);padding:1rem;">Loading...</p></div>',
      '<input type="file" id="fm-file-input" style="display:none" multiple />',
    ].join('');
  }

  // ── Event binding ────────────────────────────────────────────────────────

  function _bind() {
    // Breadcrumb navigation
    var crumbs = _container.querySelectorAll('[data-fm-nav]');
    crumbs.forEach(function(c) {
      c.addEventListener('click', function() { _navigateTo(c.getAttribute('data-fm-nav')); });
    });

    // Upload button
    var upBtn = document.getElementById('fm-btn-upload');
    var fileInput = document.getElementById('fm-file-input');
    if (upBtn && fileInput) {
      upBtn.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function() {
        _uploadFiles(fileInput.files);
        fileInput.value = '';
      });
    }

    // Drag & drop on the list area
    var list = document.getElementById('fm-list');
    if (list && _viewMode === 'files') {
      list.addEventListener('dragover', function(e) { e.preventDefault(); e.stopPropagation(); list.classList.add('fm-dragover'); });
      list.addEventListener('dragleave', function(e) { e.preventDefault(); e.stopPropagation(); list.classList.remove('fm-dragover'); });
      list.addEventListener('drop', function(e) {
        e.preventDefault(); e.stopPropagation();
        list.classList.remove('fm-dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          _uploadFiles(e.dataTransfer.files);
        }
      });
    }

    // Search
    var filterInput = document.getElementById('fm-filter');
    if (filterInput) {
      filterInput.addEventListener('input', function() {
        var q = filterInput.value.toLowerCase();
        document.querySelectorAll('.fm-item').forEach(function(item) {
          var name = (item.getAttribute('data-fm-name') || '').toLowerCase();
          item.style.display = name.indexOf(q) >= 0 ? '' : 'none';
        });
      });
    }

    // Sort
    var sortBtn = document.getElementById('fm-btn-sort');
    var sortMenu = document.getElementById('fm-sort-menu');
    if (sortBtn && sortMenu) {
      sortBtn.addEventListener('click', function(e) { e.stopPropagation(); sortMenu.style.display = sortMenu.style.display === 'none' ? '' : 'none'; });
      sortMenu.querySelectorAll('button').forEach(function(b) {
        b.addEventListener('click', function() { sortMenu.style.display = 'none'; _sortItems(b.getAttribute('data-fm-sort')); });
      });
      document.addEventListener('click', function() { sortMenu.style.display = 'none'; }, { signal: window._sectionSignal });
    }

    // Trash toggle
    var trashBtn = document.getElementById('fm-btn-trash');
    if (trashBtn) trashBtn.addEventListener('click', function() { _viewMode = 'trash'; _selected = {}; _paint(); });
    var backBtn = document.getElementById('fm-btn-back-files');
    if (backBtn) backBtn.addEventListener('click', function() { _viewMode = 'files'; _selected = {}; _paint(); });

    // New folder
    var nfBtn = document.getElementById('fm-btn-newfolder');
    if (nfBtn) {
      nfBtn.addEventListener('click', function() {
        var existing = document.getElementById('fm-newfolder-form');
        if (existing) { existing.remove(); return; }
        var form = document.createElement('div');
        form.id = 'fm-newfolder-form';
        form.className = 'fm-newfolder-form';
        form.innerHTML = '<input class="fm-input" id="fm-newfolder-input" placeholder="Folder name" autofocus><button class="pm-btn small" id="fm-newfolder-create">Create</button><button class="pm-btn small" id="fm-newfolder-cancel">Cancel</button>';
        var toolbar = document.querySelector('.fm-toolbar');
        if (toolbar) toolbar.parentNode.insertBefore(form, toolbar.nextSibling);
        var inp = document.getElementById('fm-newfolder-input');
        if (inp) setTimeout(function() { inp.focus(); }, 100);
        document.getElementById('fm-newfolder-create').addEventListener('click', function() {
          var name = (inp && inp.value || '').trim();
          if (name) _createFolder(name);
          if (form.parentNode) form.remove();
        });
        document.getElementById('fm-newfolder-cancel').addEventListener('click', function() { form.remove(); });
      });
    }

    // Bulk action buttons
    ['fm-bulk-delete','fm-bulk-delete-forever','fm-bulk-restore','fm-bulk-move','fm-bulk-clear'].forEach(function(bid) {
      var b = document.getElementById(bid);
      if (!b) return;
      b.addEventListener('click', function() {
        var ids = Object.keys(_selected).filter(function(k) { return _selected[k]; });
        if (bid === 'fm-bulk-clear') { _selected = {}; _selectAll = false; _paint(); return; }
        if (bid === 'fm-bulk-delete') { _bulkTrash(ids); }
        if (bid === 'fm-bulk-delete-forever') { _bulkDeleteForever(ids); }
        if (bid === 'fm-bulk-restore') { _bulkRestore(ids); }
        if (bid === 'fm-bulk-move') { _showMovePicker(ids, null); }
      });
    });
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  function _navigateTo(folderId) {
    _currentFolder = folderId;
    var idx = -1;
    for (var i = 0; i < _breadcrumb.length; i++) {
      if (_breadcrumb[i].id === folderId) { idx = i; break; }
    }
    if (idx >= 0) _breadcrumb = _breadcrumb.slice(0, idx + 1);
    _selected = {};
    _paint();
  }

  // ── Load & render ────────────────────────────────────────────────────────

  function _loadFolder(folderId) {
    var url = '/api/projects/' + _pid + '/files?folder=' + folderId;
    _apiGet(url).then(function(r) {
      _cache[folderId] = r.files || [];
      _renderList(r.files || []);
    }).catch(function() {
      document.getElementById('fm-list').innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load files.</p>';
    });
  }

  function _loadTrash() {
    _apiGet('/api/projects/' + _pid + '/files?trash=1').then(function(r) {
      _cache['__trash__'] = r.files || [];
      _renderList(r.files || [], true);
    }).catch(function() {
      document.getElementById('fm-list').innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load trash.</p>';
    });
  }

  function _renderList(items, isTrash) {
    var list = document.getElementById('fm-list');
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = '<div class="fm-empty">' + (isTrash ? 'Trash is empty' : 'This folder is empty') + '</div>';
      return;
    }
    // Column guide bar — uses same grid as items, labels placed in matching columns
    var guideHTML = '<div class="fm-col-guide"><span class="fm-check"><input type="checkbox" id="fm-select-all" ' + (_selectAll ? 'checked' : '') + '></span><span></span><span class="fm-col-name">Name</span><span class="fm-col-size">Size</span><span class="fm-col-date">Date</span><span></span></div>';

    var html = guideHTML;
    var folders = items.filter(function(f) { return f.type === 'folder'; });
    var files = items.filter(function(f) { return f.type !== 'folder'; });
    folders.forEach(function(f) { html += _itemHTML(f, isTrash); });
    files.forEach(function(f) { html += _itemHTML(f, isTrash); });
    list.innerHTML = html;
    _bindItems(isTrash);
  }

  function _itemHTML(f, isTrash) {
    var isFolder = f.type === 'folder';
    var ext = (f.original_name || '').split('.').pop().toLowerCase();
    var icon = isFolder ? FOLDER_ICON : _iconSVG(ext);
    var name = _esc(f.original_name || f.filename);
    var size = isFolder ? '' : '<span class="fm-size">' + _fs(f.size_bytes || 0) + '</span>';
    var date = (isTrash ? f.trashed_at : f.created_at) || '';
    if (date) date = date.slice(0,10);
    var checked = _selected[f.id] ? ' checked' : '';

    return [
      '<div class="fm-item' + (isFolder ? ' fm-folder' : '') + (isTrash ? ' fm-trashed' : '') + '" data-fm-id="' + f.id + '" data-fm-type="' + f.type + '" data-fm-name="' + _esc(f.original_name || '') + '" data-fm-size="' + (f.size_bytes || 0) + '" data-fm-folder="' + (f.folder_id || '') + '" data-fm-ext="' + ext + '" data-fm-mime="' + _esc(f.mime_type || '') + '">',
        '<span class="fm-check"><input type="checkbox" class="fm-checkbox" data-fm-id="' + f.id + '"' + checked + '></span>',
        '<span class="fm-icon">' + icon + '</span>',
        '<span class="fm-name">' + name + '</span>',
        size,
        '<span class="fm-date">' + date + '</span>',
        '<span class="fm-actions-inline">',
          '<button class="fm-dots" title="More options">⋮</button>',
        '</span>',
      '</div>'
    ].join('');
  }

  // ── Item bindings ────────────────────────────────────────────────────────

  function _bindItems(isTrash) {
    var list = document.getElementById('fm-list');
    if (!list) return;
    if (list._fmDelegate) list.removeEventListener('click', list._fmDelegate);

    list._fmDelegate = function(e) {
      var t = e.target;

      // Select-all checkbox
      if (t.id === 'fm-select-all') {
        _selectAll = t.checked;
        list.querySelectorAll('.fm-checkbox').forEach(function(cb) {
          var cid = cb.getAttribute('data-fm-id');
          cb.checked = _selectAll;
          if (_selectAll) { _selected[cid] = true; }
          else { delete _selected[cid]; }
        });
        _paint(); return;
      }

      // Individual checkbox
      if (t.classList.contains('fm-checkbox')) {
        var cid = t.getAttribute('data-fm-id');
        if (t.checked) { _selected[cid] = true; }
        else { delete _selected[cid]; }
        _selectAll = false;
        _paint(); return;
      }

      // Menu button (Delete, Rename, etc.)
      var menuBtn = t.closest('.fm-menu button');
      if (menuBtn) {
        e.stopPropagation(); e.preventDefault();
        var act = menuBtn.getAttribute('data-fm-act');
        var menu = menuBtn.closest('.fm-menu');
        var mid = menu ? menu.getAttribute('data-fm-file-id') : '';
        var mname = menu ? menu.getAttribute('data-fm-file-name') : '';
        if (menu && menu.parentNode) menu.remove();
        if (act === 'delete') { _trashItem(mid, mname); return; }
        if (act === 'delete-forever') { _deleteForever(mid, mname); return; }
        if (act === 'restore') { _restoreItem(mid, mname); return; }
        if (act === 'rename') { _renameItem(mid, mname); return; }
        if (act === 'download') { _downloadItem2(mid); return; }
        if (act === 'share') { _shareItem2(mid); return; }
        if (act === 'move') { _showMovePicker([mid], mname); return; }
        if (act === 'preview') { _previewItem2(mid); return; }
        return;
      }

      // Dots button
      if (t.closest('.fm-dots')) {
        e.stopPropagation(); e.preventDefault();
        var open = document.querySelector('.fm-menu');
        if (open) open.remove();
        var item = t.closest('.fm-item');
        if (!item) return;
        var fid = item.getAttribute('data-fm-id');
        var fname = item.getAttribute('data-fm-name');
        var ftype = item.getAttribute('data-fm-type');

        var menu = document.createElement('div');
        menu.className = 'fm-menu';
        menu.setAttribute('data-fm-file-id', fid);
        menu.setAttribute('data-fm-file-name', fname);
        menu.setAttribute('data-fm-file-type', ftype);
        var mi = [];
        if (isTrash) {
          mi.push('<button data-fm-act="restore">' + RESTORE_ICON + ' Restore</button>');
          mi.push('<button data-fm-act="delete-forever" class="fm-menu-danger">Delete Forever</button>');
        } else {
          if (ftype !== 'folder') {
            mi.push('<button data-fm-act="preview">Preview</button>');
            mi.push('<button data-fm-act="download">Download</button>');
            mi.push('<button data-fm-act="share">Copy Link</button>');
          }
          mi.push('<button data-fm-act="rename">Rename</button>');
          mi.push('<button data-fm-act="move">Move</button>');
          mi.push('<button data-fm-act="delete" class="fm-menu-danger">Delete</button>');
        }
        menu.innerHTML = mi.join('');
        var rect = t.closest('.fm-dots').getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.style.zIndex = '9999';
        document.body.appendChild(menu);
        return;
      }

      // Item click (folder nav or file preview)
      if (t.closest('.fm-check') || t.closest('.fm-menu') || t.closest('.fm-dots') || t.tagName === 'INPUT') return;
      var item = t.closest('.fm-item');
      if (!item) return;
      var type = item.getAttribute('data-fm-type');
      var id = item.getAttribute('data-fm-id');
      var name = item.getAttribute('data-fm-name');
      if (type === 'folder') {
        _currentFolder = id;
        _breadcrumb.push({ id: id, name: name });
        _selected = {};
        _paint();
      } else {
        _previewFile(item);
      }
    };

    list.addEventListener('click', list._fmDelegate);

    // Close menu on outside clicks (once)
    if (!list._fmDocHandler) {
      list._fmDocHandler = function(e) {
        if (e.target.closest('.fm-menu') || e.target.closest('.fm-dots')) return;
        var open = document.querySelector('.fm-menu');
        if (open) open.remove();
      };
      document.addEventListener('click', list._fmDocHandler, { signal: window._sectionSignal });
    }
  }

  // ── Trash operations ─────────────────────────────────────────────────────

  function _downloadItem2(id) {
    var t = null;
    try { t = localStorage.getItem('align-token'); } catch(ex) {}
    var a = document.createElement('a');
    a.href = '/api/files/' + id + '?token=' + (t || '');
    a.download = '';
    a.click();
  }
  function _shareItem2(id) {
    var t = null;
    try { t = localStorage.getItem('align-token'); } catch(ex) {}
    var url = window.location.origin + '/api/files/' + id + '?token=' + (t || '');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() { alert('Link copied'); });
    } else {
      prompt('Copy this link:', url);
    }
  }
  function _previewItem2(id) {
    var item = document.querySelector('.fm-item[data-fm-id="' + id + '"]');
    if (item) _previewFile(item);
  }

  function _trashItem(id, name) {
    if (!confirm('Move "' + name + '" to trash?')) return;
    _apiDelete('/api/files/' + id).then(function(r) {
      if (r.error) return alert(r.error);
      if (_viewMode === 'files') _loadFolder(_currentFolder);
      else _loadTrash();
    }).catch(function(e) { alert('Failed to delete: ' + (e.message || 'network error')); });
  }

  function _restoreItem(id, name) {
    _apiPatch('/api/files/' + id + '/restore').then(function(r) {
      if (r.error) return alert(r.error);
      _loadTrash();
    }).catch(function(e) { alert('Failed to restore: ' + (e.message || 'network error')); });
  }

  function _deleteForever(id, name) {
    if (!confirm('Permanently delete "' + name + '"? This cannot be undone.')) return;
    _apiDelete('/api/files/' + id + '?permanent=1').then(function(r) {
      if (r.error) return alert(r.error);
      _loadTrash();
    }).catch(function(e) { alert('Failed to delete: ' + (e.message || 'network error')); });
  }

  function _bulkTrash(ids) {
    if (!confirm('Move ' + ids.length + ' item(s) to trash?')) return;
    var done = 0;
    ids.forEach(function(id) {
      _apiDelete('/api/files/' + id).then(function() { done++; if (done === ids.length) { _selected = {}; _loadFolder(_currentFolder); } });
    });
  }

  function _bulkRestore(ids) {
    var done = 0;
    ids.forEach(function(id) {
      _apiPatch('/api/files/' + id + '/restore').then(function() { done++; if (done === ids.length) { _selected = {}; _loadTrash(); } });
    });
  }

  function _bulkDeleteForever(ids) {
    if (!confirm('Permanently delete ' + ids.length + ' item(s)? This cannot be undone.')) return;
    var done = 0;
    ids.forEach(function(id) {
      _apiDelete('/api/files/' + id + '?permanent=1').then(function() { done++; if (done === ids.length) { _selected = {}; _loadTrash(); } });
    });
  }

  // ── Move (folder picker) ─────────────────────────────────────────────────

  function _showMovePicker(ids, currentName) {
    // Fetch all folders for the project
    _apiGet('/api/projects/' + _pid + '/files?folder=root').then(function(r) {
      var allItems = r.files || [];
      var folders = allItems.filter(function(f) { return f.type === 'folder'; });
      _renderMoveModal(ids, folders);
    });
  }

  function _renderMoveModal(ids, folders) {
    var existing = document.getElementById('fm-move-overlay');
    if (existing) existing.remove();

    var title = ids.length === 1 ? 'Move 1 item' : 'Move ' + ids.length + ' items';
    var folderList = '<div class="fm-move-folder" data-fm-move-to="root"><span class="fm-move-icon">' + FOLDER_ICON + '</span><span>Files (root)</span></div>';
    folders.forEach(function(f) {
      folderList += '<div class="fm-move-folder" data-fm-move-to="' + f.id + '"><span class="fm-move-icon">' + FOLDER_ICON + '</span><span>' + _esc(f.original_name) + '</span></div>';
    });
    if (folders.length === 0) folderList += '<p style="color:var(--muted);padding:12px;">No folders yet. Create one first.</p>';

    var overlay = document.createElement('div');
    overlay.id = 'fm-move-overlay';
    overlay.className = 'fm-move-overlay';
    overlay.innerHTML = '<div class="fm-move-modal"><div class="fm-move-header">' + title + '<button class="fm-move-close">&times;</button></div><div class="fm-move-body">' + folderList + '</div></div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.fm-move-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('[data-fm-move-to]').forEach(function(el) {
      el.addEventListener('click', function() {
        var targetFolder = el.getAttribute('data-fm-move-to');
        var targetId = targetFolder === 'root' ? null : targetFolder;
        var done = 0;
        ids.forEach(function(id) {
          _apiPatch('/api/files/' + id, { folder_id: targetId }).then(function() {
            done++;
            if (done === ids.length) {
              overlay.remove();
              _selected = {};
              _loadFolder(_currentFolder);
            }
          });
        });
      });
    });
  }

  // ── File Preview ─────────────────────────────────────────────────────────

  function _previewFile(item) {
    var id = item.getAttribute('data-fm-id');
    var name = item.getAttribute('data-fm-name');
    var ext = item.getAttribute('data-fm-ext');
    var mime = item.getAttribute('data-fm-mime');
    var size = parseInt(item.getAttribute('data-fm-size')) || 0;

    var t = null;
    try { t = localStorage.getItem('align-token'); } catch(ex) {}
    var fileUrl = '/api/files/' + id + '?token=' + (t || '');

    var existing = document.getElementById('fm-preview-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'fm-preview-overlay';
    overlay.className = 'fm-preview-overlay';

    var previewContent = '';
    var isImage = /^image\//.test(mime) || /^(png|jpg|jpeg|gif|webp)$/i.test(ext);
    var isPDF = mime === 'application/pdf' || ext === 'pdf';
    var isText = /^text\//.test(mime) || /^(csv|txt|md|log)$/i.test(ext);
    var isViewable = isImage || isPDF || isText;

    if (isImage) {
      previewContent = '<img src="' + fileUrl + '" class="fm-preview-image" alt="' + _esc(name) + '">';
    } else if (isPDF) {
      previewContent = '<iframe src="' + fileUrl + '#toolbar=0&navpanes=0" class="fm-preview-pdf" frameborder="0"></iframe>';
    } else if (isText) {
      previewContent = '<div class="fm-preview-text" id="fm-preview-text">Loading...</div>';
    } else {
      previewContent = '<div class="fm-preview-unavailable"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p style="margin-top:12px;">Preview not available for this file type</p><button class="pm-btn primary" id="fm-preview-dl">Download</button></div>';
    }

    overlay.innerHTML = [
      '<div class="fm-preview-modal">',
        '<div class="fm-preview-header">',
          '<span class="fm-preview-name">' + _esc(name) + '</span>',
          '<span class="fm-preview-meta">' + _fs(size) + '</span>',
          '<button class="fm-preview-btn" id="fm-preview-dl-btn" title="Download"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>',
          '<button class="fm-preview-close">&times;</button>',
        '</div>',
        '<div class="fm-preview-body">' + previewContent + '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);

    // Load text content async
    if (isText) {
      fetch(fileUrl, { headers: _authHeaders() }).then(function(r) { return r.text(); }).then(function(text) {
        var el = document.getElementById('fm-preview-text');
        if (el) el.textContent = text;
      }).catch(function() {
        var el = document.getElementById('fm-preview-text');
        if (el) el.textContent = 'Failed to load file';
      });
    }

    // Close handlers
    overlay.querySelector('.fm-preview-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function escHandler(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } }, { signal: window._sectionSignal });

    // Download buttons
    var dlBtns = overlay.querySelectorAll('#fm-preview-dl, #fm-preview-dl-btn');
    dlBtns.forEach(function(btn) {
      btn.addEventListener('click', function() { _downloadItem(item); });
    });
  }

  // ── Item actions ─────────────────────────────────────────────────────────

  function _downloadItem(item) {
    var id = item.getAttribute('data-fm-id');
    var name = item.getAttribute('data-fm-name');
    var t = null;
    try { t = localStorage.getItem('align-token'); } catch(ex) {}
    var isLarge = parseInt(item.getAttribute('data-fm-size')) > 95 * 1024 * 1024;
    var base = isLarge ? 'http://100.75.7.96:3002' : window.location.origin;
    var a = document.createElement('a');
    a.href = base + '/api/files/' + id + '?token=' + (t || '');
    a.download = name;
    a.click();
  }

  function _shareItem(item) {
    var id = item.getAttribute('data-fm-id');
    var name = item.getAttribute('data-fm-name');
    var t = null;
    try { t = localStorage.getItem('align-token'); } catch(ex) {}
    var url = window.location.origin + '/api/files/' + id + '?token=' + (t || '');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() { alert('Link copied'); });
    } else {
      prompt('Copy this link:', url);
    }
  }

  function _renameItem(id, name) {
    var newName = prompt('Rename:', name);
    if (!newName || newName.trim() === name) return;
    _apiPatch('/api/files/' + id, { name: newName.trim() }).then(function(r) {
      if (r.error) return alert(r.error);
      _loadFolder(_currentFolder);
    });
  }

  // ── Sort ─────────────────────────────────────────────────────────────────

  function _sortItems(by) {
    _sortBy = by;
    var folderId = _viewMode === 'trash' ? '__trash__' : _currentFolder;
    var items = (_cache[folderId] || []).slice();

    if (by === 'name') {
      items.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return (a.original_name || '').localeCompare(b.original_name || '');
      });
    } else if (by === 'date') {
      items.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
    } else if (by === 'size') {
      items.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return (b.size_bytes || 0) - (a.size_bytes || 0);
      });
    } else if (by === 'type') {
      items.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return ((a.original_name || '').split('.').pop() || '').localeCompare((b.original_name || '').split('.').pop() || '');
      });
    }
    _renderList(items, _viewMode === 'trash');
  }

  // ── Create folder ────────────────────────────────────────────────────────

  function _createFolder(name) {
    var body = { name: name };
    if (_currentFolder && _currentFolder !== 'root') body.folder_id = _currentFolder;
    _apiPost('/api/projects/' + _pid + '/folders', body).then(function(r) {
      if (r.error) return alert(r.error);
      _loadFolder(_currentFolder);
    }).catch(function() { alert('Failed to create folder'); });
  }

  // ── Upload ───────────────────────────────────────────────────────────────

  var TAILSCALE_UPLOAD_URL = 'http://100.75.7.96:3002/api/files/upload';
  var CLOUDFLARE_MAX = 95 * 1024 * 1024;

  function _uploadFiles(fileList) {
    var count = fileList.length;
    var done = 0;
    var failed = 0;
    var errors = [];

    var progressEl = document.createElement('div');
    progressEl.className = 'fm-upload-progress';
    progressEl.innerHTML = [
      '<div class="fm-upload-header">Uploading ' + count + ' file' + (count !== 1 ? 's' : '') + '...</div>',
      '<div class="fm-upload-bar-track"><div class="fm-upload-bar-fill" id="fm-upload-bar" style="width:0%"></div></div>',
      '<div class="fm-upload-status" id="fm-upload-status">0 / ' + count + '</div>',
      '<div class="fm-upload-errors" id="fm-upload-errors"></div>'
    ].join('');
    var list = document.getElementById('fm-list');
    if (list) list.parentNode.insertBefore(progressEl, list);

    function updateProgress() {
      var total = done + failed;
      var pct = count > 0 ? Math.round((total / count) * 100) : 0;
      var bar = document.getElementById('fm-upload-bar');
      var status = document.getElementById('fm-upload-status');
      if (bar) bar.style.width = pct + '%';
      if (status) status.textContent = total + ' / ' + count + (failed > 0 ? ' (' + failed + ' failed)' : '');
    }

    function finishUpload() {
      setTimeout(function() {
        if (progressEl.parentNode) progressEl.remove();
        if (failed > 0 && errors.length > 0) {
          alert('Upload complete. ' + (count - failed) + ' succeeded, ' + failed + ' failed.\n\n' + errors.join('\n'));
        }
        _loadFolder(_currentFolder);
      }, 600);
    }

    function uploadFile(file, useTailscale) {
      var form = new FormData();
      form.append('file', file);
      form.append('project_id', _pid);
      if (_currentFolder && _currentFolder !== 'root') form.append('folder_id', _currentFolder);

      var url = useTailscale ? TAILSCALE_UPLOAD_URL : '/api/files/upload';
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url);

      var h = _authHeaders();
      xhr.setRequestHeader('Authorization', h.Authorization);

      xhr.addEventListener('load', function() {
        try {
          var r = JSON.parse(xhr.responseText);
          if (r.error) {
            if (!useTailscale && (xhr.status === 413 || xhr.status === 502 || xhr.status === 503)) {
              return uploadFile(file, true);
            }
            failed++;
            errors.push(file.name + ': ' + r.error);
          } else { done++; }
        } catch(e) {
          if (!useTailscale) return uploadFile(file, true);
          failed++;
          errors.push(file.name + ': invalid response');
        }
        updateProgress();
        if (done + failed === count) finishUpload();
      });

      xhr.addEventListener('error', function() {
        if (!useTailscale) return uploadFile(file, true);
        failed++;
        errors.push(file.name + ': network error');
        updateProgress();
        if (done + failed === count) finishUpload();
      });

      xhr.send(form);
    }

    Array.from(fileList).forEach(function(file) {
      uploadFile(file, file.size > CLOUDFLARE_MAX);
      updateProgress();
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  global.AlignFiles = {
    render: render,
    getTree: function() { return {}; },
    listFolder: function() { return { folders:[], files:[] }; },
    saveFile: function() { return {}; },
    getFile: function() { return { meta:{}, content:'' }; },
    deleteFile: function() { return false; },
    getQuota: function() { return { used:0, max:0 }; },
  };
  if (window.TileRegistry) window.TileRegistry.register({ id: 'files', title: 'Files', icon: '[]', route: 'files', roles: ['user','admin'], order: 4 });
})(window);

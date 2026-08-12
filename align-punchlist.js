/* align-punchlist.js — Apartment-based punchlist v5 */
(function (global) {
  'use strict';

  function S() { return window.AlignStorage; }
  function A() { return window.AlignAuth; }

  var CATEGORY = 'punchlist';

  var state = {
    container: null,
    projectId: null,
    apartments: [],
    activeApt: null,
    viewMode: 'list',   // 'list' | 'apt' | 'form' | 'detail' | 'profile-edit'
    editingItem: null,
    detailItem: null,
    _aptCounts: {},
    _aptOpen: {}
  };

  var STATUSES = ['open','in_progress','resolved','verified'];

  function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
  function uid()  { return 'pl_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function nowISO(){ return new Date().toISOString(); }

  function fmtDate(iso) {
    try { var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric'}); }
    catch(e){return '';}
  }

  function statusLabel(s) {
    var m = {open:'Open',in_progress:'In Progress',resolved:'Resolved',verified:'Verified'};
    return m[s]||s;
  }
  function statusColor(s) {
    var m = {open:'var(--danger)',in_progress:'var(--warning)',resolved:'var(--brand)',verified:'var(--success)'};
    return m[s]||'var(--muted)';
  }

  function getItemsFull() {
    if (!state.projectId) return [];
    return S().listRecords(state.projectId, CATEGORY);
  }

  function getCurrentUser() {
    try {
      if (A() && A().getActiveUser) { var u = A().getActiveUser(); return u ? (u.name || 'Unknown') : 'Unknown'; }
    } catch(e) {}
    return 'Unknown';
  }

  var _companiesCache = null;
  function fetchCompanies() {
    if (_companiesCache) return Promise.resolve(_companiesCache);
    var pid = state.projectId;
    if (!pid) return Promise.resolve([]);
    return fetch('/api/projects/' + pid + '/companies', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(d) { _companiesCache = d.companies || []; return _companiesCache; })
      .catch(function() { return []; });
  }

  var _drawingsCache = null;
  function fetchDrawings() {
    if (_drawingsCache) return Promise.resolve(_drawingsCache);
    var pid = state.projectId;
    if (!pid) return Promise.resolve([]);
    return fetch('/api/projects/' + pid + '/files', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(d) { 
        _drawingsCache = (d.files || []).filter(function(f) { return f.type === 'file' && f.trashed === 0; }); 
        return _drawingsCache; 
      })
      .catch(function() { return []; });
  }

  function isAdmin() {
    try { return A() && A().isAdmin && A().isAdmin(); } catch(e) { return false; }
  }

  function _buildAptList() {
    var items = getItemsFull();
    var apts = {};
    var openCounts = {};
    var urgentCounts = {};
    items.forEach(function(i) {
      var a = (i.apartment || '').trim();
      if (!a) a = 'Unfiled';
      apts[a] = (apts[a] || 0) + 1;
      if (i.status === 'open') openCounts[a] = (openCounts[a] || 0) + 1;
      if ((i.priority === 'critical' || i.priority === 'high') && (i.status === 'open' || i.status === 'in_progress')) {
        urgentCounts[a] = (urgentCounts[a] || 0) + 1;
      }
    });
    state.apartments = Object.keys(apts).sort();
    state._aptCounts = apts;
    state._aptOpen = openCounts;
    state._aptUrgent = urgentCounts;
  }

  function _itemsForApt(name) {
    var all = getItemsFull();
    if (!name) return [];
    var items;
    if (name === 'Unfiled') items = all.filter(function(i) { return !(i.apartment||'').trim(); });
    else items = all.filter(function(i) { return (i.apartment||'').trim() === name; });
    // Sort: priority desc, then number asc
    var pw = {critical:4, high:3, medium:2, low:1};
    items.sort(function(a,b){
      var pa = pw[a.priority]||0, pb = pw[b.priority]||0;
      if (pa !== pb) return pb - pa;
      return (a.number||0) - (b.number||0);
    });
    return items;
  }

  /* ── Apartment profile data ────────────────────────────────────────────────────────── */
  function _getAptProfile(aptName) {
    if (!state.projectId || !aptName) return null;
    var profiles = S().listRecords(state.projectId, 'apt_profiles');
    return profiles.find(function(p) { return (p.apartment || '').trim() === aptName.trim(); }) || null;
  }
  function _saveAptProfile(profile) {
    if (!state.projectId) return;
    S().saveRecord(state.projectId, 'apt_profiles', profile);
  }
  function _drawingUrl(drawingId) {
    if (!drawingId) return null;
    return '/api/files/' + drawingId;
  }

  function _aptIndex() {
    if (!state.activeApt) return -1;
    return state.apartments.indexOf(state.activeApt);
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function render(container) {
    if (!container) return;
    state.container = container;
    state.viewMode = 'list';
    state.editingItem = null;
    _resolveProjectId();
    _paint();
  }

  function _resolveProjectId() {
    var s=S();
    if (!s) { state.projectId=null; return; }
    var active=s.getActiveProject();
    state.projectId=active?active.id:null;
  }

  function _paint() {
    var c=state.container;
    if (!c) return;
    _resolveProjectId();
    if (!state.projectId) {
      c.innerHTML='<div class="pl-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
      return;
    }
    if (state.viewMode==='form' && state.editingItem) {
      c.innerHTML=_formHtml(state.editingItem);
      _bindForm();
      return;
    }
    if (state.viewMode==='detail' && state.detailItem) {
      c.innerHTML=_detailHtml(state.detailItem);
      _bindDetail();
      return;
    }
    if (state.viewMode==='profile-edit') {
      c.innerHTML=_profileEditHtml();
      _bindProfileEdit();
      return;
    }
    _buildAptList();
    if (state.viewMode==='apt' && state.activeApt) {
      c.innerHTML=_aptViewHtml();
      _bindAptView();
      _initAssignments();
    } else {
      c.innerHTML=_listHtml();
      _bindList();
    }
  }

  /* ── Apartment list (tile grid) ─────────────────────────────────────── */
  function _listHtml() {
    var h=[];
    var items = getItemsFull();
    var counts = {
      all: items.length,
      open: items.filter(function(i){return i.status==='open';}).length,
      in_progress: items.filter(function(i){return i.status==='in_progress';}).length,
      resolved: items.filter(function(i){return i.status==='resolved';}).length,
      verified: items.filter(function(i){return i.status==='verified';}).length
    };

    // Titleblock with Start New List button
    h.push('<div class="pl-titleblock">');
    h.push('<button class="pl-new-list-btn" id="pl-apt-new">+ Start New List</button>');
    h.push('</div>');

    // Stats bar
    h.push('<div class="pl-stats">');
    ['all','open','in_progress','resolved','verified'].forEach(function(s){
      var count = counts[s] || 0;
      var color=s==='open'?'#ef4444':s==='in_progress'?'#f59e0b':s==='resolved'?'#3b82f6':s==='verified'?'#16a34a':'';
      h.push('<button class="pl-stat-btn" data-pl-filter="'+s+'">');
      h.push('<span class="pl-stat-count">'+count+'</span>');
      h.push('<span class="pl-stat-label" style="color:'+color+'">'+(s==='all'?'Total':statusLabel(s))+'</span>');
      h.push('</button>');
    });
    h.push('</div>');

    // Apartment tile grid
    h.push('<div class="pl-apt-grid">');

    state.apartments.forEach(function(a) {
      var total = state._aptCounts[a] || 0;
      var openCount = state._aptOpen[a] || 0;
      var urgentCount = state._aptUrgent[a] || 0;
      h.push('<div class="pl-apt-tile" data-pl-apt="'+esc(a)+'">');
      h.push('<div class="pl-apt-name">'+esc(a)+'</div>');
      h.push('<div class="pl-apt-info">');
      h.push('<span class="pl-apt-total">'+total+' item'+(total!==1?'s':'')+'</span>');
      if (openCount > 0) {
        h.push('<span class="pl-apt-open-badge">'+openCount+'</span>');
      }
      h.push('</div>');
      if (urgentCount > 0) {
        h.push('<span class="pl-apt-urgent-badge">'+urgentCount+' urgent</span>');
      }
      h.push('</div>');
    });

    h.push('</div>'); // .pl-apt-grid
    return '<div class="pl-wrap">'+h.join('')+'</div>';
  }

  function _bindList() {
    var wrap = state.container;
    if (!wrap) return;

    wrap.addEventListener('click', function(e) {
      // Start New List — open form directly
      if (e.target.closest('#pl-apt-new')) {
        state.activeApt = '';
        state.editingItem = {
          id: '', apartment: '', title: '', description: '', location: '',
          trade: '', assignedTo: '', priority: 'medium', status: 'open',
          number: 1, dueDate: '', createdBy: getCurrentUser(), activity: []
        };
        state.viewMode = 'form';
        _paint();
        // Focus the apartment field
        setTimeout(function() {
          var f = document.getElementById('pl-apartment');
          if (f) f.focus();
        }, 100);
        return;
      }
      // Apartment tile click
      var tile = e.target.closest('.pl-apt-tile');
      if (!tile) return;
      var apt = tile.getAttribute('data-pl-apt');
      if (apt) {
        state.activeApt = apt;
        state.viewMode = 'apt';
        _paint();
      }
    });
  }

  /* ── Apartment detail view ──────────────────────────────────────────── */
  function _aptViewHtml() {
    var h=[];
    var items = _itemsForApt(state.activeApt);
    var idx = _aptIndex();
    var hasPrev = idx > 0;
    var hasNext = idx >= 0 && idx < state.apartments.length - 1;
    var profile = _getAptProfile(state.activeApt);

    // Navigation header
    h.push('<div class="pl-apt-nav">');
    h.push('<button class="pm-btn small" id="pl-apt-back">← All Lists</button>');
    h.push('<div class="pl-apt-nav-center">');
    h.push('<h3 class="pl-apt-nav-title">'+esc(state.activeApt)+'</h3>');
    h.push('<span class="pl-apt-nav-count">'+items.length+' item'+(items.length!==1?'s':'')+'</span>');
    h.push('</div>');
    h.push('<div class="pl-apt-nav-arrows">');
    if (hasPrev) h.push('<button class="pm-btn small" id="pl-apt-prev">← '+esc(state.apartments[idx-1])+'</button>');
    if (hasNext) h.push('<button class="pm-btn small" id="pl-apt-next">'+esc(state.apartments[idx+1])+' →</button>');
    h.push('</div>');
    h.push('</div>');

    // Apartment profile card
    h.push('<div class="pl-apt-profile">');
    h.push('<div class="pl-apt-profile-header">');
    h.push('<h4 class="pl-apt-profile-name">'+esc(state.activeApt)+'</h4>');
    h.push('<button class="pm-btn small" id="pl-edit-profile">Edit Profile</button>');
    h.push('</div>');

    // Layout image placeholder
    if (profile && profile.layoutImageId) {
      h.push('<div class="pl-apt-profile-layout"><img src="/api/files/'+esc(profile.layoutImageId)+'" alt="Layout"></div>');
    } else {
      h.push('<div class="pl-apt-profile-layout">No layout image</div>');
    }

    // SF fields
    h.push('<div class="pl-apt-profile-sf">');
    h.push('<div>');
    h.push('<div class="pl-apt-profile-label">Plan SF</div>');
    h.push('<div class="pl-detail-value">'+(profile && profile.planSf ? esc(profile.planSf) : '—')+'</div>');
    h.push('</div>');
    h.push('<div>');
    h.push('<div class="pl-apt-profile-label">Actual SF</div>');
    var actualSf = profile && profile.actualSf ? esc(profile.actualSf) : '—';
    var sfChanged = profile && profile.planSf && profile.actualSf && profile.actualSf !== profile.planSf;
    h.push('<div class="pl-detail-value" style="font-weight:700;color:'+(sfChanged?'var(--success)':'var(--ink)')+'">'+actualSf+'</div>');
    h.push('</div>');
    h.push('</div>');

    // References
    h.push('<div class="pl-apt-profile-label">References</div>');
    if (profile && profile.references) {
      h.push('<div class="pl-apt-profile-ref">'+esc(profile.references)+'</div>');
    } else {
      h.push('<div class="pl-apt-profile-ref pl-apt-profile-ref-empty">No references added yet</div>');
    }
    h.push('</div>'); // .pl-apt-profile

    // Add Item bar
    h.push('<div class="pl-add-bar">');
    h.push('<button class="pm-btn primary" id="pl-add-item">+ Add Item</button>');
    h.push('<button class="pm-btn small danger" id="pl-delete-apt" style="margin-left:auto;">Delete List</button>');
    h.push('</div>');

    // Items
    if (!items.length) {
      h.push('<div class="pl-empty">No items yet — tap + Add Item above</div>');
    } else {
      h.push('<div class="pl-items">');
      items.forEach(function(item, i) {
        var sc = statusColor(item.status);
        var metaParts = [esc(item.title||'Untitled')];
        if (item.location) metaParts.push(esc(item.location));
        if (item.assignedCompanyName) metaParts.push(esc(item.assignedCompanyName));
        h.push('<div class="pl-item-row" data-pl-id="'+esc(item.id)+'" data-pl-status="'+esc(item.status)+'" data-pl-priority="'+esc(item.priority||'medium')+'">');
        h.push('<div class="pl-item-info">');
        h.push('<div class="pl-item-title">'+esc(state.activeApt)+': Item #'+(i+1).toString().padStart(3,'0')+'</div>');
        h.push('<div class="pl-item-meta">'+metaParts.join(' • ')+' • '+fmtDate(item.createdAt) + (item.drawingId ? ' • 📐 Linked to drawing' : '') + '</div>');
        h.push('</div>');
        h.push('<div class="pl-item-right">');
        h.push('<span class="pl-item-status" style="background:'+sc+'">'+statusLabel(item.status)+'</span>');
        h.push('<button class="assign-btn" data-pl-act="assign" data-pl-id="'+esc(item.id)+'">Assign</button>');
        h.push('<button class="pm-btn small" data-pl-act="edit" data-pl-id="'+esc(item.id)+'">Edit</button>');
        h.push('<button class="pm-btn small danger" data-pl-act="delete" data-pl-id="'+esc(item.id)+'">✕</button>');
        h.push('</div>');
        h.push('<div class="assigned-users" data-punch-id="'+esc(item.id)+'"></div>');
        h.push('</div>');
      });
      h.push('</div>');
    }

    return h.join('');
  }

  /* ── Assignment UI initialization ────────────────────────────────────── */
  function _initAssignments() {
    var containers = document.querySelectorAll('.assigned-users[data-punch-id]');
    if (window.initAssignmentUI) {
      containers.forEach(function(container) {
        var punchId = container.getAttribute('data-punch-id');
        window.initAssignmentUI(punchId, container);
      });
    }
  }

  function _bindAptView() {
    // Back to list
    var backBtn = document.getElementById('pl-apt-back');
    if (backBtn) backBtn.addEventListener('click', function() {
      state.viewMode = 'list'; state.activeApt = null; _paint();
    });

    // Previous apartment
    var prevBtn = document.getElementById('pl-apt-prev');
    if (prevBtn) prevBtn.addEventListener('click', function() {
      var idx = _aptIndex();
      if (idx > 0) { state.activeApt = state.apartments[idx-1]; _paint(); }
    });

    // Next apartment
    var nextBtn = document.getElementById('pl-apt-next');
    if (nextBtn) nextBtn.addEventListener('click', function() {
      var idx = _aptIndex();
      if (idx >= 0 && idx < state.apartments.length-1) { state.activeApt = state.apartments[idx+1]; _paint(); }
    });

    // Edit Profile
    var editProfileBtn = document.getElementById('pl-edit-profile');
    if (editProfileBtn) editProfileBtn.addEventListener('click', function() {
      state.viewMode = 'profile-edit';
      _paint();
    });

    // Add Item
    var addBtn = document.getElementById('pl-add-item');
    if (addBtn) addBtn.addEventListener('click', function() {
      var items = _itemsForApt(state.activeApt);
      var nextNum = items.length + 1;
      state.editingItem = {
        id: '', apartment: state.activeApt, title: '', description: '', location: '',
        trade: '', assignedTo: '', priority: 'medium', status: 'open',
        number: nextNum, dueDate: '', createdBy: getCurrentUser(), activity: []
      };
      state.viewMode = 'form';
      _paint();
    });

    // Delete list
    var delBtn = document.getElementById('pl-delete-apt');
    if (delBtn) delBtn.addEventListener('click', function() {
      if (!confirm('Delete all items in "'+state.activeApt+'"?')) return;
      var items = _itemsForApt(state.activeApt);
      items.forEach(function(i) { S().deleteRecord(state.projectId, CATEGORY, i.id); });
      state.activeApt = null;
      state.viewMode = 'list';
      _paint();
    });

    // Item row click → detail view; button clicks → edit/delete
    var wrap = state.container;
    if (wrap) wrap.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-pl-act]');
      if (btn) {
        var act = btn.getAttribute('data-pl-act');
        var id = btn.getAttribute('data-pl-id');
        if (act === 'edit') {
          var item = getItemsFull().find(function(i) { return i.id === id; });
          if (item) { state.editingItem = JSON.parse(JSON.stringify(item)); state.viewMode = 'form'; _paint(); }
        }
        if (act === 'delete') {
          if (confirm('Delete this item?')) {
            var delId = id;
            fetch('/api/projects/' + state.projectId + '/' + CATEGORY + '/' + delId, {
              method: 'DELETE',
              headers: (window.AlignAPI && window.AlignAPI.authHeaders) ? window.AlignAPI.authHeaders() : {}
            }).then(function() {
              S().deleteRecord(state.projectId, CATEGORY, delId);
              _paint();
            }).catch(function() {
              alert('Delete failed — please try again.');
            });
          }
        }
        if (act === 'assign') {
          e.stopPropagation();
          if (window.openUserPicker) {
            window.openUserPicker(id, btn);
          } else {
            alert('Assignment library not loaded');
          }
        }
        return;
      }
      // Row click → detail
      var row = e.target.closest('.pl-item-row');
      if (row) {
        var id = row.getAttribute('data-pl-id');
        var item = getItemsFull().find(function(i) { return i.id === id; });
        if (item) { state.detailItem = item; state.viewMode = 'detail'; _paint(); }
      }
    });
  }

  /* ── Form View ──────────────────────────────────────────────────────── */
  function _formHtml(item) {
    var isNew = !item.id;
    var h=[];
    h.push('<div class="pl-form-wrap">');
    h.push('<div class="pl-form-header">');
    h.push('<button class="pm-btn" id="pl-form-back">← Back</button>');
    h.push('<h3 class="pl-form-title">'+(isNew?'New Item in '+esc(state.activeApt||''):'Edit Item')+'</h3>');
    h.push('<button class="pm-btn primary" id="pl-form-save">Save</button>');
    h.push('</div>');

    h.push('<div class="pl-form-row pl-form-row-2">');
    h.push('<div class="pl-form-field"><label class="pl-field-label">Apartment</label><input type="text" class="pl-input" id="pl-apartment" value="'+esc(item.apartment||'')+'" placeholder="e.g. Apt 3A"></div>');
    h.push('<div class="pl-form-field pl-field-sm"><label class="pl-field-label">#</label><input type="text" class="pl-input" id="pl-number" value="'+esc(item.number||'')+'" readonly></div>');
    h.push('</div>');

    // Priority field (only required field on creation)
    h.push('<div class="pl-form-section"><label class="pl-field-label">Priority</label><select class="pl-input" id="pl-priority">');
    ['low','medium','high','critical'].forEach(function(p){ h.push('<option value="'+p+'"'+(item.priority===p?' selected':'')+'>'+p.charAt(0).toUpperCase()+p.slice(1)+'</option>'); });
    h.push('</select></div>');

    // Image upload section
    h.push('<div class="pl-form-section">');
    h.push('<label class="pl-field-label">Add Images</label>');
    h.push('<div class="pl-image-upload">');
    h.push('<button type="button" class="pl-upload-btn" id="pl-upload-camera"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> Camera</button>');
    h.push('<button type="button" class="pl-upload-btn" id="pl-upload-album"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"></path><rect x="6" y="9" width="12" height="8"></rect><circle cx="12" cy="13" r="2"></circle></svg> Album</button>');
    h.push('</div>');
    h.push('<div id="pl-images-preview" class="pl-images-preview"></div>');
    h.push('<input type="file" id="pl-file-input" accept="image/*" style="display:none;" multiple>');
    h.push('</div>');

    h.push('</div>');
    return h.join('');
  }

  function _bindForm() {
    var backBtn = document.getElementById('pl-form-back');
    if (backBtn) backBtn.addEventListener('click', function() {
      state.viewMode = 'apt'; state.editingItem = null; _paint();
    });

    // Image upload handlers
    var fileInput = document.getElementById('pl-file-input');
    var cameraBtn = document.getElementById('pl-upload-camera');
    var albumBtn = document.getElementById('pl-upload-album');
    
    if (cameraBtn) {
      cameraBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (fileInput) {
          fileInput.capture = 'environment'; // Request camera
          fileInput.click();
        }
      });
    }
    
    if (albumBtn) {
      albumBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (fileInput) {
          fileInput.capture = ''; // Request photo library
          fileInput.click();
        }
      });
    }
    
    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        var files = e.target.files || [];
        _handleImageSelection(Array.from(files));
      });
    }

    var saveBtn = document.getElementById('pl-form-save');
    if (saveBtn) saveBtn.addEventListener('click', function() {
      var item = state.editingItem;
      item.apartment = (document.getElementById('pl-apartment')||{}).value || state.activeApt || '';
      item.priority = (document.getElementById('pl-priority')||{}).value || 'medium';
      item.updatedAt = nowISO();

      if (!item.id) {
        item.id = uid();
        item.createdAt = nowISO();
        item.createdBy = getCurrentUser();
        item.activity = [];
        item.status = 'open'; // Default status on creation
      }

      S().saveRecord(state.projectId, CATEGORY, item);
      state.activeApt = item.apartment;
      state.viewMode = 'apt';
      state.editingItem = null;
      _paint();
    });
  }

  function _handleImageSelection(files) {
    if (!files || files.length === 0) return;
    var preview = document.getElementById('pl-images-preview');
    if (!preview) return;

    if (!state.editingItem.images) state.editingItem.images = [];

    files.forEach(function(file) {
      var reader = new FileReader();
      reader.onload = function(evt) {
        var b64 = evt.target.result;
        state.editingItem.images.push({
          id: uid(),
          data: b64,
          timestamp: nowISO()
        });

        // Show preview thumbnail
        var thumb = document.createElement('div');
        thumb.className = 'pl-image-thumb';
        thumb.style.backgroundImage = 'url(' + b64 + ')';
        thumb.title = 'Click to remove';
        thumb.addEventListener('click', function() {
          state.editingItem.images = state.editingItem.images.filter(function(img) {
            return img.id !== (thumb._imageId || '');
          });
          thumb.remove();
        });
        thumb._imageId = state.editingItem.images[state.editingItem.images.length - 1].id;
        preview.appendChild(thumb);
      };
      reader.readAsDataURL(file);
    });
  }

  /* ── Detail View ───────────────────────────────────────────────────────────────── */
  function _detailHtml(item) {
    var h=[];
    var sc = statusColor(item.status);
    var drawingUrl = _drawingUrl(item.drawingId);

    h.push('<div class="pl-detail-wrap">');
    h.push('<div class="pl-detail-header">');
    h.push('<button class="pm-btn" id="pl-detail-back">← Back</button>');
    h.push('<h3 class="pl-detail-title">'+esc(item.title||'Untitled')+'</h3>');
    h.push('<button class="pm-btn primary" id="pl-detail-edit">Edit</button>');
    h.push('</div>');

    h.push('<div class="pl-detail-section">');
    h.push('<span class="pl-detail-status-badge" style="background:'+sc+'">'+statusLabel(item.status)+'</span>');
    if (item.priority) {
      var pc = item.priority==='critical'?'#dc2626':item.priority==='high'?'#ea580c':item.priority==='low'?'#16a34a':'#64748b';
      h.push(' <span class="pl-priority-badge" style="background:'+pc+'">'+item.priority+'</span>');
    }
    h.push('</div>');

    if (item.description) {
      h.push('<div class="pl-detail-section">');
      h.push('<span class="pl-detail-label">Description</span>');
      h.push('<div class="pl-detail-value pl-detail-desc">'+esc(item.description)+'</div>');
      h.push('</div>');
    }

    h.push('<div class="pl-detail-section">');
    h.push('<span class="pl-detail-label">Apartment</span>');
    h.push('<div class="pl-detail-value">'+esc(item.apartment||'—')+'</div>');
    h.push('</div>');

    if (item.location) {
      h.push('<div class="pl-detail-section">');
      h.push('<span class="pl-detail-label">Location</span>');
      h.push('<div class="pl-detail-value">'+esc(item.location)+'</div>');
      h.push('</div>');
    }

    if (item.assignedCompanyName || item.assignedTo) {
      h.push('<div class="pl-detail-section">');
      h.push('<span class="pl-detail-label">Assigned To</span>');
      h.push('<div class="pl-detail-value">'+esc(item.assignedCompanyName || item.assignedTo || '—')+'</div>');
      h.push('</div>');
    }

    if (drawingUrl) {
      h.push('<div class="pl-detail-section">');
      h.push('<span class="pl-detail-label">Linked Drawing</span>');
      h.push('<a class="pl-detail-drawing-link" href="'+drawingUrl+'" target="_blank" rel="noopener">📐 Open Drawing</a>');
      h.push('</div>');
    }

    h.push('<div class="pl-detail-section">');
    h.push('<span class="pl-detail-label">Created</span>');
    h.push('<div class="pl-detail-value">'+esc(item.createdBy||'Unknown')+' • '+fmtDate(item.createdAt)+'</div>');
    h.push('</div>');

    h.push('</div>'); // .pl-detail-wrap
    return h.join('');
  }

  function _bindDetail() {
    var backBtn = document.getElementById('pl-detail-back');
    if (backBtn) backBtn.addEventListener('click', function() {
      state.viewMode = 'apt'; state.detailItem = null; _paint();
    });
    var editBtn = document.getElementById('pl-detail-edit');
    if (editBtn) editBtn.addEventListener('click', function() {
      if (state.detailItem) {
        state.editingItem = JSON.parse(JSON.stringify(state.detailItem));
        state.viewMode = 'form';
        _paint();
      }
    });
  }

  /* ── Profile Edit ────────────────────────────────────────────────────────── */
  function _profileEditHtml() {
    var profile = _getAptProfile(state.activeApt) || { apartment: state.activeApt, planSf: '', actualSf: '', references: '', layoutImageId: '' };
    var h=[];
    h.push('<div class="pl-form-wrap pl-profile-edit">');
    h.push('<div class="pl-form-header">');
    h.push('<button class="pm-btn" id="pl-profile-back">← Cancel</button>');
    h.push('<h3 class="pl-form-title">Edit '+esc(state.activeApt)+'</h3>');
    h.push('<button class="pm-btn primary" id="pl-profile-save">Save</button>');
    h.push('</div>');

    h.push('<div class="pl-form-section"><label class="pl-field-label">Plan SF</label><input type="text" class="pl-input" id="pl-profile-plan" value="'+esc(profile.planSf||'')+'" placeholder="e.g. 850"></div>');
    h.push('<div class="pl-form-section"><label class="pl-field-label">Actual SF</label><input type="text" class="pl-input" id="pl-profile-actual" value="'+esc(profile.actualSf||'')+'" placeholder="e.g. 847"></div>');
    h.push('<div class="pl-form-section"><label class="pl-field-label">References (specs, drawings, notes)</label><textarea class="pl-input" id="pl-profile-refs" rows="4" placeholder="Drawing A-301&#10;Kitchen: white quartz...">'+esc(profile.references||'')+'</textarea></div>');
    h.push('<div class="pl-form-section"><label class="pl-field-label">Layout Image File ID (optional)</label><input type="text" class="pl-input" id="pl-profile-layout" value="'+esc(profile.layoutImageId||'')+'" placeholder="File ID from Files tile"></div>');

    h.push('</div>');
    return h.join('');
  }

  function _bindProfileEdit() {
    var backBtn = document.getElementById('pl-profile-back');
    if (backBtn) backBtn.addEventListener('click', function() {
      state.viewMode = 'apt'; _paint();
    });
    var saveBtn = document.getElementById('pl-profile-save');
    if (saveBtn) saveBtn.addEventListener('click', function() {
      var existing = _getAptProfile(state.activeApt);
      var profile = existing || { id: uid(), apartment: state.activeApt };
      profile.planSf = (document.getElementById('pl-profile-plan')||{}).value || '';
      profile.actualSf = (document.getElementById('pl-profile-actual')||{}).value || '';
      profile.references = (document.getElementById('pl-profile-refs')||{}).value || '';
      profile.layoutImageId = (document.getElementById('pl-profile-layout')||{}).value || '';
      profile.updatedAt = nowISO();
      if (!existing) profile.createdAt = nowISO();
      _saveAptProfile(profile);
      state.viewMode = 'apt';
      _paint();
    });
  }

  global.AlignPunchlist = Object.freeze({ render: render, CATEGORY: CATEGORY });
  if (window.TileRegistry) window.TileRegistry.register({ id: 'punchlist', title: 'Punchlist', icon: '/', route: 'punchlist', roles: ['user','admin'], order: 2 });
})(window);

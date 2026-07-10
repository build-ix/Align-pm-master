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
    viewMode: 'list',   // 'list' | 'apt' | 'form'
    editingItem: null,
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
    items.forEach(function(i) {
      var a = (i.apartment || '').trim();
      if (!a) a = 'Unfiled';
      apts[a] = (apts[a] || 0) + 1;
      if (i.status === 'open') openCounts[a] = (openCounts[a] || 0) + 1;
    });
    state.apartments = Object.keys(apts).sort();
    state._aptCounts = apts;
    state._aptOpen = openCounts;
  }

  function _itemsForApt(name) {
    var all = getItemsFull();
    if (!name) return [];
    if (name === 'Unfiled') return all.filter(function(i) { return !(i.apartment||'').trim(); });
    return all.filter(function(i) { return (i.apartment||'').trim() === name; });
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
    _buildAptList();
    if (state.viewMode==='apt' && state.activeApt) {
      c.innerHTML=_aptViewHtml();
      _bindAptView();
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

    // Start New List
    h.push('<div class="pl-apt-tile pl-apt-new" id="pl-apt-new">');
    h.push('<div class="pl-apt-new-icon">+</div>');
    h.push('<div class="pl-apt-new-label">Start New List</div>');
    h.push('</div>');

    state.apartments.forEach(function(a) {
      var total = state._aptCounts[a] || 0;
      var openCount = state._aptOpen[a] || 0;
      h.push('<div class="pl-apt-tile" data-pl-apt="'+esc(a)+'">');
      h.push('<div class="pl-apt-name">'+esc(a)+'</div>');
      h.push('<div class="pl-apt-info">');
      h.push('<span class="pl-apt-total">'+total+' item'+(total!==1?'s':'')+'</span>');
      if (openCount > 0) {
        h.push('<span class="pl-apt-open-badge">'+openCount+'</span>');
      }
      h.push('</div>');
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
        h.push('<div class="pl-item-row" data-pl-id="'+esc(item.id)+'">');
        h.push('<div class="pl-item-info">');
        h.push('<div class="pl-item-title">'+esc(state.activeApt)+': Item #'+(i+1).toString().padStart(3,'0')+'</div>');
        h.push('<div class="pl-item-meta">'+esc(item.title||'Untitled')+' • '+fmtDate(item.createdAt) + (item.drawingId ? ' • 📐 Linked to drawing' : '') + '</div>');
        h.push('</div>');
        h.push('<div class="pl-item-right">');
        h.push('<span class="pl-item-status" style="background:'+sc+'">'+statusLabel(item.status)+'</span>');
        h.push('<button class="pm-btn small" data-pl-act="edit" data-pl-id="'+esc(item.id)+'">Edit</button>');
        h.push('<button class="pm-btn small danger" data-pl-act="delete" data-pl-id="'+esc(item.id)+'">✕</button>');
        h.push('</div>');
        h.push('</div>');
      });
      h.push('</div>');
    }

    return h.join('');
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

    // Item actions
    var wrap = state.container;
    if (wrap) wrap.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-pl-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-pl-act');
      var id = btn.getAttribute('data-pl-id');
      if (act === 'edit') {
        var item = getItemsFull().find(function(i) { return i.id === id; });
        if (item) { state.editingItem = JSON.parse(JSON.stringify(item)); state.viewMode = 'form'; _paint(); }
      }
      if (act === 'delete') {
        if (confirm('Delete this item?')) {
          var delId = id;
          // Delete from server first
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

    h.push('<div class="pl-form-section"><label class="pl-field-label">Title</label><input type="text" class="pl-input" id="pl-title" value="'+esc(item.title||'')+'" placeholder="Describe the issue"></div>');
    h.push('<div class="pl-form-section"><label class="pl-field-label">Description</label><textarea class="pl-textarea" id="pl-desc" rows="3" placeholder="Details…">'+esc(item.description||'')+'</textarea></div>');

    h.push('<div class="pl-form-row pl-form-row-2">');
    h.push('<div class="pl-form-field"><label class="pl-field-label">Location</label><input type="text" class="pl-input" id="pl-location" value="'+esc(item.location||'')+'" placeholder="e.g. Master bathroom"></div>');
    h.push('<div class="pl-form-field"><label class="pl-field-label">Status</label><select class="pl-input" id="pl-status">');
    STATUSES.forEach(function(s){ h.push('<option value="'+s+'"'+(item.status===s?' selected':'')+'>'+statusLabel(s)+'</option>'); });
    h.push('</select></div>');
    h.push('</div>');

    h.push('<div class="pl-form-row pl-form-row-2">');
    h.push('<div class="pl-form-field"><label class="pl-field-label">Priority</label><select class="pl-input" id="pl-priority">');
    ['low','medium','high','critical'].forEach(function(p){ h.push('<option value="'+p+'"'+(item.priority===p?' selected':'')+'>'+p.charAt(0).toUpperCase()+p.slice(1)+'</option>'); });
    h.push('</select></div>');
    // Company dropdown (admin only) or assigned display
    if (isAdmin()) {
      h.push('<div class="pl-form-field"><label class="pl-field-label">Assigned Company</label><select class="pl-input" id="pl-company"></select></div>');
    } else {
      h.push('<div class="pl-form-field"><label class="pl-field-label">Assigned To</label><input type="text" class="pl-input" id="pl-assigned" value="'+esc(item.assignedTo||item.assignedCompanyName||'')+'" readonly></div>');
    }
    h.push('</div>');

    // ── Linked Drawing ──────────────────────────────────────────────────
    h.push('<div class="pl-form-section"><label class="pl-field-label">Linked Drawing</label><select class="pl-input" id="pl-drawing"><option value="">— None —</option></select></div>');

    h.push('</div>');
    return h.join('');
  }

  function _bindForm() {
    var backBtn = document.getElementById('pl-form-back');
    if (backBtn) backBtn.addEventListener('click', function() {
      state.viewMode = 'apt'; state.editingItem = null; _paint();
    });

    // Populate company dropdown for admins
    var companySel = document.getElementById('pl-company');
    if (companySel && isAdmin()) {
      fetchCompanies().then(function(companies) {
        companySel.innerHTML = '<option value="">— None —</option>' +
          companies.map(function(c) {
            var sel = state.editingItem && state.editingItem.assignedCompanyId === c.id ? ' selected' : '';
            return '<option value="' + c.id + '"' + sel + '>' + (c.name || '') + (c.trade ? ' (' + c.trade + ')' : '') + '</option>';
          }).join('');
      });
    }

    // Populate drawing dropdown
    var drawingSel = document.getElementById('pl-drawing');
    if (drawingSel) {
      fetchDrawings().then(function(drawings) {
        var html = '<option value="">— None —</option>';
        drawings.forEach(function(d) {
          var sel = state.editingItem && state.editingItem.drawingId === d.id ? ' selected' : '';
          html += '<option value="' + d.id + '"' + sel + '>' + esc(d.original_name || d.id) + '</option>';
        });
        drawingSel.innerHTML = html;
      });
    }

    var saveBtn = document.getElementById('pl-form-save');
    if (saveBtn) saveBtn.addEventListener('click', function() {
      var item = state.editingItem;
      item.apartment = (document.getElementById('pl-apartment')||{}).value || state.activeApt || '';
      item.title = (document.getElementById('pl-title')||{}).value || '';
      item.description = (document.getElementById('pl-desc')||{}).value || '';
      item.location = (document.getElementById('pl-location')||{}).value || '';
      item.status = (document.getElementById('pl-status')||{}).value || 'open';
      item.priority = (document.getElementById('pl-priority')||{}).value || 'medium';
      item.assignedTo = (document.getElementById('pl-assigned')||{}).value || '';
      // Save company assignment
      var companySel = document.getElementById('pl-company');
      if (companySel && companySel.value) {
        var co = companySel.options[companySel.selectedIndex];
        item.assignedCompanyId = companySel.value;
        item.assignedCompanyName = co ? co.textContent : '';
      }
      item.updatedAt = nowISO();

      // Save drawing link
      var drawingSel2 = document.getElementById('pl-drawing');
      item.drawingId = drawingSel2 ? drawingSel2.value || null : null;

      if (!item.id) {
        item.id = uid();
        item.createdAt = nowISO();
        item.createdBy = getCurrentUser();
        item.activity = [];
      }

      S().saveRecord(state.projectId, CATEGORY, item);
      state.activeApt = item.apartment;
      state.viewMode = 'apt';
      state.editingItem = null;
      _paint();
    });
  }

  global.AlignPunchlist = Object.freeze({ render: render, CATEGORY: CATEGORY });
  if (window.TileRegistry) window.TileRegistry.register({ id: 'punchlist', title: 'Punchlist', icon: '/', route: 'punchlist', roles: ['user','admin'], order: 2 });
})(window);

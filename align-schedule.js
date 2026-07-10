/* align-schedule.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Schedule module (milestones, inspections, deliveries, meetings)
 * Depends on: align-storage.js (window.AlignStorage)
 */

(function (global) {
  'use strict';

  function S() { return window.AlignStorage; }

  var CATEGORY = 'schedule';

  var state = {
    container: null,
    projectId: null,
    filter: 'all',           // 'all' | 'upcoming' | 'in_progress' | 'completed' | 'delayed'
    categoryFilter: 'all',    // 'all' | 'milestone' | 'inspection' | 'delivery' | 'meeting'
    editingItem: null,        // item being edited (or new item stub)
    viewMode: 'list'          // 'list' | 'form'
  };

  var STATUSES   = ['upcoming','in_progress','completed','delayed'];
  var CATEGORIES = ['milestone','inspection','delivery','meeting'];

  var STATUS_LABELS  = { upcoming:'Upcoming', in_progress:'In Progress', completed:'Completed', delayed:'Delayed' };
  var STATUS_COLORS  = { upcoming:'var(--brand-light)', in_progress:'var(--warning)', completed:'var(--success)', delayed:'var(--danger)' };
  var CATEGORY_ICONS = { milestone:'🎯', inspection:'🔍', delivery:'🚚', meeting:'📋' };

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function uid()  { return 'sc_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function nowISO(){ return new Date().toISOString(); }

  function statusLabel(s) { return STATUS_LABELS[s]||s; }
  function statusColor(s) { return STATUS_COLORS[s]||'var(--muted)'; }
  function catIcon(c)     { return CATEGORY_ICONS[c]||'📌'; }
  function catLabel(c)    { return (c||'').charAt(0).toUpperCase()+(c||'').slice(1); }

  function fmtDate(iso) {
    try { var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric'}); }
    catch(e){return '';}
  }

  function getItems() {
    if (!state.projectId) return [];
    return S().listRecords(state.projectId, CATEGORY);
  }

  function countByStatus(status) {
    return getItems().filter(function(i){ return i.status===status; }).length;
  }

  /* ── Inject CSS ─────────────────────────────────────────────────────── */
  
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
    var s = S();
    if (!s) { state.projectId = null; return; }
    var active = s.getActiveProject();
    state.projectId = active ? active.id : null;
  }

  function _paint() {
    var c = state.container;
    if (!c) return;
    _resolveProjectId();
    if (!state.projectId) {
      c.innerHTML = '<div class="sc-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
      return;
    }

    if (state.viewMode === 'form' && state.editingItem) {
      c.innerHTML = _formHtml(state.editingItem);
      _bindForm();
      return;
    }

    c.innerHTML = _listHtml();
    _bindList();
  }

  /* ── List View ──────────────────────────────────────────────────────── */
  function _listHtml() {
    var items = getItems();
    var h = [];

    // Status stats bar
    h.push('<div class="sc-stats">');
    var total = items.length;
    var counts = {
      all: total,
      upcoming: countByStatus('upcoming'),
      in_progress: countByStatus('in_progress'),
      completed: countByStatus('completed'),
      delayed: countByStatus('delayed')
    };

    ['all','upcoming','in_progress','completed','delayed'].forEach(function(s){
      var active = state.filter === s ? ' active' : '';
      var color = STATUS_COLORS[s] || '';
      h.push('<button class="sc-stat-btn'+active+'" data-sc-filter="'+s+'">');
      h.push('<span class="sc-stat-count">'+counts[s]+'</span>');
      h.push('<span class="sc-stat-label" style="color:'+color+'">'+(s==='all'?'Total':statusLabel(s))+'</span>');
      h.push('</button>');
    });
    h.push('</div>');

    // Header
    h.push('<div class="sc-header">');
    h.push('<div class="sc-header-left">');
    h.push('<h3 class="sc-title">📅 Schedule</h3>');
    h.push('<select class="sc-category-filter" id="sc-category-filter">');
    h.push('<option value="all"'+(state.categoryFilter==='all'?' selected':'')+'>All Types</option>');
    CATEGORIES.forEach(function(cat){
      h.push('<option value="'+cat+'"'+(state.categoryFilter===cat?' selected':'')+'>'+catLabel(cat)+'</option>');
    });
    h.push('</select>');
    h.push('</div>');
    h.push('<button class="pm-btn primary" id="sc-new-btn">+ New Milestone</button>');
    h.push('</div>');

    // Filter
    var filtered = items;
    if (state.filter !== 'all') filtered = filtered.filter(function(i){ return i.status === state.filter; });
    if (state.categoryFilter !== 'all') filtered = filtered.filter(function(i){ return i.category === state.categoryFilter; });

    // Sort by milestoneDate ascending
    filtered.sort(function(a,b){
      return (a.milestoneDate||'').localeCompare(b.milestoneDate||'');
    });

    if (filtered.length === 0) {
      h.push('<div class="sc-empty"><strong>No milestones</strong><p>'+
        (items.length===0?'Start by adding your first schedule milestone.':'No items match the current filters.')+
        '</p></div>');
    } else {
      // Group by status
      var groups = {};
      var groupOrder = ['upcoming','in_progress','delayed','completed'];
      filtered.forEach(function(item){
        var key = item.status || 'upcoming';
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      });

      groupOrder.forEach(function(status){
        var group = groups[status];
        if (!group || !group.length) return;
        h.push('<div class="sc-group">');
        h.push('<div class="sc-group-header">');
        h.push('<span class="sc-status-dot" style="background:'+statusColor(status)+'"></span>');
        h.push(statusLabel(status));
        h.push('<span class="sc-group-count">'+group.length+'</span>');
        h.push('</div>');

        group.forEach(function(item){
          var dateStr = fmtDate(item.milestoneDate);
          var isOverdue = item.status==='upcoming' && item.milestoneDate && item.milestoneDate < new Date().toISOString().slice(0,10);

          h.push('<div class="sc-card" data-sc-id="'+esc(item.id)+'">');
          h.push('<div class="sc-card-left">');
          // Status dot
          h.push('<div class="sc-status-dot" style="background:'+statusColor(item.status)+'" title="'+statusLabel(item.status)+'"></div>');
          h.push('<div class="sc-card-body">');
          // Top row: category icon + title
          h.push('<div class="sc-card-top">');
          h.push('<span class="sc-card-cat" title="'+catLabel(item.category)+'">'+catIcon(item.category)+'</span>');
          h.push('<span class="sc-card-title'+(item.status==='completed'?'" style="text-decoration:line-through;color:var(--muted)':'')+'">'+esc(item.title||'Untitled')+'</span>');
          h.push('</div>');
          // Meta row
          h.push('<div class="sc-card-meta">');
          if (dateStr) h.push('<span style="'+(isOverdue?'color:var(--danger);font-weight:600':'')+'">📅 '+(isOverdue?'OVERDUE: ':'')+dateStr+'</span>');
          h.push('<span class="sc-cat-badge">'+catIcon(item.category)+' '+catLabel(item.category)+'</span>');
          if (item.dependencies) h.push('<span>🔗 '+esc(item.dependencies)+'</span>');
          if (item.description) h.push('<span>💬 '+esc(item.description.slice(0,60))+(item.description.length>60?'…':'')+'</span>');
          h.push('</div>');
          h.push('</div>');
          h.push('</div>');

          // Quick actions
          h.push('<div class="sc-card-actions">');
          if (item.status === 'upcoming') {
            h.push('<button class="sc-action-btn sc-action-start" data-sc-act="start" data-sc-id="'+esc(item.id)+'" title="Start work">▶</button>');
            h.push('<button class="sc-action-btn sc-action-delay" data-sc-act="delay" data-sc-id="'+esc(item.id)+'" title="Mark delayed">⚠</button>');
          }
          if (item.status === 'in_progress') {
            h.push('<button class="sc-action-btn sc-action-complete" data-sc-act="complete" data-sc-id="'+esc(item.id)+'" title="Mark completed">✓</button>');
            h.push('<button class="sc-action-btn sc-action-delay" data-sc-act="delay" data-sc-id="'+esc(item.id)+'" title="Mark delayed">⚠</button>');
          }
          if (item.status === 'delayed') {
            h.push('<button class="sc-action-btn sc-action-start" data-sc-act="start" data-sc-id="'+esc(item.id)+'" title="Start / resume">▶</button>');
            h.push('<button class="sc-action-btn sc-action-complete" data-sc-act="complete" data-sc-id="'+esc(item.id)+'" title="Mark completed">✓</button>');
          }
          h.push('<button class="pm-btn small" data-sc-act="edit" data-sc-id="'+esc(item.id)+'">Edit</button>');
          h.push('<button class="pm-btn small danger" data-sc-act="delete" data-sc-id="'+esc(item.id)+'">✕</button>');
          h.push('</div>');
          h.push('</div>');
        });

        h.push('</div>');
      });
    }

    return '<div class="sc-wrap">'+h.join('')+'</div>';
  }

  function _bindList() {
    // Filter buttons
    document.querySelectorAll('.sc-stat-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        state.filter = btn.getAttribute('data-sc-filter');
        _paint();
      });
    });

    // Category filter
    var cf = document.getElementById('sc-category-filter');
    if (cf) cf.addEventListener('change',function(){ state.categoryFilter = this.value; _paint(); });

    // New button
    var nb = document.getElementById('sc-new-btn');
    if (nb) nb.addEventListener('click',function(){
      state.editingItem = {
        id: '',
        title: '',
        description: '',
        milestoneDate: new Date().toISOString().slice(0,10),
        status: 'upcoming',
        category: 'milestone',
        dependencies: '',
        createdAt: '',
        updatedAt: ''
      };
      state.viewMode = 'form';
      _paint();
    });

    // Delegated actions
    var wrap = document.querySelector('.sc-wrap');
    if (wrap) wrap.addEventListener('click',function(e){
      var btn = e.target.closest('[data-sc-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-sc-act');
      var id = btn.getAttribute('data-sc-id');

      if (act === 'edit') {
        var item = getItems().find(function(i){ return i.id === id; });
        if (item) { state.editingItem = JSON.parse(JSON.stringify(item)); state.viewMode = 'form'; _paint(); }
      }
      if (act === 'delete') {
        var delItem = getItems().find(function(i){ return i.id === id; });
        if (confirm('Delete milestone "'+((delItem||{}).title||'')+'"?')) {
          S().deleteRecord(state.projectId, CATEGORY, id);
          _paint();
        }
      }
      if (act === 'start' || act === 'complete' || act === 'delay') {
        var newStatus = act === 'start' ? 'in_progress' : act === 'complete' ? 'completed' : 'delayed';
        var updItem = getItems().find(function(i){ return i.id === id; });
        if (updItem) {
          updItem.status = newStatus;
          updItem.updatedAt = nowISO();
          if (newStatus === 'completed') updItem.completedAt = nowISO();
          S().saveRecord(state.projectId, CATEGORY, updItem);
          _paint();
        }
      }
    });
  }

  /* ── Form View ──────────────────────────────────────────────────────── */
  function _formHtml(item) {
    var h = [];
    h.push('<div class="sc-form-wrap">');
    h.push('<div class="sc-form-header">');
    h.push('<button class="pm-btn" id="sc-form-back">← Back</button>');
    h.push('<h3 class="sc-form-title">'+(item.id?'Edit Milestone':'New Milestone')+'</h3>');
    h.push('<button class="pm-btn primary" id="sc-form-save">💾 Save</button>');
    h.push('</div>');

    // Row: Status + Category
    h.push('<div class="sc-form-row">');
    h.push('<div class="sc-form-section"><label class="sc-field-label">Status</label><select class="sc-select" id="sc-status">');
    STATUSES.forEach(function(s){
      h.push('<option value="'+s+'"'+(item.status===s?' selected':'')+'>'+statusLabel(s)+'</option>');
    });
    h.push('</select></div>');
    h.push('<div class="sc-form-section"><label class="sc-field-label">Category</label><select class="sc-select" id="sc-category">');
    CATEGORIES.forEach(function(c){
      h.push('<option value="'+c+'"'+(item.category===c?' selected':'')+'>'+catIcon(c)+' '+catLabel(c)+'</option>');
    });
    h.push('</select></div>');
    h.push('</div>');

    // Title
    h.push('<div class="sc-form-section">');
    h.push('<label class="sc-field-label">Title</label>');
    h.push('<input type="text" class="sc-input" id="sc-title" value="'+esc(item.title||'')+'" placeholder="e.g. Foundation pour inspection, Framing walkthrough…">');
    h.push('</div>');

    // Description
    h.push('<div class="sc-form-section">');
    h.push('<label class="sc-field-label">Description</label>');
    h.push('<textarea class="sc-textarea" id="sc-desc" rows="3" placeholder="Details about this milestone…">'+esc(item.description||'')+'</textarea>');
    h.push('</div>');

    // Row: Date + Dependencies
    h.push('<div class="sc-form-row">');
    h.push('<div class="sc-form-section"><label class="sc-field-label">Milestone Date</label><input type="date" class="sc-input" id="sc-date" value="'+esc(item.milestoneDate||'')+'"></div>');
    h.push('<div class="sc-form-section"><label class="sc-field-label">Dependencies</label><input type="text" class="sc-input" id="sc-deps" value="'+esc(item.dependencies||'')+'" placeholder="e.g. Foundation must be cured, Steel delivered…"></div>');
    h.push('</div>');

    // Timestamps (read-only)
    if (item.id) {
      h.push('<div class="sc-form-row">');
      h.push('<div class="sc-form-section"><label class="sc-field-label">Created</label><input type="text" class="sc-input" value="'+esc(fmtDate(item.createdAt))+' - '+esc(item.createdAt||'')+'" readonly></div>');
      h.push('<div class="sc-form-section"><label class="sc-field-label">Updated</label><input type="text" class="sc-input" value="'+esc(fmtDate(item.updatedAt))+' - '+esc(item.updatedAt||'')+'" readonly></div>');
      h.push('</div>');
    }

    h.push('<p class="sc-deps-note">💡 Use dependencies to note prerequisites before this milestone can start.</p>');

    h.push('</div>');
    return h.join('');
  }

  function _bindForm() {
    document.getElementById('sc-form-back').addEventListener('click',function(){
      state.viewMode = 'list'; state.editingItem = null; _paint();
    });
    document.getElementById('sc-form-save').addEventListener('click',function(){
      var item = state.editingItem;
      item.title       = (document.getElementById('sc-title')?.value||'').trim();
      item.description = (document.getElementById('sc-desc')?.value||'').trim();
      item.milestoneDate = document.getElementById('sc-date')?.value||'';
      item.status      = document.getElementById('sc-status')?.value||'upcoming';
      item.category    = document.getElementById('sc-category')?.value||'milestone';
      item.dependencies = (document.getElementById('sc-deps')?.value||'').trim();
      item.updatedAt   = nowISO();
      if (!item.createdAt) item.createdAt = nowISO();
      if (!item.id) item.id = uid();
      S().saveRecord(state.projectId, CATEGORY, item);
      state.viewMode = 'list'; state.editingItem = null; _paint();
    });
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  global.AlignSchedule = Object.freeze({
    render: render,
    CATEGORY: CATEGORY
  });

  if (window.TileRegistry) window.TileRegistry.register({ id: 'schedule', title: 'Schedule', icon: '[]', route: 'schedule', roles: ['user','admin'], order: 8 });
})(window);

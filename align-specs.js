/* align-specs.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Specs module (technical specifications reference)
 * Depends on: align-storage.js (window.AlignStorage)
 */

(function (global) {
  'use strict';

  function S() { return window.AlignStorage; }

  var CATEGORY = 'specs';

  var state = {
    container: null,
    chrome: null,
    projectId: null,
    filter: 'all',           // 'all' | 'current' | 'superseded'
    sectionFilter: 'all',
    editingItem: null,
    viewMode: 'list'         // 'list' | 'form'
  };
  /* ── Helpers ────────────────────────────────────────────────────────── */
  function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
  function uid()  { return 'sp_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function nowISO(){ return new Date().toISOString(); }

  function fmtDate(iso) {
    try { var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric'}); }
    catch(e){return '';}
  }

  function getItems() {
    if (!state.projectId) return [];
    return S().listRecords(state.projectId, CATEGORY);
  }

  function statusLabel(s) {
    var m={current:'Current',superseded:'Superseded'};
    return m[s]||s;
  }

  function statusColor(s) {
    var m={current:'var(--success)',superseded:'var(--muted)'};
    return m[s]||'var(--muted)';
  }

  function getSections(items) {
    var seen={},sections=[];
    items.forEach(function(i){
      var s=(i.section||'').trim();
      if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()]=true; sections.push(s); }
    });
    return sections.sort();
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function render(container, chrome) {
    if (!container) return;
    state.container = container;
    state.chrome = chrome || null;
    state.projectId = null;
    state.filter = 'all';
    state.sectionFilter = 'all';
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
    _renderHeader();
    if (!state.projectId) {
      c.innerHTML='<div class="sp-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
      return;
    }

    if (state.viewMode==='form' && state.editingItem) {
      c.innerHTML=_formHtml(state.editingItem);
      _bindForm();
      return;
    }

    c.innerHTML=_listHtml();
    _bindList();
  }

  function _renderHeader() {
    if (!state.chrome || !state.chrome.setHeader) return;
    if (state.viewMode==='form' && state.editingItem) {
      state.chrome.setHeader({
        title: state.editingItem.id ? 'Edit Specification' : 'New Specification',
        backLabel: 'Back to Specs',
        actions: [{ id: 'sp-save', label: 'Save', variant: 'primary', type: 'submit', form: 'sp-form' }]
      });
    } else {
      state.chrome.setHeader({
        title: 'Specs',
        backLabel: 'Back',
        actions: [{ id: 'sp-new', label: '+ New Spec', variant: 'primary', onClick: _newSpec }]
      });
    }
  }

  function _newSpec() {
    state.editingItem={id:'',title:'',section:'',description:'',version:'',status:'current',fileRef:'',notes:''};
    state.viewMode='form';
    _paint();
  }

  function handleBack() {
    if (state.viewMode==='form') { state.viewMode='list'; state.editingItem=null; _paint(); return true; }
    return false;
  }

  /* ── List View ──────────────────────────────────────────────────────── */
  function _listHtml() {
    var items=getItems();
    var h=[];

    // Stats row
    h.push('<div class="sp-stats">');
    var total=items.length;
    var current=items.filter(function(i){return i.status==='current';}).length;
    var superseded=items.filter(function(i){return i.status==='superseded';}).length;

    ['all','current','superseded'].forEach(function(s){
      var count=s==='all'?total:(s==='current'?current:superseded);
      var active=state.filter===s?' sp-stat-btn-active':'';
      var color=s==='current'?'var(--success)':s==='superseded'?'var(--muted)':'';
      h.push('<button class="sp-stat-btn'+active+'" data-sp-filter="'+s+'">');
      h.push('<span class="sp-stat-count">'+count+'</span>');
      h.push('<span class="sp-stat-label" style="color:'+color+'">'+(s==='all'?'All':statusLabel(s))+'</span>');
      h.push('</button>');
    });
    h.push('</div>');

    // Section filter
    var sections=getSections(items);
    h.push('<div class="sp-header">');
    h.push('<select class="sp-section-filter" id="sp-section-filter">');
    h.push('<option value="all"'+(state.sectionFilter==='all'?' selected':'')+'>All Sections</option>');
    sections.forEach(function(sec){
      h.push('<option value="'+esc(sec)+'"'+(state.sectionFilter===sec?' selected':'')+'>'+esc(sec)+'</option>');
    });
    h.push('</select>');
    h.push('</div>');

    // Filter
    var filtered=items;
    if (state.filter!=='all') filtered=filtered.filter(function(i){return i.status===state.filter;});
    if (state.sectionFilter!=='all') filtered=filtered.filter(function(i){return (i.section||'').trim()===state.sectionFilter;});

    if (filtered.length===0) {
      h.push('<div class="sp-empty"><strong>No specifications</strong><p>'+(items.length===0?'Start by adding your first specification.':'No items match the current filters.')+'</p></div>');
    } else {
      h.push('<div class="sp-list">');
      filtered.forEach(function(item){
        var statCol=statusColor(item.status);
        var isSuperseded=item.status==='superseded';

        h.push('<div class="sp-card pm-card'+(isSuperseded?' sp-card-superseded':'')+'">');
        h.push('<div class="sp-card-left">');
        h.push('<div class="sp-status-dot" style="background:'+statCol+'" title="'+statusLabel(item.status)+'"></div>');
        h.push('<div class="sp-card-body">');
        h.push('<div class="sp-card-top">');
        h.push('<span class="sp-card-title">'+esc(item.title||'Untitled')+'</span>');
        if (item.version) h.push('<span class="sp-version-badge">v'+esc(item.version)+'</span>');
        h.push('</div>');
        if (item.section) h.push('<div class="sp-card-section"><span class="sp-section-badge">📁 '+esc(item.section)+'</span></div>');
        if (item.description) h.push('<div class="sp-card-desc">'+esc(item.description).replace(/\n/g,'<br>')+'</div>');
        h.push('<div class="sp-card-meta">');
        if (item.fileRef) h.push('<span>📎 '+esc(item.fileRef)+'</span>');
        h.push('<span>Updated '+fmtDate(item.updatedAt)+'</span>');
        h.push('</div>');
        h.push('</div>');
        h.push('</div>');
        // Actions
        h.push('<div class="sp-card-actions">');
        if (item.status==='current') {
          h.push('<button class="sp-action-btn sp-action-supersede" data-sp-act="supersede" data-sp-id="'+esc(item.id)+'" title="Mark as superseded">📋</button>');
        } else {
          h.push('<button class="sp-action-btn sp-action-restore" data-sp-act="restore" data-sp-id="'+esc(item.id)+'" title="Restore as current">🔄</button>');
        }
        h.push('<button class="pm-btn small" data-sp-act="edit" data-sp-id="'+esc(item.id)+'">Edit</button>');
        h.push('<button class="pm-btn small danger" data-sp-act="delete" data-sp-id="'+esc(item.id)+'">✕</button>');
        h.push('</div>');
        h.push('</div>');
      });
      h.push('</div>');
    }

    return '<div class="sp-wrap">'+h.join('')+'</div>';
  }

  function _bindList() {
    // Filter buttons
    document.querySelectorAll('.sp-stat-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        state.filter=btn.getAttribute('data-sp-filter');
        _paint();
      });
    });

    // Section filter
    var sf=document.getElementById('sp-section-filter');
    if (sf) sf.addEventListener('change',function(){ state.sectionFilter=this.value; _paint(); });

    // Delegated actions
    var wrap=document.querySelector('.sp-wrap');
    if (wrap) wrap.addEventListener('click',function(e){
      var btn=e.target.closest('[data-sp-act]');
      if (!btn) return;
      var act=btn.getAttribute('data-sp-act');
      var id=btn.getAttribute('data-sp-id');

      if (act==='edit') {
        var item=getItems().find(function(i){return i.id===id;});
        if (item) { state.editingItem=JSON.parse(JSON.stringify(item)); state.viewMode='form'; _paint(); }
      }
      if (act==='delete') {
        if (confirm('Delete spec "'+(getItems().find(function(i){return i.id===id;})||{}).title||''+'"?')) {
          S().deleteRecord(state.projectId,CATEGORY,id);
          _paint();
        }
      }
      if (act==='supersede'||act==='restore') {
        var newStatus=act==='supersede'?'superseded':'current';
        var item=getItems().find(function(i){return i.id===id;});
        if (item) {
          item.status=newStatus;
          item.updatedAt=nowISO();
          S().saveRecord(state.projectId,CATEGORY,item);
          _paint();
        }
      }
    });
  }

  /* ── Form View ──────────────────────────────────────────────────────── */
  function _formHtml(item) {
    var h=[];
    h.push('<form id="sp-form" class="sp-form-wrap">');

    // Title
    h.push('<div class="sp-form-section">');
    h.push('<label class="sp-field-label">Title</label>');
    h.push('<input type="text" class="sp-input" id="sp-title" value="'+esc(item.title||'')+'" placeholder="e.g. Concrete mix design — 4000 PSI">');
    h.push('</div>');

    // Description
    h.push('<div class="sp-form-section">');
    h.push('<label class="sp-field-label">Description / Content</label>');
    h.push('<textarea class="sp-textarea" id="sp-desc" rows="4" placeholder="Full specification details, requirements, standards references…">'+esc(item.description||'')+'</textarea>');
    h.push('</div>');

    // Row: Section + Version
    h.push('<div class="sp-form-row">');
    h.push('<div class="sp-form-field"><label class="sp-field-label">Section</label><input type="text" class="sp-input" id="sp-section" value="'+esc(item.section||'')+'" placeholder="e.g. 03 30 00 — Cast-in-Place Concrete"></div>');
    h.push('<div class="sp-form-field sp-field-sm"><label class="sp-field-label">Version</label><input type="text" class="sp-input" id="sp-version" value="'+esc(item.version||'')+'" placeholder="1.0"></div>');
    h.push('</div>');

    // Row: Status + FileRef
    h.push('<div class="sp-form-row">');
    h.push('<div class="sp-form-field"><label class="sp-field-label">Status</label><select class="sp-input" id="sp-status">');
    h.push('<option value="current"'+(item.status==='current'?' selected':'')+'>Current</option>');
    h.push('<option value="superseded"'+(item.status==='superseded'?' selected':'')+'>Superseded</option>');
    h.push('</select></div>');
    h.push('<div class="sp-form-field"><label class="sp-field-label">File Reference</label><input type="text" class="sp-input" id="sp-file" value="'+esc(item.fileRef||'')+'" placeholder="Path or URL to spec document"></div>');
    h.push('</div>');

    // Notes
    h.push('<div class="sp-form-section">');
    h.push('<label class="sp-field-label">Notes</label>');
    h.push('<textarea class="sp-textarea" id="sp-notes" rows="2" placeholder="Additional notes or change history…">'+esc(item.notes||'')+'</textarea>');
    h.push('</div>');

    h.push('</form>');
    return h.join('');
  }

  function _bindForm() {
    var form = document.getElementById('sp-form');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var item=state.editingItem;
      item.title=(document.getElementById('sp-title')?.value||'').trim();
      item.section=(document.getElementById('sp-section')?.value||'').trim();
      item.description=(document.getElementById('sp-desc')?.value||'').trim();
      item.version=(document.getElementById('sp-version')?.value||'').trim();
      item.status=document.getElementById('sp-status')?.value||'current';
      item.fileRef=(document.getElementById('sp-file')?.value||'').trim();
      item.notes=(document.getElementById('sp-notes')?.value||'').trim();
      item.updatedAt=nowISO();
      if (!item.createdAt) item.createdAt=nowISO();
      if (!item.id) item.id=uid();
      S().saveRecord(state.projectId,CATEGORY,item);
      state.viewMode='list'; state.editingItem=null; _paint();
    });
  }

  /* ── CSS Injection ───────────────────────────────────────────────────── */
  
  /* ── Public API ─────────────────────────────────────────────────────── */
  global.AlignSpecs = Object.freeze({
    render: render,
    handleBack: handleBack,
    CATEGORY: CATEGORY
  });
  if (window.TileRegistry) window.TileRegistry.register({ id: 'specs', title: 'Specifications', icon: '[]', route: 'specs', roles: ['user','admin'], order: 10 });
})(window);

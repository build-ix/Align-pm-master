/* align-budget.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Budget module (cost tracking, line items, change orders)
 * Depends on: align-storage.js (window.AlignStorage)
 */

(function (global) {
  'use strict';

  function S() { return window.AlignStorage; }

  var CATEGORY = 'budget';

  var state = {
    container: null,
    projectId: null,
    filter: 'all',           // 'all' | 'approved' | 'pending' | 'paid'
    categoryFilter: 'all',   // 'all' | 'labor' | 'materials' | 'equipment' | 'subcontractor' | 'other'
    editingItem: null,
    viewMode: 'list'         // 'list' | 'form'
  };

  var CATEGORIES = ['labor','materials','equipment','subcontractor','other'];
  var STATUSES = ['approved','pending','paid'];
  /* ── Helpers ────────────────────────────────────────────────────────── */
  function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
  function uid()  { return 'bg_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function nowISO(){ return new Date().toISOString(); }

  function fmtDate(iso) {
    try { var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric'}); }
    catch(e){return '';}
  }

  function fmtCurrency(n) {
    var num=parseFloat(n)||0;
    return '$'+num.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function getItems() {
    if (!state.projectId) return [];
    return S().listRecords(state.projectId, CATEGORY);
  }

  function catLabel(c) {
    var m={labor:'Labor',materials:'Materials',equipment:'Equipment',subcontractor:'Subcontractor',other:'Other'};
    return m[c]||c;
  }

  function statusLabel(s) {
    var m={approved:'Approved',pending:'Pending',paid:'Paid'};
    return m[s]||s;
  }

  function statusColor(s) {
    var m={approved:'var(--success)',pending:'var(--warning)',paid:'var(--brand)'};
    return m[s]||'var(--muted)';
  }

  function catColor(c) {
    var m={labor:'#8b5cf6',materials:'#f59e0b',equipment:'#3b82f6',subcontractor:'#ec4899',other:'#6b7280'};
    return m[c]||'var(--muted)';
  }

  function totalBy(items) {
    return items.reduce(function(sum,i){return sum+(parseFloat(i.amount)||0);},0);
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
      c.innerHTML='<div class="bg-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
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

  /* ── List View ──────────────────────────────────────────────────────── */
  function _listHtml() {
    var items=getItems();
    var h=[];

    // Stats row
    h.push('<div class="bg-stats">');
    var total=items.length;
    var approved=items.filter(function(i){return i.status==='approved';}).length;
    var pending=items.filter(function(i){return i.status==='pending';}).length;
    var paid=items.filter(function(i){return i.status==='paid';}).length;
    var grandTotal=totalBy(items);

    ['all','approved','pending','paid'].forEach(function(s){
      var count=s==='all'?total:(s==='approved'?approved:s==='pending'?pending:paid);
      var active=state.filter===s?' bg-stat-btn-active':'';
      var color=s==='approved'?'var(--success)':s==='pending'?'var(--warning)':s==='paid'?'var(--brand)':'';
      h.push('<button class="bg-stat-btn'+active+'" data-bg-filter="'+s+'">');
      h.push('<span class="bg-stat-count">'+count+'</span>');
      h.push('<span class="bg-stat-label" style="color:'+color+'">'+(s==='all'?'All':statusLabel(s))+'</span>');
      h.push('</button>');
    });

    h.push('<div class="bg-total-display"><span class="bg-total-label">Total</span><span class="bg-total-value">'+fmtCurrency(grandTotal)+'</span></div>');
    h.push('</div>');

    // Header + filters
    h.push('<div class="bg-header">');
    h.push('<div class="bg-header-left">');
    h.push('<h3 class="bg-title">Budget</h3>');
    h.push('<select class="bg-cat-filter" id="bg-cat-filter">');
    h.push('<option value="all"'+(state.categoryFilter==='all'?' selected':'')+'>All Categories</option>');
    CATEGORIES.forEach(function(c){
      h.push('<option value="'+c+'"'+(state.categoryFilter===c?' selected':'')+'>'+catLabel(c)+'</option>');
    });
    h.push('</select>');
    h.push('</div>');
    h.push('<button class="pm-btn primary" id="bg-new-btn">+ New Item</button>');
    h.push('</div>');

    // Filter
    var filtered=items;
    if (state.filter!=='all') filtered=filtered.filter(function(i){return i.status===state.filter;});
    if (state.categoryFilter!=='all') filtered=filtered.filter(function(i){return (i.category||'other')===state.categoryFilter;});

    var filteredTotal=totalBy(filtered);

    if (filtered.length===0) {
      h.push('<div class="bg-empty"><strong>No budget items</strong><p>'+(items.length===0?'Start by adding your first budget item.':'No items match the current filters.')+'</p></div>');
    } else {
      h.push('<div class="bg-filtered-total">Filtered total: <strong>'+fmtCurrency(filteredTotal)+'</strong></div>');
      h.push('<div class="bg-list">');
      filtered.forEach(function(item){
        var statCol=statusColor(item.status);
        var catC=catColor(item.category||'other');

        h.push('<div class="bg-card pm-card">');
        h.push('<div class="bg-card-left">');
        h.push('<div class="bg-status-dot" style="background:'+statCol+'" title="'+statusLabel(item.status)+'"></div>');
        h.push('<div class="bg-card-body">');
        h.push('<div class="bg-card-top">');
        h.push('<span class="bg-card-title">'+esc(item.title||'Untitled')+'</span>');
        h.push('<span class="bg-amount">'+fmtCurrency(item.amount)+'</span>');
        h.push('</div>');
        h.push('<div class="bg-card-meta">');
        h.push('<span class="bg-cat-badge" style="background:'+catC+'20;color:'+catC+'">'+catLabel(item.category||'other')+'</span>');
        if (item.vendor) h.push('<span>🏢 '+esc(item.vendor)+'</span>');
        if (item.invoiceRef) h.push('<span>📄 '+esc(item.invoiceRef)+'</span>');
        if (item.date) h.push('<span>📅 '+fmtDate(item.date)+'</span>');
        h.push('<span>'+fmtDate(item.updatedAt||item.createdAt)+'</span>');
        h.push('</div>');
        h.push('</div>');
        h.push('</div>');
        // Actions
        h.push('<div class="bg-card-actions">');
        h.push('<button class="pm-btn small" data-bg-act="edit" data-bg-id="'+esc(item.id)+'">Edit</button>');
        h.push('<button class="pm-btn small danger" data-bg-act="delete" data-bg-id="'+esc(item.id)+'">✕</button>');
        h.push('</div>');
        h.push('</div>');
      });
      h.push('</div>');
    }

    return '<div class="bg-wrap">'+h.join('')+'</div>';
  }

  function _bindList() {
    // Filter buttons
    document.querySelectorAll('.bg-stat-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        state.filter=btn.getAttribute('data-bg-filter');
        _paint();
      });
    });

    // Category filter
    var cf=document.getElementById('bg-cat-filter');
    if (cf) cf.addEventListener('change',function(){ state.categoryFilter=this.value; _paint(); });

    // New button
    var nb=document.getElementById('bg-new-btn');
    if (nb) nb.addEventListener('click',function(){
      state.editingItem={id:'',title:'',amount:'',category:'other',status:'pending',vendor:'',invoiceRef:'',notes:'',date:''};
      state.viewMode='form';
      _paint();
    });

    // Delegated actions
    var wrap=document.querySelector('.bg-wrap');
    if (wrap) wrap.addEventListener('click',function(e){
      var btn=e.target.closest('[data-bg-act]');
      if (!btn) return;
      var act=btn.getAttribute('data-bg-act');
      var id=btn.getAttribute('data-bg-id');

      if (act==='edit') {
        var item=getItems().find(function(i){return i.id===id;});
        if (item) { state.editingItem=JSON.parse(JSON.stringify(item)); state.viewMode='form'; _paint(); }
      }
      if (act==='delete') {
        if (confirm('Delete budget item "'+(getItems().find(function(i){return i.id===id;})||{}).title||''+'"?')) {
          S().deleteRecord(state.projectId,CATEGORY,id);
          _paint();
        }
      }
    });
  }

  /* ── Form View ──────────────────────────────────────────────────────── */
  function _formHtml(item) {
    var h=[];
    h.push('<div class="bg-form-wrap">');
    h.push('<div class="bg-form-header">');
    h.push('<button class="pm-btn" id="bg-form-back">← Back</button>');
    h.push('<h3 class="bg-form-title">'+(item.id?'Edit Budget Item':'New Budget Item')+'</h3>');
    h.push('<button class="pm-btn primary" id="bg-form-save">💾 Save</button>');
    h.push('</div>');

    // Title
    h.push('<div class="bg-form-section">');
    h.push('<label class="bg-field-label">Title</label>');
    h.push('<input type="text" class="bg-input" id="bg-title" value="'+esc(item.title||'')+'" placeholder="e.g. Framing lumber delivery">');
    h.push('</div>');

    // Row: Amount + Category
    h.push('<div class="bg-form-row">');
    h.push('<div class="bg-form-field"><label class="bg-field-label">Amount ($)</label><input type="number" class="bg-input" id="bg-amount" value="'+esc(item.amount||'')+'" placeholder="0.00" step="0.01" min="0"></div>');
    h.push('<div class="bg-form-field"><label class="bg-field-label">Category</label><select class="bg-input" id="bg-category">');
    CATEGORIES.forEach(function(c){ h.push('<option value="'+c+'"'+(item.category===c?' selected':'')+'>'+catLabel(c)+'</option>'); });
    h.push('</select></div>');
    h.push('</div>');

    // Row: Status + Date
    h.push('<div class="bg-form-row">');
    h.push('<div class="bg-form-field"><label class="bg-field-label">Status</label><select class="bg-input" id="bg-status">');
    STATUSES.forEach(function(s){ h.push('<option value="'+s+'"'+(item.status===s?' selected':'')+'>'+statusLabel(s)+'</option>'); });
    h.push('</select></div>');
    h.push('<div class="bg-form-field"><label class="bg-field-label">Date</label><input type="date" class="bg-input" id="bg-date" value="'+esc(item.date||'')+'"></div>');
    h.push('</div>');

    // Row: Vendor + Invoice
    h.push('<div class="bg-form-row">');
    h.push('<div class="bg-form-field"><label class="bg-field-label">Vendor</label><input type="text" class="bg-input" id="bg-vendor" value="'+esc(item.vendor||'')+'" placeholder="Company name"></div>');
    h.push('<div class="bg-form-field"><label class="bg-field-label">Invoice Ref</label><input type="text" class="bg-input" id="bg-invoice" value="'+esc(item.invoiceRef||'')+'" placeholder="#INV-001"></div>');
    h.push('</div>');

    // Notes
    h.push('<div class="bg-form-section">');
    h.push('<label class="bg-field-label">Notes</label>');
    h.push('<textarea class="bg-textarea" id="bg-notes" rows="3" placeholder="Additional details…">'+esc(item.notes||'')+'</textarea>');
    h.push('</div>');

    h.push('</div>');
    return h.join('');
  }

  function _bindForm() {
    document.getElementById('bg-form-back').addEventListener('click',function(){
      state.viewMode='list'; state.editingItem=null; _paint();
    });
    document.getElementById('bg-form-save').addEventListener('click',function(){
      var item=state.editingItem;
      item.title=(document.getElementById('bg-title')?.value||'').trim();
      item.amount=parseFloat(document.getElementById('bg-amount')?.value)||0;
      item.category=document.getElementById('bg-category')?.value||'other';
      item.status=document.getElementById('bg-status')?.value||'pending';
      item.date=document.getElementById('bg-date')?.value||'';
      item.vendor=(document.getElementById('bg-vendor')?.value||'').trim();
      item.invoiceRef=(document.getElementById('bg-invoice')?.value||'').trim();
      item.notes=(document.getElementById('bg-notes')?.value||'').trim();
      item.updatedAt=nowISO();
      if (!item.createdAt) item.createdAt=nowISO();
      if (!item.id) item.id=uid();
      S().saveRecord(state.projectId,CATEGORY,item);
      state.viewMode='list'; state.editingItem=null; _paint();
    });
  }

  /* ── CSS Injection ───────────────────────────────────────────────────── */
  
  /* ── Public API ─────────────────────────────────────────────────────── */
  global.AlignBudget = Object.freeze({
    render: render,
    CATEGORY: CATEGORY
  });
})(window);

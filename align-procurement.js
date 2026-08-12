/* align-procurement.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Procurement module (purchase orders, material orders, lead times)
 * Depends on: align-storage.js (window.AlignStorage)
 */

(function (global) {
  'use strict';

  function S() { return window.AlignStorage; }

  var CATEGORY = 'procurement';

  var state = {
    container: null,
    projectId: null,
    filter: 'all',           // 'all' | 'ordered' | 'in_transit' | 'received' | 'delayed'
    editingItem: null,
    viewMode: 'list'         // 'list' | 'form'
  };

  var STATUSES = ['ordered','in_transit','received','delayed'];
  /* ── Helpers ────────────────────────────────────────────────────────── */
  function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
  function uid()  { return 'pr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
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
    var m={ordered:'Ordered',in_transit:'In Transit',received:'Received',delayed:'Delayed'};
    return m[s]||s;
  }

  function statusColor(s) {
    var m={ordered:'var(--brand)',in_transit:'var(--warning)',received:'var(--success)',delayed:'var(--danger)'};
    return m[s]||'var(--muted)';
  }

  function isOverdue(item) {
    if (item.status==='received') return false;
    if (!item.deliveryDate) return false;
    var delivery=new Date(item.deliveryDate+'T00:00:00');
    return delivery<new Date() && item.status!=='delayed';
  }

  function sortByDelivery(a,b) {
    if (a.status==='received' && b.status!=='received') return 1;
    if (b.status==='received' && a.status!=='received') return -1;
    if (a.status==='delayed' && b.status!=='delayed') return -1;
    if (b.status==='delayed' && a.status!=='delayed') return 1;
    var da=a.deliveryDate||'',db=b.deliveryDate||'';
    return da.localeCompare(db);
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function render(container) {
    if (!container) return;
    state.container = container;
    state.projectId = null;
    state.filter = 'all';
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
      c.innerHTML='<div class="pr-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
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
    h.push('<div class="pr-stats">');
    var total=items.length;
    var ordered=items.filter(function(i){return i.status==='ordered';}).length;
    var inTransit=items.filter(function(i){return i.status==='in_transit';}).length;
    var received=items.filter(function(i){return i.status==='received';}).length;
    var delayed=items.filter(function(i){return i.status==='delayed';}).length;
    var overdue=items.filter(function(i){return isOverdue(i);}).length;

    ['all','ordered','in_transit','received','delayed'].forEach(function(s){
      var count=s==='all'?total:(s==='ordered'?ordered:s==='in_transit'?inTransit:s==='received'?received:delayed);
      var active=state.filter===s?' pr-stat-btn-active':'';
      var color=s==='ordered'?'var(--brand)':s==='in_transit'?'var(--warning)':s==='received'?'var(--success)':s==='delayed'?'var(--danger)':'';
      h.push('<button class="pr-stat-btn'+active+'" data-pr-filter="'+s+'">');
      h.push('<span class="pr-stat-count">'+count+'</span>');
      h.push('<span class="pr-stat-label" style="color:'+color+'">'+(s==='all'?'All':statusLabel(s))+'</span>');
      h.push('</button>');
    });

    if (overdue>0) {
      h.push('<div class="pr-overdue-alert"><span>⚠️ '+overdue+' overdue</span></div>');
    }
    h.push('</div>');

    // Header
    h.push('<div class="pr-header">');
    h.push('<h3 class="pr-title">Procurement</h3>');
    h.push('<button class="pm-btn primary" id="pr-new-btn">+ New Order</button>');
    h.push('</div>');

    // Filter
    var filtered=items;
    if (state.filter!=='all') filtered=filtered.filter(function(i){return i.status===state.filter;});

    // Sort: delayed first, then by delivery date, received last
    filtered.sort(sortByDelivery);

    if (filtered.length===0) {
      h.push('<div class="pr-empty"><strong>No purchase orders</strong><p>'+(items.length===0?'Start by adding your first purchase order.':'No items match the current filters.')+'</p></div>');
    } else {
      h.push('<div class="pr-list">');
      filtered.forEach(function(item){
        var statCol=statusColor(item.status);
        var overdue=isOverdue(item);

        h.push('<div class="pr-card pm-card'+(overdue?' pr-card-overdue':'')+(item.status==='received'?' pr-card-received':'')+'">');
        h.push('<div class="pr-card-left">');
        h.push('<div class="pr-status-dot" style="background:'+statCol+'" title="'+statusLabel(item.status)+'"></div>');
        h.push('<div class="pr-card-body">');
        h.push('<div class="pr-card-top">');
        h.push('<span class="pr-card-title">'+esc(item.title||'Untitled')+'</span>');
        if (item.poNumber) h.push('<span class="pr-po-badge">PO: '+esc(item.poNumber)+'</span>');
        h.push('</div>');
        h.push('<div class="pr-card-meta">');
        if (item.item) h.push('<span>📦 '+esc(item.item)+(item.quantity?' × '+item.quantity:'')+(item.unit?' '+esc(item.unit):'')+'</span>');
        if (item.vendor) h.push('<span>🏢 '+esc(item.vendor)+'</span>');
        if (item.orderDate) h.push('<span>📋 Ordered '+fmtDate(item.orderDate)+'</span>');
        if (item.deliveryDate) h.push('<span class="'+(overdue?'pr-delivery-overdue':'')+'">🚚 '+(overdue?'OVERDUE: ':'')+'Due '+fmtDate(item.deliveryDate)+'</span>');
        h.push('<span>'+fmtDate(item.updatedAt||item.createdAt)+'</span>');
        h.push('</div>');
        h.push('</div>');
        h.push('</div>');
        // Actions
        h.push('<div class="pr-card-actions">');
        if (item.status==='ordered') {
          h.push('<button class="pr-action-btn pr-action-transit" data-pr-act="transit" data-pr-id="'+esc(item.id)+'" title="Mark as In Transit">🚚</button>');
        }
        if (item.status==='in_transit') {
          h.push('<button class="pr-action-btn pr-action-receive" data-pr-act="receive" data-pr-id="'+esc(item.id)+'" title="Mark as Received">✅</button>');
          h.push('<button class="pr-action-btn pr-action-delay" data-pr-act="delay" data-pr-id="'+esc(item.id)+'" title="Mark as Delayed">⚠️</button>');
        }
        if (item.status==='delayed') {
          h.push('<button class="pr-action-btn pr-action-transit" data-pr-act="transit" data-pr-id="'+esc(item.id)+'" title="Resume — In Transit">🚚</button>');
          h.push('<button class="pr-action-btn pr-action-receive" data-pr-act="receive" data-pr-id="'+esc(item.id)+'" title="Mark as Received">✅</button>');
        }
        h.push('<button class="pm-btn small" data-pr-act="edit" data-pr-id="'+esc(item.id)+'">Edit</button>');
        h.push('<button class="pm-btn small danger" data-pr-act="delete" data-pr-id="'+esc(item.id)+'">✕</button>');
        h.push('</div>');
        h.push('</div>');
      });
      h.push('</div>');
    }

    return '<div class="pr-wrap">'+h.join('')+'</div>';
  }

  function _bindList() {
    // Filter buttons
    document.querySelectorAll('.pr-stat-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        state.filter=btn.getAttribute('data-pr-filter');
        _paint();
      });
    });

    // New button
    var nb=document.getElementById('pr-new-btn');
    if (nb) nb.addEventListener('click',function(){
      state.editingItem={id:'',title:'',item:'',quantity:'',unit:'',vendor:'',orderDate:'',deliveryDate:'',status:'ordered',poNumber:'',notes:''};
      state.viewMode='form';
      _paint();
    });

    // Delegated actions
    var wrap=document.querySelector('.pr-wrap');
    if (wrap) wrap.addEventListener('click',function(e){
      var btn=e.target.closest('[data-pr-act]');
      if (!btn) return;
      var act=btn.getAttribute('data-pr-act');
      var id=btn.getAttribute('data-pr-id');

      if (act==='edit') {
        var item=getItems().find(function(i){return i.id===id;});
        if (item) { state.editingItem=JSON.parse(JSON.stringify(item)); state.viewMode='form'; _paint(); }
      }
      if (act==='delete') {
        if (confirm('Delete purchase order "'+(getItems().find(function(i){return i.id===id;})||{}).title||''+'"?')) {
          S().deleteRecord(state.projectId,CATEGORY,id);
          _paint();
        }
      }
      if (act==='transit'||act==='receive'||act==='delay') {
        var newStatus=act==='transit'?'in_transit':act==='receive'?'received':'delayed';
        var item=getItems().find(function(i){return i.id===id;});
        if (item) {
          item.status=newStatus;
          item.updatedAt=nowISO();
          if (newStatus==='received') item.receivedAt=nowISO();
          S().saveRecord(state.projectId,CATEGORY,item);
          _paint();
        }
      }
    });
  }

  /* ── Form View ──────────────────────────────────────────────────────── */
  function _formHtml(item) {
    var h=[];
    h.push('<div class="pr-form-wrap">');
    h.push('<div class="pr-form-header">');
    h.push('<button class="pm-btn" id="pr-form-back">← Back</button>');
    h.push('<h3 class="pr-form-title">'+(item.id?'Edit Purchase Order':'New Purchase Order')+'</h3>');
    h.push('<button class="pm-btn primary" id="pr-form-save">💾 Save</button>');
    h.push('</div>');

    // Title
    h.push('<div class="pr-form-section">');
    h.push('<label class="pr-field-label">Title</label>');
    h.push('<input type="text" class="pr-input" id="pr-title" value="'+esc(item.title||'')+'" placeholder="e.g. Structural steel beams — Phase 2">');
    h.push('</div>');

    // Row: Item + Quantity + Unit
    h.push('<div class="pr-form-row">');
    h.push('<div class="pr-form-field pr-field-lg"><label class="pr-field-label">Item</label><input type="text" class="pr-input" id="pr-item" value="'+esc(item.item||'')+'" placeholder="What is being ordered?"></div>');
    h.push('<div class="pr-form-field pr-field-sm"><label class="pr-field-label">Qty</label><input type="number" class="pr-input" id="pr-qty" value="'+esc(item.quantity||'')+'" placeholder="1" min="1" step="1"></div>');
    h.push('<div class="pr-form-field pr-field-sm"><label class="pr-field-label">Unit</label><input type="text" class="pr-input" id="pr-unit" value="'+esc(item.unit||'')+'" placeholder="ea"></div>');
    h.push('</div>');

    // Row: Vendor + PO Number
    h.push('<div class="pr-form-row">');
    h.push('<div class="pr-form-field"><label class="pr-field-label">Vendor</label><input type="text" class="pr-input" id="pr-vendor" value="'+esc(item.vendor||'')+'" placeholder="Supplier name"></div>');
    h.push('<div class="pr-form-field"><label class="pr-field-label">PO Number</label><input type="text" class="pr-input" id="pr-ponum" value="'+esc(item.poNumber||'')+'" placeholder="#PO-001"></div>');
    h.push('</div>');

    // Row: Order Date + Delivery Date + Status
    h.push('<div class="pr-form-row">');
    h.push('<div class="pr-form-field"><label class="pr-field-label">Order Date</label><input type="date" class="pr-input" id="pr-order-date" value="'+esc(item.orderDate||'')+'"></div>');
    h.push('<div class="pr-form-field"><label class="pr-field-label">Delivery Date</label><input type="date" class="pr-input" id="pr-delivery-date" value="'+esc(item.deliveryDate||'')+'"></div>');
    h.push('<div class="pr-form-field"><label class="pr-field-label">Status</label><select class="pr-input" id="pr-status">');
    STATUSES.forEach(function(s){ h.push('<option value="'+s+'"'+(item.status===s?' selected':'')+'>'+statusLabel(s)+'</option>'); });
    h.push('</select></div>');
    h.push('</div>');

    // Notes
    h.push('<div class="pr-form-section">');
    h.push('<label class="pr-field-label">Notes</label>');
    h.push('<textarea class="pr-textarea" id="pr-notes" rows="3" placeholder="Special instructions, lead time notes, contact info…">'+esc(item.notes||'')+'</textarea>');
    h.push('</div>');

    h.push('</div>');
    return h.join('');
  }

  function _bindForm() {
    document.getElementById('pr-form-back').addEventListener('click',function(){
      state.viewMode='list'; state.editingItem=null; _paint();
    });
    document.getElementById('pr-form-save').addEventListener('click',function(){
      var item=state.editingItem;
      item.title=(document.getElementById('pr-title')?.value||'').trim();
      item.item=(document.getElementById('pr-item')?.value||'').trim();
      item.quantity=document.getElementById('pr-qty')?.value||'';
      item.unit=(document.getElementById('pr-unit')?.value||'').trim();
      item.vendor=(document.getElementById('pr-vendor')?.value||'').trim();
      item.poNumber=(document.getElementById('pr-ponum')?.value||'').trim();
      item.orderDate=document.getElementById('pr-order-date')?.value||'';
      item.deliveryDate=document.getElementById('pr-delivery-date')?.value||'';
      item.status=document.getElementById('pr-status')?.value||'ordered';
      item.notes=(document.getElementById('pr-notes')?.value||'').trim();
      item.updatedAt=nowISO();
      if (!item.createdAt) item.createdAt=nowISO();
      if (!item.id) item.id=uid();
      S().saveRecord(state.projectId,CATEGORY,item);
      state.viewMode='list'; state.editingItem=null; _paint();
    });
  }

  /* ── CSS Injection ───────────────────────────────────────────────────── */
  
  /* ── Public API ─────────────────────────────────────────────────────── */
  global.AlignProcurement = Object.freeze({
    render: render,
    CATEGORY: CATEGORY
  });
  if (window.TileRegistry) window.TileRegistry.register({ id: 'procurement', title: 'Procurement', icon: '[]', route: 'procurement', roles: ['user','admin'], order: 11 });
})(window);

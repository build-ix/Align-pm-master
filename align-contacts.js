/* align-contacts.js — Align Directory module (companies + users, API-backed) */
(function(g){'use strict';
var A=function(){return g.AlignAuth;};
var S=function(){return g.AlignStorage;};

var state={container:null,projectId:null,search:'',viewMode:'list',editingContact:null,
           companies:[],users:[],loaded:false,newCompanyName:''};

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function nowISO(){return new Date().toISOString();}
function isAdmin(){try{var u=A()&&A().getActiveUser?A().getActiveUser():null;return u&&u.role==='admin';}catch(e){return false;}}

/* ── Data fetching ─────────────────────────────────────────────────── */
function _resolvePid(){var s=S();state.projectId=s&&s.getActiveProject()?s.getActiveProject().id:null;}

function _api(path, opts){
  opts=opts||{};
  var token = localStorage.getItem('align-token') || '';
  var headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(path,{method:opts.method||'GET',headers:headers,body:opts.body?JSON.stringify(opts.body):undefined,credentials:'include'})
    .then(function(r){return r.json().then(function(d){if(!r.ok){var e=new Error(d.error||'Request failed');e.status=r.status;throw e;}return d;});});
}

function _loadData(){
  if(!state.projectId){state.companies=[];state.users=[];state.loaded=false;_paint();return Promise.resolve();}
  return Promise.all([
    _api('/api/projects/'+state.projectId+'/companies').then(function(d){state.companies=d.companies||[];}).catch(function(){state.companies=[];}),
    _api('/api/people?status=active').then(function(d){state.users=(d.people||[]).filter(function(p){return p.status==='active'&&p.role!=='admin';});}).catch(function(){state.users=[];})
  ]).then(function(){state.loaded=true;_paint();}).catch(function(){state.loaded=true;_paint();});
}

/* ── Public render ─────────────────────────────────────────────────── */
function render(c){if(!c)return;state.container=c;state.viewMode='list';state.editingContact=null;_resolvePid();
  if(!state.projectId){
    // Project not ready yet — retry after a short delay
    c.innerHTML='<div class="ct-empty">Loading directory…</div>';
    setTimeout(function(){ _resolvePid(); _loadData(); }, 300);
    return;
  }
  _loadData();
}

function _paint(){
  var c=state.container;if(!c)return;
  _resolvePid();
  if(!state.projectId){c.innerHTML='<div class="ct-empty"><strong>No project</strong><p>Select a project.</p></div>';return;}
  if(!state.loaded){c.innerHTML='<div class="ct-empty">Loading directory…</div>';return;}
  if(state.viewMode==='form'&&state.editingContact){c.innerHTML=_formHtml();_bindForm();return;}
  c.innerHTML=_listHtml();_bindList();
}

/* ── List view ──────────────────────────────────────────────────────── */
function _listHtml(){
  var companies=state.companies;
  var users=state.users;
  var s=state.search.toLowerCase();
  if(s){
    users=users.filter(function(u){return(u.name||'').toLowerCase().indexOf(s)>-1||(u.role||'').toLowerCase().indexOf(s)>-1||(u.email||'').toLowerCase().indexOf(s)>-1;});
    companies=companies.filter(function(c){return(c.name||'').toLowerCase().indexOf(s)>-1||(c.trade||'').toLowerCase().indexOf(s)>-1;});
  }

  // Build company lookup by id
  var companyById={};
  companies.forEach(function(c){companyById[c.id]=c;});

  var h=[];
  h.push('<div class="ct-wrap"><div class="ct-header">');
  h.push('<h3 class="ct-title">Directory</h3>');
  h.push('<div class="ct-header-actions">');
  h.push('<input type="search" class="ct-search" id="ct-search" placeholder="Search name, company, role..." value="'+esc(state.search)+'">');
  if(isAdmin()){
    h.push('<button class="pm-btn" id="ct-manage-invites-btn">Manage Invites</button>');
    h.push('<button class="pm-btn" id="ct-new-company-btn">+ Add Company</button>');
    h.push('<button class="pm-btn primary" id="ct-new-user-btn">+ Add User</button>');
  }
  h.push('</div></div>');

  var total=users.length;
  h.push('<div class="ct-count">'+total+' contact'+(total!==1?'s':'')+'</div>');

  if(!companies.length&&!users.length){
    if(isAdmin()){
      h.push('<div class="ct-empty"><strong>No companies yet</strong><p>Add a company first, then add users.</p></div>');
    }else{
      h.push('<div class="ct-empty"><strong>No contacts yet</strong><p>No users or companies have been added to this project.</p></div>');
    }
  }else{
    // Group users by company_id
    var grouped={};
    users.forEach(function(u){
      var key=u.company_id||'none';
      if(!grouped[key])grouped[key]=[];
      grouped[key].push(u);
    });

    // Sort company keys by company name
    var keys=Object.keys(grouped).sort(function(a,b){
      var na=companyById[a]?companyById[a].name:(a==='none'?'Unassigned':a);
      var nb=companyById[b]?companyById[b].name:(b==='none'?'Unassigned':b);
      return na.localeCompare(nb);
    });

    keys.forEach(function(key){
      var group=grouped[key];
      var co=companyById[key];
      var displayName=co?co.name:(key==='none'?'Unassigned':key);
      h.push('<div class="ct-group">');
      h.push('<div class="ct-ribbon">');
      h.push('<span class="ct-ribbon-name">'+esc(displayName)+'</span>');
      h.push('<span class="ct-ribbon-right">');
      if(co && co.trade) h.push('<span class="ct-ribbon-trade">'+esc(co.trade)+'</span>');
      h.push('<button class="ct-ribbon-edit" data-coid="'+esc(key)+'">Edit</button>');
      h.push('<span class="ct-ribbon-count">'+group.length+'</span>');
      h.push('</span>');
      h.push('</div>');
      group.forEach(function(ct){h.push(_userCard(ct));});
      h.push('</div>');
    });

    // Render standalone companies (no users)
    var seenIds={};
    keys.forEach(function(k){seenIds[k]=true;});
    companies.forEach(function(co){
      if(!seenIds[co.id]){
        h.push('<div class="ct-group">');
        h.push('<div class="ct-ribbon">');
        h.push('<span class="ct-ribbon-name">'+esc(co.name)+'</span>');
        h.push('<span class="ct-ribbon-right">');
        if(co.trade) h.push('<span class="ct-ribbon-trade">'+esc(co.trade)+'</span>');
        h.push('<button class="ct-ribbon-edit" data-coid="'+esc(co.id)+'">Edit</button>');
        h.push('<span class="ct-ribbon-count">0</span>');
        h.push('</span>');
        h.push('</div>');
        h.push('</div>');
      }
    });
  }
  h.push('</div>');
  return h.join('');
}

function _userCard(ct){
  var admin=isAdmin();
  var h='';
  h+='<div class="ac-card" data-user-id="'+esc(ct.id)+'">';
  h+='<div class="ac-card-header">';
  h+='<span class="ac-username">'+esc(ct.name||'Unnamed')+'</span>';
  h+='<button class="ac-key-btn" title="Permissions" data-uid="'+esc(ct.id)+'">🔑</button>';
  h+='</div>';
  h+='<div class="ac-card-dropdown" hidden>';
  if(ct.email)h+='<p class="ac-email"><a href="mailto:'+esc(ct.email)+'">'+esc(ct.email)+'</a></p>';
  if(ct.phone)h+='<p class="ac-phone"><a href="tel:'+esc(ct.phone)+'">'+esc(ct.phone)+'</a></p>';
  if(admin){
    h+='<div class="ac-actions">';
    h+='<span class="ac-link ac-edit" data-uid="'+esc(ct.id)+'">Edit</span>';
    h+='<span class="ac-link ac-delete" data-uid="'+esc(ct.id)+'">Delete</span>';
    h+='</div>';
  }
  h+='</div>';
  h+='</div>';
  return h;
}

function _bindList(){
  var s=document.getElementById('ct-search');
  if(s)s.addEventListener('input',function(){state.search=this.value;_paint();});

  var cb=document.getElementById('ct-new-company-btn');
  if(cb)cb.addEventListener('click',function(){
    state.editingContact={mode:'company',name:'',trade:''};
    state.viewMode='form';_paint();
  });

  var ub=document.getElementById('ct-new-user-btn');
  if(ub)ub.addEventListener('click',function(){
    if(!state.companies.length&&isAdmin()){
      alert('Create a company first before adding users.');
      state.editingContact={mode:'company',name:'',trade:''};
      state.viewMode='form';_paint();
      return;
    }
    state.editingContact={mode:'user',name:'',role:'',company_id:'',phone:'',email:'',newCompany:false};
    state.viewMode='form';_paint();
  });

  var pb=document.getElementById('ct-permissions-btn');
  if(pb)pb.addEventListener('click',function(){ _showPermissionsPanel(); });

  var mb=document.getElementById('ct-manage-invites-btn');
  if(mb)mb.addEventListener('click',function(){ _showInvitesPanel(); });

  var wrap=document.querySelector('.ct-wrap');
  if(wrap)wrap.addEventListener('click',function(e){
    // Company ribbon edit button
    var coEdit = e.target.closest('.ct-ribbon-edit');
    if (coEdit) {
      var coId = coEdit.getAttribute('data-coid');
      var found = state.companies.find(function(c){ return c.id === coId; });
      if (found) {
        state.editingContact = Object.assign({mode:'company'}, found);
        state.viewMode = 'form';
        _paint();
      }
      return;
    }

    // Key button → individual permissions
    var keyBtn = e.target.closest('.ac-key-btn');
    if (keyBtn) {
      e.stopPropagation();
      var uid = keyBtn.getAttribute('data-uid');
      _showUserPermissions(uid);
      return;
    }

    // Edit link in dropdown
    var editLink = e.target.closest('.ac-edit');
    if (editLink) {
      e.stopPropagation();
      var id = editLink.getAttribute('data-uid');
      var found = state.users.find(function(u){ return u.id === id; });
      if (found) { state.editingContact = Object.assign({mode:'user'}, found); state.viewMode = 'form'; _paint(); }
      return;
    }

    // Delete link in dropdown
    var delLink = e.target.closest('.ac-delete');
    if (delLink) {
      e.stopPropagation();
      var did = delLink.getAttribute('data-uid');
      var ct = state.users.find(function(u){ return u.id === did; });
      var label = ct ? ct.name : 'this user';
      if (confirm('Remove ' + label + '?')) {
        _api('/api/people/' + did, { method: 'DELETE' }).then(_loadData).catch(function(e){ alert(e.message); });
      }
      return;
    }

    // Card click → toggle dropdown
    var card = e.target.closest('.ac-card');
    if (card) {
      var dd = card.querySelector('.ac-card-dropdown');
      if (!dd) return;
      var isOpen = !dd.hidden;
      // Close all others
      document.querySelectorAll('.ac-card-dropdown').forEach(function(d){ d.hidden = true; });
      document.querySelectorAll('.ac-card').forEach(function(c){ c.classList.remove('ac-open'); });
      if (!isOpen) { dd.hidden = false; card.classList.add('ac-open'); }
    }
  });
}

/* ── Form ───────────────────────────────────────────────────────────────────────────────────── */
function _formHtml(){
  var ct=state.editingContact||{};
  var isCompany=ct.mode==='company';
  var h=[];
  h.push('<div class="ct-form-wrap">');
  h.push('<div class="ct-form-header">');
  h.push('<button class="pm-btn" id="ct-form-back">← Back</button>');
  h.push('<h3 class="ct-form-title">'+(ct.id?'Edit ':'New ')+(isCompany?'Company':'User')+'</h3>');
  h.push('<button class="pm-btn primary" id="ct-form-save">Save</button>');
  h.push('</div>');

  if(isCompany){
    h.push('<div class="ct-form-card">');
    h.push('<div class="ct-form-section"><label class="ct-field-label">Company Name</label><input type="text" class="ct-input" id="ct-co-name" value="'+esc(ct.name||'')+'" placeholder="Company name" autocomplete="off"></div>');
    h.push('<div class="ct-form-section"><label class="ct-field-label">Trade (optional)</label><input type="text" class="ct-input" id="ct-co-trade" value="'+esc(ct.trade||'')+'" placeholder="e.g. Plumbing, Electrical" autocomplete="off"></div>');
    h.push('</div>');
  }else{
    h.push('<div class="ct-form-card">');

    // Name
    h.push('<div class="ct-form-section"><label class="ct-field-label">Full Name</label><input type="text" class="ct-input" id="ct-name" value="'+esc(ct.name||'')+'" placeholder="Full name"></div>');

    // Role + Email row
    h.push('<div class="ct-form-row">');
    h.push('<div class="ct-form-field"><label class="ct-field-label">Job Title</label><input type="text" class="ct-input" id="ct-role" value="'+esc(ct.project_role||ct.role||'')+'" placeholder="e.g. Project Manager"></div>');
    h.push('<div class="ct-form-field"><label class="ct-field-label">Email</label><input type="email" class="ct-input" id="ct-email" value="'+esc(ct.email||'')+'" placeholder="email@example.com"'+(ct.id?' disabled':'')+'></div>');
    h.push('</div>');

    // Phone
    h.push('<div class="ct-form-section"><label class="ct-field-label">Phone (optional)</label><input type="tel" class="ct-input" id="ct-phone" value="'+esc(ct.phone||'')+'" placeholder="(555) 123-4567"></div>');

    // Company dropdown
    h.push('<div class="ct-form-section"><label class="ct-field-label">Company</label><select class="ct-input" id="ct-company-sel"></select></div>');
    h.push('<div id="ct-new-company-inline" style="display:none;"><label class="ct-field-label">New Company Name</label><input type="text" class="ct-input" id="ct-new-co-name" placeholder="Enter new company name"></div>');

    h.push('</div>'); // end ct-form-card

    // Permissions card
    h.push('<div class="ct-form-card ct-perms-card">');
    h.push('<div class="ct-form-section">');
    h.push('<label class="ct-field-label">Access Level</label>');
    h.push('<div class="ct-access-toggle">');
    h.push('<button type="button" class="ct-access-btn active" data-access="admin" id="ct-access-admin"><div class="ct-access-title">Admin</div><div class="ct-access-desc">Full access to all tiles</div></button>');
    h.push('<button type="button" class="ct-access-btn" data-access="user" id="ct-access-user"><div class="ct-access-title">User</div><div class="ct-access-desc">Access specific tiles only</div></button>');
    h.push('</div>');
    h.push('</div>');

    // Granular permissions (hidden when admin)
    h.push('<div class="ct-form-section" id="ct-perms-section" style="display:none;">');

    // Preset role buttons
    h.push('<div class="ct-form-section">');
    h.push('<label class="ct-field-label">Role Preset</label>');
    h.push('<div class="ct-preset-grid">');
    ['pm','sup','sub','custom'].forEach(function(key) {
      var meta = {pm:'Project Manager',sup:'Superintendent',sub:'Sub Contractor',custom:'Custom'}[key];
      h.push('<div class="ct-preset-box" data-preset="'+key+'">');
      h.push('<span class="ct-preset-name">'+meta+'</span>');
      h.push('<button type="button" class="ct-preset-edit" data-preset="'+key+'" title="Edit preset">Edit</button>');
      h.push('</div>');
    });
    h.push('</div>');
    h.push('</div>');

    // Preset editor overlay (hidden by default)
    h.push('<div id="ct-preset-editor" style="display:none;">');
    h.push('<div class="ct-preset-editor-bar">');
    h.push('<span class="ct-preset-editor-title">Edit Preset</span>');
    h.push('<button type="button" class="ct-preset-editor-close" id="ct-preset-close">Done</button>');
    h.push('</div>');
    h.push('<div class="ct-preset-editor-grid" id="ct-preset-editor-grid"></div>');
    h.push('</div>');

    h.push('<label class="ct-field-label">Tile Permissions</label>');
    h.push('<div class="ct-perm-grid">');
    PERM_ROOMS.forEach(function(room) {
      h.push('<div class="ct-perm-row">');
      h.push('<span class="ct-perm-label">' + (PERM_LABELS[room] || room) + '</span>');
      h.push('<div class="perm-toggle-group" data-room="' + room + '">');
      h.push('<button type="button" class="perm-tog" data-val="none">None</button>');
      h.push('<button type="button" class="perm-tog active" data-val="r">View</button>');
      h.push('<button type="button" class="perm-tog" data-val="rw">Edit</button>');
      h.push('</div></div>');
    });
    h.push('</div></div>');

    h.push('</div>'); // end ct-perms-card
  }
  h.push('</div>');
  return h.join('');
}

function _getPresets() {
  var defaults = {
    pm:   {drawings:'rw','daily-logs':'rw',specs:'rw',rfis:'rw',punchlist:'rw',schedule:'rw',budget:'rw',contacts:'rw',photos:'rw',tasks:'rw',procurement:'rw',files:'rw',settings:'rw'},
    sup:  {drawings:'rw','daily-logs':'rw',specs:'r',rfis:'r',punchlist:'rw',schedule:'rw',budget:'r',contacts:'r',photos:'r',tasks:'rw',procurement:'r',files:'r',settings:'none'},
    sub:  {drawings:'r','daily-logs':'r',specs:'none',rfis:'none',punchlist:'rw',schedule:'r',budget:'none',contacts:'none',photos:'none',tasks:'rw',procurement:'none',files:'r',settings:'none'},
    custom:{drawings:'none','daily-logs':'none',specs:'none',rfis:'none',punchlist:'none',schedule:'none',budget:'none',contacts:'none',photos:'none',tasks:'none',procurement:'none',files:'none',settings:'none'}
  };
  try {
    var stored = localStorage.getItem('align.presets');
    if (stored) return Object.assign({}, defaults, JSON.parse(stored));
  } catch(e) {}
  return defaults;
}

function _savePresets(presets) {
  try { localStorage.setItem('align.presets', JSON.stringify(presets)); } catch(e) {}
}

function _applyPreset(key) {
  var presets = _getPresets();
  var p = presets[key];
  if (!p) return;
  var grid = document.getElementById('ct-perms-section');
  if (!grid) return;
  grid.querySelectorAll('.perm-toggle-group').forEach(function(group) {
    var room = group.getAttribute('data-room');
    var val = p[room] || 'none';
    group.querySelectorAll('.perm-tog').forEach(function(tog) {
      tog.classList.toggle('active', tog.getAttribute('data-val') === val);
    });
  });
  // Mark preset box active
  document.querySelectorAll('.ct-preset-box').forEach(function(box) {
    box.classList.toggle('active', box.getAttribute('data-preset') === key);
  });
}

function _openPresetEditor(key) {
  var presets = _getPresets();
  var p = presets[key] || {};
  var editor = document.getElementById('ct-preset-editor');
  var grid = document.getElementById('ct-preset-editor-grid');
  if (!editor || !grid) return;

  var names = {pm:'Project Manager',sup:'Superintendent',sub:'Sub Contractor',custom:'Custom'};
  document.querySelector('.ct-preset-editor-title').textContent = 'Edit ' + (names[key] || key);

  var h = '';
  PERM_ROOMS.forEach(function(room) {
    var val = p[room] || 'none';
    h += '<div class="ct-perm-row">';
    h += '<span class="ct-perm-label">' + (PERM_LABELS[room] || room) + '</span>';
    h += '<div class="perm-toggle-group" data-ed-room="' + room + '">';
    h += '<button type="button" class="perm-tog' + (val === 'none' ? ' active' : '') + '" data-val="none">None</button>';
    h += '<button type="button" class="perm-tog' + (val === 'r' ? ' active' : '') + '" data-val="r">View</button>';
    h += '<button type="button" class="perm-tog' + (val === 'rw' ? ' active' : '') + '" data-val="rw">Edit</button>';
    h += '</div></div>';
  });
  grid.innerHTML = h;

  // Wire editor toggles
  grid.querySelectorAll('.perm-toggle-group').forEach(function(group) {
    group.querySelectorAll('.perm-tog').forEach(function(tog) {
      tog.addEventListener('click', function() {
        group.querySelectorAll('.perm-tog').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
      });
    });
  });

  // Save on close
  var closeBtn = document.getElementById('ct-preset-close');
  if (closeBtn) {
    closeBtn.onclick = function() {
      var newPerms = {};
      grid.querySelectorAll('.perm-toggle-group').forEach(function(group) {
        var room = group.getAttribute('data-ed-room');
        var active = group.querySelector('.perm-tog.active');
        if (active) newPerms[room] = active.getAttribute('data-val');
      });
      presets[key] = newPerms;
      _savePresets(presets);
      editor.style.display = 'none';
      // If this preset is currently selected, re-apply it live
      var activeBox = document.querySelector('.ct-preset-box.active');
      if (activeBox && activeBox.getAttribute('data-preset') === key) {
        _applyPreset(key);
      }
    };
  }

  editor.style.display = '';
}

function _bindForm(){
  document.getElementById('ct-form-back').addEventListener('click',function(){state.viewMode='list';state.editingContact=null;_paint();});

  // Populate company dropdown for user form
  var coSel=document.getElementById('ct-company-sel');
  if(coSel){
    var opts='<option value="">— Select company —</option>';
    state.companies.forEach(function(c){
      var sel=state.editingContact&&state.editingContact.company_id===c.id?' selected':'';
      opts+='<option value="'+c.id+'"'+sel+'>'+c.name+(c.trade?' ('+c.trade+')':'')+'</option>';
    });
    opts+='<option value="__new__">+ Create new company…</option>';
    coSel.innerHTML=opts;

    coSel.addEventListener('change',function(){
      var inline=document.getElementById('ct-new-company-inline');
      if(this.value==='__new__'){
        if(inline)inline.style.display='';
      }else{
        if(inline)inline.style.display='none';
      }
    });
  }

  // Wire access level toggle
  var accessBtns = document.querySelectorAll('.ct-access-btn');
  var permsSection = document.getElementById('ct-perms-section');
  accessBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      accessBtns.forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      var access = this.getAttribute('data-access');
      if (permsSection) {
        permsSection.style.display = access === 'admin' ? 'none' : '';
      }
      // Auto-apply Project Manager preset when switching to User
      if (access === 'user') {
        _applyPreset('pm');
      }
    });
  });

  // Wire preset boxes
  document.querySelectorAll('.ct-preset-box').forEach(function(box) {
    box.addEventListener('click', function(e) {
      if (e.target.closest('.ct-preset-edit')) return; // let edit button handle itself
      var key = this.getAttribute('data-preset');
      _applyPreset(key);
    });
  });

  // Wire preset edit buttons
  document.querySelectorAll('.ct-preset-edit').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var key = this.getAttribute('data-preset');
      _openPresetEditor(key);
    });
  });

  // Wire permission toggles in the user form
  var permGrid = document.getElementById('ct-perms-section');
  if (permGrid) {
    permGrid.querySelectorAll('.perm-toggle-group').forEach(function(group) {
      group.querySelectorAll('.perm-tog').forEach(function(tog) {
        tog.addEventListener('click', function() {
          group.querySelectorAll('.perm-tog').forEach(function(t) { t.classList.remove('active'); });
          this.classList.add('active');
        });
      });
    });
  }

  document.getElementById('ct-form-save').addEventListener('click',function(){
    var ct=state.editingContact||{};
    var isCompany=ct.mode==='company';

    if(isCompany){
      var name=(document.getElementById('ct-co-name')||{}).value.trim();
      if(!name)return alert('Company name is required.');
      var trade=(document.getElementById('ct-co-trade')||{}).value.trim()||'';

      if(ct.id){
        _api('/api/projects/'+state.projectId+'/companies/'+ct.id,{method:'PUT',body:{name:name,trade:trade}})
          .then(function(){state.viewMode='list';state.editingContact=null;_loadData();})
          .catch(function(e){alert(e.message);});
      }else{
        _api('/api/projects/'+state.projectId+'/companies',{method:'POST',body:{name:name,trade:trade}})
          .then(function(){state.viewMode='list';state.editingContact=null;_loadData();})
          .catch(function(e){alert(e.message);});
      }
    }else{
      // User create or update
      var isUpdate=!!ct.id;
      var uname=(document.getElementById('ct-name')||{}).value.trim();
      if(!uname)return alert('Name is required.');
      var email=(document.getElementById('ct-email')||{}).value.trim();
      if(!isUpdate&&!email)return alert('Email is required.');
      var role=(document.getElementById('ct-role')||{}).value.trim()||'user';
      var phone=(document.getElementById('ct-phone')||{}).value.trim()||'';

      var coSel=document.getElementById('ct-company-sel');
      var coId=coSel?coSel.value:'';
      var newCoName='';

      if(coId==='__new__'){
        newCoName=(document.getElementById('ct-new-co-name')||{}).value.trim();
        if(!newCoName)return alert('Enter a company name.');
      }

      // Determine access level
      var accessAdmin = document.getElementById('ct-access-admin') && document.getElementById('ct-access-admin').classList.contains('active');

      function saveUser(cid){
        var perms = {};
        var projectRole = 'member';

        if (accessAdmin) {
          // Admin gets full access to all rooms
          projectRole = 'admin';
          PERM_ROOMS.forEach(function(room) { perms[room] = 'rw'; });
        } else {
          // Collect granular permissions from form
          var permGrid2 = document.getElementById('ct-perms-section');
          if (permGrid2) {
            permGrid2.querySelectorAll('.perm-toggle-group').forEach(function(group) {
              var room = group.getAttribute('data-room');
              var active = group.querySelector('.perm-tog.active');
              if (active) perms[room] = active.getAttribute('data-val');
            });
          }
        }

        if(isUpdate){
          _api('/api/people/'+ct.id,{method:'PUT',body:{
            name:uname,role:role,company_id:cid||null,
            permissions: perms
          }}).then(function(){
            state.viewMode='list';state.editingContact=null;_loadData();
          }).catch(function(e){alert(e.message||'Failed to update user');});
        }else{
          _api('/api/people',{method:'POST',body:{
            email:email,name:uname,role:role,company_id:cid||null,
            projects:state.projectId?[{id:state.projectId,role:projectRole,permissions:perms}]:[]
          }}).then(function(r){
            var msg = r.added ? 'User added to project' : (r.reactivated ? 'User reactivated and added to project' : (r.pending ? 'Invite updated with additional projects' : 'Invite sent to '+email));
            alert(msg);
            state.viewMode='list';state.editingContact=null;_loadData();
          }).catch(function(e){alert(e.message||'Failed to create user');});
        }
      }

      if(newCoName){
        // Auto-create company first
        _api('/api/projects/'+state.projectId+'/companies',{method:'POST',body:{name:newCoName}})
          .then(function(r){saveUser(r.company.id);})
          .catch(function(e){alert(e.message);});
      }else if(coId){
        saveUser(coId);
      }else{
        saveUser(null);
      }
    }
  });
}

/* ── Permissions Panel ─────────────────────────────────────────────── */

var PERM_ROOMS = ['drawings','daily-logs','specs','rfis','punchlist','schedule','budget','contacts','photos','tasks','procurement','files','settings'];
var PERM_LABELS = {drawings:'Drawings','daily-logs':'Daily Logs',specs:'Specs',rfis:'RFIs',punchlist:'Punchlist',schedule:'Schedule',budget:'Budget',contacts:'Directory',photos:'Photos',tasks:'Tasks',procurement:'Procurement',files:'Files',settings:'Settings'};

function _showPermissionsPanel() {
  _resolvePid();
  if (!state.projectId) return;

  _api('/api/projects/' + state.projectId + '/permissions')
    .then(function(data) {
      var members = data.members || [];
      _renderPermPanel(members);
    })
    .catch(function(e) {
      alert('Could not load permissions: ' + (e.message || 'unknown error'));
    });
}

function _showUserPermissions(uid) {
  _resolvePid();
  if (!state.projectId || !uid) return;

  // Find the user in our loaded data
  var user = null;
  for (var i = 0; i < state.users.length; i++) {
    if (String(state.users[i].id) === String(uid)) { user = state.users[i]; break; }
  }
  if (!user) {
    alert('User not found.');
    return;
  }

  // Build a member object from local data — skip the permissions API fetch
  var member = {
    user_id: uid,
    name: user.name || '',
    email: user.email || '',
    project_role: user.project_role || 'member',
    permissions: (function() {
      if (!user.permissions) return {};
      if (typeof user.permissions === 'string') {
        try { return JSON.parse(user.permissions); } catch(e) { return {}; }
      }
      return user.permissions;
    })()
  };
  _renderSinglePermPanel(member);
}

function _renderSinglePermPanel(member) {
  var container = state.container;
  if (!container) return;
  var isAdmin = member.project_role === 'admin';
  var perms = member.permissions || {};
  var html = '<div class="perm-overlay" id="perm-overlay">';
  html += '<div class="perm-panel perm-single">';
  html += '<div class="perm-header"><h2>Permissions: ' + esc(member.name || member.email) + '</h2><button class="perm-close" id="perm-close">&times;</button></div>';
  html += '<div class="perm-body">';
  html += '<div class="perm-grid-area" style="padding:16px 20px;flex:1;">';

  if (isAdmin) {
    html += '<div class="perm-admin-note">Project admins have full access to all tiles.</div>';
  } else {
    // Bulk toggle bar
    html += '<div class="perm-bulk">Set all: ';
    html += '<button class="perm-bulk-btn" data-level="rw">Edit</button>';
    html += '<button class="perm-bulk-btn" data-level="r">View</button>';
    html += '<button class="perm-bulk-btn" data-level="none">None</button>';
    html += '</div>';

    // Room grid
    html += '<div class="perm-grid">';
    PERM_ROOMS.forEach(function(room) {
      var level = perms[room] || 'rw';
      html += '<div class="perm-row">';
      html += '<span class="perm-room-label">' + (PERM_LABELS[room] || room) + '</span>';
      html += '<div class="perm-toggle-group" data-room="' + room + '">';
      html += '<button class="perm-tog' + (level === 'none' ? ' active' : '') + '" data-val="none">None</button>';
      html += '<button class="perm-tog' + (level === 'r' ? ' active' : '') + '" data-val="r">View</button>';
      html += '<button class="perm-tog' + (level === 'rw' ? ' active' : '') + '" data-val="rw">Edit</button>';
      html += '</div></div>';
    });
    html += '</div>';

    // Save button
    html += '<button class="perm-save-btn" data-uid="' + esc(member.user_id) + '">Save Permissions</button>';
  }

  html += '</div></div></div></div>';
  container.insertAdjacentHTML('beforeend', html);

  // Wire events
  document.getElementById('perm-close').addEventListener('click', function() {
    var ov = document.getElementById('perm-overlay');
    if (ov) ov.remove();
  });
  document.getElementById('perm-overlay').addEventListener('click', function(e) {
    if (e.target === this) this.remove();
  });

  if (!isAdmin) {
    setTimeout(function() { _wireSinglePermGrid(member.user_id); }, 0);
  }
}

function _renderPermPanel(members, activeIdx) {
  activeIdx = activeIdx || 0;
  var container = state.container;
  if (!container) return;
  var html = '<div class="perm-overlay" id="perm-overlay">';
  html += '<div class="perm-panel">';
  html += '<div class="perm-header"><h2>Project Permissions</h2><button class="perm-close" id="perm-close">&times;</button></div>';
  html += '<div class="perm-body">';

  // Left: member list
  html += '<div class="perm-members"><h3>Members</h3>';
  if (!members.length) {
    html += '<div class="perm-empty">No members in this project.</div>';
  } else {
    members.forEach(function(m, idx) {
      var isProjAdmin = m.project_role === 'admin';
      html += '<div class="perm-member' + (idx === activeIdx ? ' active' : '') + (isProjAdmin ? ' is-admin' : '') + '" data-idx="' + idx + '">';
      html += '<span class="perm-member-name">' + esc(m.name || m.email) + '</span>';
      html += '<span class="perm-member-role">' + (isProjAdmin ? 'Admin' : 'Member') + '</span>';
      html += '</div>';
    });
  }
  html += '</div>';

  // Right: permissions grid
  html += '<div class="perm-grid-area" id="perm-grid-area">';
  if (members.length) {
    var first = members[activeIdx] || members[0];
    html += _permGridHtml(first, activeIdx);
  }
  html += '</div>';

  html += '</div>'; // perm-body
  html += '</div>'; // perm-panel
  html += '</div>'; // perm-overlay

  container.insertAdjacentHTML('beforeend', html);
  window._permMembers = members;

  // Wire events
  document.getElementById('perm-close').addEventListener('click', function() {
    var ov = document.getElementById('perm-overlay');
    if (ov) ov.remove();
  });

  // Close on overlay click
  document.getElementById('perm-overlay').addEventListener('click', function(e) {
    if (e.target === this) this.remove();
  });

  // Member selection
  document.querySelectorAll('.perm-member').forEach(function(el) {
    el.addEventListener('click', function() {
      document.querySelectorAll('.perm-member').forEach(function(e) { e.classList.remove('active'); });
      this.classList.add('active');
      var idx = parseInt(this.getAttribute('data-idx'), 10);
      var m = window._permMembers[idx];
      var area = document.getElementById('perm-grid-area');
      if (area && m) area.innerHTML = _permGridHtml(m, idx);
    });
  });
}

function _permGridHtml(member, idx) {
  var isAdmin = member.project_role === 'admin';
  var perms = member.permissions || {};
  var h = '<h3>' + esc(member.name || member.email) + '</h3>';

  if (isAdmin) {
    h += '<div class="perm-admin-note">Project admins have full access to all tiles.</div>';
    return h;
  }

  // Bulk toggle bar
  h += '<div class="perm-bulk">Set all: ';
  h += '<button class="perm-bulk-btn" data-level="rw">Edit</button>';
  h += '<button class="perm-bulk-btn" data-level="r">View</button>';
  h += '<button class="perm-bulk-btn" data-level="none">None</button>';
  h += '</div>';

  // Room grid
  h += '<div class="perm-grid">';
  PERM_ROOMS.forEach(function(room) {
    var level = perms[room] || 'rw';
    h += '<div class="perm-row">';
    h += '<span class="perm-room-label">' + (PERM_LABELS[room] || room) + '</span>';
    h += '<div class="perm-toggle-group" data-room="' + room + '">';
    h += '<button class="perm-tog' + (level === 'none' ? ' active' : '') + '" data-val="none">None</button>';
    h += '<button class="perm-tog' + (level === 'r' ? ' active' : '') + '" data-val="r">View</button>';
    h += '<button class="perm-tog' + (level === 'rw' ? ' active' : '') + '" data-val="rw">Edit</button>';
    h += '</div></div>';
  });
  h += '</div>';

  // Save button
  h += '<button class="perm-save-btn" data-uid="' + esc(member.user_id) + '" data-idx="' + idx + '">Save Permissions</button>';

  // Wire after render
  setTimeout(function() { _wirePermGrid(idx); }, 0);
  return h;
}

function _wireSinglePermGrid(uid) {
  var area = document.querySelector('.perm-single .perm-grid-area');
  if (!area) return;

  area.querySelectorAll('.perm-bulk-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var level = this.getAttribute('data-level');
      area.querySelectorAll('.perm-toggle-group').forEach(function(group) {
        group.querySelectorAll('.perm-tog').forEach(function(t) {
          t.classList.toggle('active', t.getAttribute('data-val') === level);
        });
      });
    });
  });

  area.querySelectorAll('.perm-toggle-group').forEach(function(group) {
    group.querySelectorAll('.perm-tog').forEach(function(tog) {
      tog.addEventListener('click', function() {
        group.querySelectorAll('.perm-tog').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
      });
    });
  });

  var saveBtn = area.querySelector('.perm-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function() {
      var perms = {};
      area.querySelectorAll('.perm-toggle-group').forEach(function(group) {
        var room = group.getAttribute('data-room');
        var active = group.querySelector('.perm-tog.active');
        if (active) perms[room] = active.getAttribute('data-val');
      });
      _savePerm(uid, perms, this, -1);
    });
  }
}

function _wirePermGrid(idx) {
  var area = document.getElementById('perm-grid-area');
  if (!area) return;

  // Bulk buttons
  area.querySelectorAll('.perm-bulk-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var level = this.getAttribute('data-level');
      area.querySelectorAll('.perm-toggle-group').forEach(function(group) {
        group.querySelectorAll('.perm-tog').forEach(function(t) {
          t.classList.toggle('active', t.getAttribute('data-val') === level);
        });
      });
    });
  });

  // Individual toggles
  area.querySelectorAll('.perm-toggle-group').forEach(function(group) {
    group.querySelectorAll('.perm-tog').forEach(function(tog) {
      tog.addEventListener('click', function() {
        group.querySelectorAll('.perm-tog').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
      });
    });
  });

  // Save button
  var saveBtn = area.querySelector('.perm-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function() {
      var uid = this.getAttribute('data-uid');
      var idx = parseInt(this.getAttribute('data-idx'), 10);
      var perms = {};
      area.querySelectorAll('.perm-toggle-group').forEach(function(group) {
        var room = group.getAttribute('data-room');
        var active = group.querySelector('.perm-tog.active');
        if (active) perms[room] = active.getAttribute('data-val');
      });
      _savePerm(uid, perms, this, idx);
    });
  }
}

function _savePerm(uid, perms, btn, idx) {
  _resolvePid();
  _api('/api/projects/' + state.projectId + '/permissions/' + uid, {
    method: 'PUT',
    body: { permissions: perms }
  }).then(function() {
    var orig = btn.textContent;
    btn.textContent = '✓ Saved';
    btn.classList.add('saved');
    setTimeout(function() { btn.textContent = orig; btn.classList.remove('saved'); }, 2000);
    // Update cached member in panel list
    if (window._permMembers && window._permMembers[idx]) {
      window._permMembers[idx].permissions = perms;
    }
    // Update state.users so re-opening the key panel reads fresh data
    for (var i = 0; i < state.users.length; i++) {
      if (String(state.users[i].id) === String(uid)) {
        state.users[i].permissions = perms;
        break;
      }
    }
  }).catch(function(e) {
    alert('Save failed: ' + (e.message || 'unknown error'));
  });
}

function _showInvitesPanel() {
  _resolvePid();
  if (!state.projectId) return;

  Promise.all([
    _api('/api/projects/' + state.projectId + '/invites').catch(function(){ return { invites: [] }; }),
    _api('/api/people?status=active').catch(function(){ return { people: [] }; })
  ]).then(function(results) {
    var invites = results[0].invites || [];
    var people = (results[1].people || []).filter(function(p){ return p.status === 'active'; });

    var html = '<div class="perm-overlay" id="invites-overlay">';
    html += '<div class="perm-panel perm-single">';
    html += '<div class="perm-header"><h2>Manage Invites</h2><button class="perm-close" id="invites-close">&times;</button></div>';
    html += '<div class="perm-body" style="flex-direction:column;padding:16px 20px;">';

    // Pending Invites
    html += '<div class="ct-form-section" style="margin-bottom:20px;">';
    html += '<label class="ct-field-label">Pending Invites (' + invites.length + ')</label>';
    if (!invites.length) {
      html += '<div class="pm-empty" style="padding:20px 0;font-size:0.85rem;">No pending invites.</div>';
    } else {
      html += '<div class="st-project-list" style="gap:8px;">';
      invites.forEach(function(inv) {
        html += '<div class="st-proj-card">';
        html += '<div class="st-proj-info">';
        html += '<div class="st-proj-name">' + esc(inv.name || 'Unnamed') + '</div>';
        html += '<div class="st-proj-meta">' + esc(inv.email) + ' · Code: ' + esc(inv.code) + ' · Expires ' + _fmtDate(inv.expires_at) + '</div>';
        html += '</div>';
        html += '<div class="st-proj-actions">';
        html += '<button class="pm-btn small" data-inv-resend="' + esc(inv.id) + '">Resend</button>';
        html += '<button class="pm-btn small danger" data-inv-cancel="' + esc(inv.id) + '">Cancel</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Member Log
    html += '<div class="ct-form-section">';
    html += '<label class="ct-field-label">Member Log (' + people.length + ')</label>';
    if (!people.length) {
      html += '<div class="pm-empty" style="padding:20px 0;font-size:0.85rem;">No members yet.</div>';
    } else {
      // Sort by created_at descending
      people.sort(function(a, b) {
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
      html += '<div class="st-project-list" style="gap:8px;">';
      people.forEach(function(p) {
        html += '<div class="st-proj-card">';
        html += '<div class="st-proj-info">';
        html += '<div class="st-proj-name">' + esc(p.name || 'Unnamed') + '</div>';
        html += '<div class="st-proj-meta">' + esc(p.email || '') + ' · Joined ' + _fmtDate(p.created_at) + '</div>';
        html += '</div>';
        html += '<div class="st-proj-actions">';
        html += '<span class="st-role-badge ' + (p.role === 'admin' ? 'admin' : 'user') + '">' + esc(p.role) + '</span>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    html += '</div></div></div>';

    var existing = document.getElementById('invites-overlay');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);

    // Close handlers
    document.getElementById('invites-close').addEventListener('click', function() {
      var ov = document.getElementById('invites-overlay');
      if (ov) ov.remove();
    });
    document.getElementById('invites-overlay').addEventListener('click', function(e) {
      if (e.target === this) this.remove();
    });

    // Resend
    document.querySelectorAll('[data-inv-resend]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-inv-resend');
        _api('/api/invites/' + id + '/resend', { method: 'POST' })
          .then(function(d) { alert(d.ok ? 'Invite resent!' : 'Failed'); })
          .catch(function(e) { alert('Failed: ' + (e.message || 'unknown')); });
      });
    });

    // Cancel
    document.querySelectorAll('[data-inv-cancel]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-inv-cancel');
        if (!confirm('Cancel this invite?')) return;
        _api('/api/invites/' + id + '/cancel', { method: 'POST' })
          .then(function() {
            var ov = document.getElementById('invites-overlay');
            if (ov) ov.remove();
            _showInvitesPanel();
          })
          .catch(function(e) { alert('Failed: ' + (e.message || 'unknown')); });
      });
    });
  }).catch(function(e) {
    alert('Could not load invites: ' + (e.message || 'unknown error'));
  });
}

function _fmtDate(iso) {
  if (!iso) return 'N/A';
  try {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) { return iso.slice(0, 10); }
}

g.AlignContacts=Object.freeze({render:render, refresh:function(){_resolvePid();_loadData();}});
  if (window.TileRegistry) window.TileRegistry.register({ id: 'contacts', title: 'Directory', icon: '[]', route: 'contacts', roles: ['user','admin'], order: 7 });
})(window);

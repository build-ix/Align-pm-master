/* align-contacts.js — Align Directory module (companies + users, API-backed) */
(function(g){'use strict';
var A=function(){return g.AlignAuth;};
var S=function(){return g.AlignStorage;};

var state={container:null,chrome:null,projectId:null,search:'',tradeFilter:'',viewMode:'list',editingContact:null,
           companies:[],users:[],loaded:false,newCompanyName:''};

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function nowISO(){return new Date().toISOString();}
function _initials(name){var p=String(name==null?'':name).trim().split(/\s+/);var a=p.length?(p[0].charAt(0)||''):'';var b=p.length>1?(p[p.length-1].charAt(0)||''):'';var s=(a+b).toUpperCase();return s||'?';}
function _avatarColor(name){var pal=['#e8641b','#2f6fb0','#3d8f6f','#8a5fb0','#b0642f','#4a6b8a'];var s=String(name==null?'':name);var h=0;for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))>>>0;}return pal[h%pal.length];}
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
function render(c, chrome){if(!c)return;state.container=c;state.chrome=chrome||null;state.projectId=null;state.search='';state.tradeFilter='';state.viewMode='list';state.editingContact=null;state.companies=[];state.users=[];state.loaded=false;state.newCompanyName='';_resolvePid();
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
  _renderHeader();
  if(!state.projectId){c.innerHTML='<div class="ct-empty"><strong>No project</strong><p>Select a project.</p></div>';return;}
  if(!state.loaded){c.innerHTML='<div class="ct-empty">Loading directory…</div>';return;}
  if(state.viewMode==='form'&&state.editingContact){c.innerHTML=_formHtml();_bindForm();return;}
  c.innerHTML=_listHtml();_bindList();
}

function _renderHeader(){
  if(!state.chrome||!state.chrome.setHeader)return;
  if(state.viewMode==='form'&&state.editingContact){
    var ct=state.editingContact,isCompany=ct.mode==='company';
    state.chrome.setHeader({
      title:(ct.id?'Edit ':'New ')+(isCompany?'Company':'User'),
      backLabel:'Back to Directory',
      actions:[{id:'ct-save',label:'Save',variant:'primary',type:'submit',form:'ct-form'}]
    });
  }else{
    var actions=[];
    if(isAdmin()){
      actions.push({id:'ct-new-company',label:'+ Add Company',variant:'secondary',onClick:_newCompany});
      actions.push({id:'ct-new-user',label:'+ Add User',variant:'primary',onClick:_newUser});
    }
    state.chrome.setHeader({title:'Directory',backLabel:'Back',actions:actions});
  }
}

function _newCompany(){state.editingContact={mode:'company',name:'',trade:''};state.viewMode='form';_paint();}
function _newUser(){
  if(!state.companies.length&&isAdmin()){
    alert('Create a company first before adding users.');
    state.editingContact={mode:'company',name:'',trade:''};
    state.viewMode='form';_paint();
    return;
  }
  state.editingContact={mode:'user',name:'',role:'',company_id:'',phone:'',email:'',newCompany:false};
  state.viewMode='form';_paint();
}
function handleBack(){
  if(state.viewMode==='form'){state.viewMode='list';state.editingContact=null;_paint();return true;}
  return false;
}

/* ── List view ──────────────────────────────────────────────────────── */
function _listHtml(){
  var companies=state.companies;
  var users=state.users;
  var s=(state.search||'').toLowerCase();
  var tf=state.tradeFilter||'';

  var companyById={};
  companies.forEach(function(c){companyById[c.id]=c;});

  // Filter contacts by search + trade
  var fUsers=users.filter(function(u){
    var co=companyById[u.company_id];
    if(tf&&(!co||(co.trade||'')!==tf))return false;
    if(s){
      var hay=(u.name||'')+' '+(u.role||'')+' '+(u.email||'')+' '+(co?co.name:'')+' '+(co?(co.trade||''):'');
      if(hay.toLowerCase().indexOf(s)===-1)return false;
    }
    return true;
  });

  // Filter companies (for standalone rendering)
  var fCompanies=companies.filter(function(c){
    if(tf&&(c.trade||'')!==tf)return false;
    if(s){var hay=(c.name||'')+' '+(c.trade||'');if(hay.toLowerCase().indexOf(s)===-1)return false;}
    return true;
  });

  // Distinct trades for chips (from all companies)
  var trades=[];
  companies.forEach(function(c){if(c.trade&&trades.indexOf(c.trade)===-1)trades.push(c.trade);});

  var h=[];
  h.push('<div class="ct-wrap">');
  h.push('<div class="ct-header"><input type="search" class="ct-search" id="ct-search" placeholder="Search people, companies, trades…" value="'+esc(state.search)+'"></div>');
  h.push('<div class="ct-count">'+fUsers.length+' contact'+(fUsers.length!==1?'s':'')+' · '+companies.length+' compan'+(companies.length!==1?'ies':'y')+'</div>');

  if(trades.length){
    h.push('<div class="ct-trades">');
    h.push('<button type="button" class="ct-trade-chip'+(tf?'':' active')+'" data-trade="">All</button>');
    trades.forEach(function(t){h.push('<button type="button" class="ct-trade-chip'+(tf===t?' active':'')+'" data-trade="'+esc(t)+'">'+esc(t)+'</button>');});
    h.push('</div>');
  }

  if(!companies.length&&!users.length){
    if(isAdmin()){
      h.push('<div class="ct-empty"><div class="ico">👥</div><h3>Your directory is empty</h3><p>Add a company or a contact to start building your project directory.</p><button type="button" class="ct-add-first" data-ct-add="user">＋ Add contact</button></div>');
    }else{
      h.push('<div class="ct-empty"><div class="ico">👥</div><h3>No contacts yet</h3><p>No users or companies have been added to this project.</p></div>');
    }
  }else if(!fUsers.length&&!fCompanies.length){
    h.push('<div class="ct-empty"><div class="ico">🔎</div><h3>No matches'+(s?' for "'+esc(state.search)+'"':'')+'</h3><p>Try a different name, company, or trade.</p><button type="button" class="ct-clear-search">Clear search</button></div>');
  }else{
    var grouped={};
    fUsers.forEach(function(u){
      var key=u.company_id||'none';
      if(!grouped[key])grouped[key]=[];
      grouped[key].push(u);
    });
    var keys=Object.keys(grouped).sort(function(a,b){
      var na=companyById[a]?companyById[a].name:(a==='none'?'Unassigned':a);
      var nb=companyById[b]?companyById[b].name:(b==='none'?'Unassigned':b);
      return na.localeCompare(nb);
    });
    keys.forEach(function(key){
      var group=grouped[key];
      var co=companyById[key];
      var displayName=co?co.name:(key==='none'?'Unassigned':key);
      var isUnassigned=!co;
      h.push('<div class="ct-ribbon'+(isUnassigned?' ct-unassigned':'')+'">');
      h.push('<span class="ct-ribbon-name">'+esc(displayName)+(co?'<button class="ct-ribbon-edit" data-coid="'+esc(key)+'" aria-label="Edit company"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>':'')+'</span>');
      if(co&&co.trade)h.push('<span class="ct-ribbon-trade">'+esc(co.trade)+'</span>');
      h.push('<span class="ct-ribbon-count">'+group.length+(group.length===1?' person':' people')+'</span>');
      h.push('</div>');
      h.push('<div class="ct-grid">');
      group.forEach(function(ct){h.push(_userCard(ct));});
      h.push('</div>');
    });

    var seenIds={};
    keys.forEach(function(k){seenIds[k]=true;});
    fCompanies.forEach(function(co){
      if(!seenIds[co.id]){
        h.push('<div class="ct-ribbon">');
        h.push('<span class="ct-ribbon-name">'+esc(co.name)+'<button class="ct-ribbon-edit" data-coid="'+esc(co.id)+'" aria-label="Edit company"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button></span>');
        if(co.trade)h.push('<span class="ct-ribbon-trade">'+esc(co.trade)+'</span>');
        h.push('<span class="ct-ribbon-count">No contacts</span>');
        h.push('</div>');
        h.push('<div class="ct-empty-co">No people at this company yet.</div>');
      }
    });
  }
  h.push('</div>');
  return h.join('');
}

function _userCard(ct){
  var admin=isAdmin();
  var role=[ct.role, ct.project_role].filter(Boolean).map(esc).join(' · ');
  var tel=ct.phone?'tel:'+String(ct.phone).replace(/[^\d+]/g,''):'';
  var call=ct.phone?'<a class="ac-call" href="'+tel+'">📞 <span>'+esc(ct.phone)+'</span></a>':'<a class="ac-none" href="#">No phone</a>';
  var mail=ct.email?'<a class="ac-mail" href="mailto:'+esc(ct.email)+'">✉️ <span>'+esc(ct.email)+'</span></a>':'<a class="ac-none" href="#">No email</a>';
  var tools='<button class="ac-perms" data-uid="'+esc(ct.id)+'" title="Room permissions">🔑</button>';
  if(admin){tools+='<button class="ac-link ac-edit" data-uid="'+esc(ct.id)+'">Edit</button><button class="ac-link ac-delete" data-uid="'+esc(ct.id)+'">Delete</button>';}
  return '<div class="ac-card" data-user-id="'+esc(ct.id)+'">'
    +'<div class="ac-top">'
    +'<div class="ac-avatar" style="background:'+_avatarColor(ct.name)+'">'+_initials(ct.name)+'</div>'
    +'<div class="ac-id"><div class="ac-name">'+esc(ct.name||'Unnamed')+'</div>'+(role?'<div class="ac-role">'+role+'</div>':'')+'</div>'
    +'<div class="ac-tools">'+tools+'</div>'
    +'</div>'
    +'<div class="ac-actions">'+call+mail+'</div>'
    +'</div>';
}

function _bindList(){
  var s=document.getElementById('ct-search');
  if(s)s.addEventListener('input',function(){state.search=this.value;_paint();});

  var pb=document.getElementById('ct-permissions-btn');
  if(pb)pb.addEventListener('click',function(){ _showPermissionsPanel(); });

  var wrap=document.querySelector('.ct-wrap');
  if(wrap)wrap.addEventListener('click',function(e){
    // Trade chip filter
    var chip = e.target.closest('.ct-trade-chip');
    if (chip) { state.tradeFilter = chip.getAttribute('data-trade') || ''; _paint(); return; }
    // Empty-state add contact
    if (e.target.closest('.ct-add-first')) { _newUser(); return; }
    // Clear search
    if (e.target.closest('.ct-clear-search')) { state.search=''; state.tradeFilter=''; var _s=document.getElementById('ct-search'); if(_s)_s.value=''; _paint(); return; }
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
    var keyBtn = e.target.closest('.ac-perms');
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
  });
}

/* ── Form ───────────────────────────────────────────────────────────── */
function _formHtml(){
  var ct=state.editingContact||{};
  var isCompany=ct.mode==='company';
  var h=[];
  h.push('<form id="ct-form" class="ct-form-wrap">');

  if(isCompany){
    h.push('<div class="ct-form-section"><label class="ct-field-label">Company Name</label><input type="text" class="ct-input" id="ct-co-name" value="'+esc(ct.name||'')+'" placeholder="Company name" autocomplete="off"></div>');
    h.push('<div class="ct-form-section"><label class="ct-field-label">Trade (optional)</label><input type="text" class="ct-input" id="ct-co-trade" value="'+esc(ct.trade||'')+'" placeholder="e.g. Plumbing, Electrical" autocomplete="off"></div>');
  }else{
    h.push('<div class="ct-form-section"><label class="ct-field-label">Full Name</label><input type="text" class="ct-input" id="ct-name" value="'+esc(ct.name||'')+'" placeholder="Full name"></div>');
    h.push('<div class="ct-form-row"><div class="ct-form-field"><label class="ct-field-label">Role</label><input type="text" class="ct-input" id="ct-role" value="'+esc(ct.project_role||ct.role||'')+'" placeholder="e.g. Project Manager"></div><div class="ct-form-field"><label class="ct-field-label">Email</label><input type="email" class="ct-input" id="ct-email" value="'+esc(ct.email||'')+'" placeholder="email@example.com"'+(ct.id?' disabled':'')+'></div></div>');
    h.push('<div class="ct-form-section"><label class="ct-field-label">Phone (optional)</label><input type="tel" class="ct-input" id="ct-phone" value="'+esc(ct.phone||'')+'" placeholder="(555) 123-4567"></div>');

    // Company dropdown
    h.push('<div class="ct-form-section"><label class="ct-field-label">Company</label><select class="ct-input" id="ct-company-sel"></select></div>');
    h.push('<div id="ct-new-company-inline" style="display:none;"><label class="ct-field-label">New Company Name</label><input type="text" class="ct-input" id="ct-new-co-name" placeholder="Enter new company name"></div>');

    // Permissions (new users only — pre-set room access)
    h.push('<div class="ct-form-section" id="ct-perms-section">');
    h.push('<label class="ct-field-label">Room Permissions</label>');
    h.push('<div class="ct-perm-grid">');
    PERM_ROOMS.forEach(function(room) {
      h.push('<div class="ct-perm-row">');
      h.push('<span class="ct-perm-label">' + (PERM_LABELS[room] || room) + '</span>');
      h.push('<div class="perm-toggle-group" data-room="' + room + '">');
      h.push('<button type="button" class="perm-tog active" data-val="none">None</button>');
      h.push('<button type="button" class="perm-tog" data-val="r">View</button>');
      h.push('<button type="button" class="perm-tog" data-val="rw">Edit</button>');
      h.push('</div></div>');
    });
    h.push('</div></div>');
  }
  h.push('</form>');
  return h.join('');
}

function _bindForm(){
  var form=document.getElementById('ct-form');

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

  form.addEventListener('submit', function(event){
    event.preventDefault();
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

      function saveUser(cid){
        // Collect permissions from form
        var perms = {};
        var permGrid2 = document.getElementById('ct-perms-section');
        if (permGrid2) {
          permGrid2.querySelectorAll('.perm-toggle-group').forEach(function(group) {
            var room = group.getAttribute('data-room');
            var active = group.querySelector('.perm-tog.active');
            if (active) perms[room] = active.getAttribute('data-val');
          });
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
            projects:state.projectId?[{id:state.projectId,role:'member',permissions:perms}]:[]
          }}).then(function(r){
            alert('Invite sent to '+email);
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

g.AlignContacts=Object.freeze({render:render, handleBack:handleBack, refresh:function(){_resolvePid();_loadData();}});
  if (window.TileRegistry) window.TileRegistry.register({ id: 'contacts', title: 'Directory', icon: '[]', route: 'contacts', roles: ['user','admin'], order: 7 });
})(window);

/* align-photos.js — Align Photos module (server-backed) */
(function(g){'use strict';
var S=function(){return g.AlignStorage;};
var CAT='photos';
var st={container:null,projectId:null,viewingPhoto:null,photoList:[],photoIndex:-1,selectMode:false,selected:{},sortBy:'date-desc',loading:false};

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}
function nowISO(){return new Date().toISOString();}
function fmtDate(iso){try{var d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric'});}catch(e){return'';}}
function fmtDateTime(iso){try{var d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});}catch(e){return'';}}

function _token(){try{return localStorage.getItem('align-token')||'';}catch(e){return'';}}
function _auth(){return{'Authorization':'Bearer '+_token()};}
function _pid(){var s=S();st.projectId=s&&s.getActiveProject()?s.getActiveProject().id:null;}

function _apiGet(path){return fetch(path,{headers:_auth()}).then(function(r){return r.json();});}
function _apiDelete(path){return fetch(path,{method:'DELETE',headers:_auth()}).then(function(r){return r.json();});}

function loadPhotos(){
  _pid();
  if(!st.projectId)return Promise.resolve([]);
  return _apiGet('/api/projects/'+st.projectId+'/photos').then(function(r){
    return (r.photos||[]).map(function(p){
      return {id:p.id,label:p.label||'',createdAt:p.created_at||nowISO()};
    });
  }).catch(function(e){console.error('[photos] load failed',e);return[];});
}

function render(c){if(!c)return;st.container=c;st.viewingPhoto=null;st.selectMode=false;st.selected={};st.sortBy='date-desc';_paint(true);}

function _paint(load){
  var c=st.container;if(!c)return;_pid();
  if(!st.projectId){c.innerHTML='<div class="ph-empty"><strong>No project</strong><p>Select a project.</p></div>';return;}
  if(st.viewingPhoto){c.innerHTML=_viewHtml();_bindView();return;}
  if(load){
    c.innerHTML='<div class="ph-empty">Loading photos...</div>';
    loadPhotos().then(function(list){
      st.photoList=list;
      _renderList();
    });
  }else{
    _renderList();
  }
}

function _sortList(list){
  var arr=list.slice();
  if(st.sortBy==='name-asc'){
    arr.sort(function(a,b){return(a.label||'').localeCompare(b.label||'');});
  }else if(st.sortBy==='date-asc'){
    arr.sort(function(a,b){return(a.createdAt||'').localeCompare(b.createdAt||'');});
  }else{
    arr.sort(function(a,b){return(b.createdAt||'').localeCompare(a.createdAt||'');});
  }
  return arr;
}

function _renderList(){
  var c=st.container;if(!c)return;
  var photos=_sortList(st.photoList);
  var selCount=Object.keys(st.selected).length;
  var h=[];

  h.push('<div class="ph-wrap">');

  // Toolbar
  h.push('<div class="ph-toolbar">');
  if(st.selectMode){
    h.push('<h3 class="ph-title">Select Photos</h3>');
    h.push('<div class="ph-tools">');
    h.push('<button class="pm-btn small" id="ph-select-btn">Cancel</button>');
    if(selCount>0){
      h.push('<button class="pm-btn small danger" id="ph-delete-sel-btn">Delete ('+selCount+')</button>');
    }
    h.push('</div>');
  }else{
    h.push('<h3 class="ph-title">Site Photos</h3>');
    h.push('<div class="ph-tools">');
    h.push('<select class="ph-sort" id="ph-sort">');
    h.push('<option value="date-desc"'+(st.sortBy==='date-desc'?' selected':'')+'>Newest First</option>');
    h.push('<option value="date-asc"'+(st.sortBy==='date-asc'?' selected':'')+'>Oldest First</option>');
    h.push('<option value="name-asc"'+(st.sortBy==='name-asc'?' selected':'')+'>Name A-Z</option>');
    h.push('</select>');
    h.push('<button class="pm-btn small" id="ph-select-btn">Select</button>');
    h.push('<button class="pm-btn small primary" id="ph-upload-btn">Add Photos</button>');
    h.push('</div>');
  }
  h.push('</div>');

  if(!photos.length){
    h.push('<div class="ph-empty"><strong>No photos yet</strong><p>Upload site progress photos.</p></div>');
  }else{
    var grouped={};
    photos.forEach(function(p){var d=(p.createdAt||'').slice(0,10)||'Unknown';if(!grouped[d])grouped[d]=[];grouped[d].push(p);});
    var dates=Object.keys(grouped).sort();
    if(st.sortBy==='date-desc') dates.reverse();

    dates.forEach(function(date){
      var group=grouped[date];
      h.push('<div class="ph-date-header">'+fmtDate(group[0].createdAt)+' <span class="ph-date-count">'+group.length+' photo'+(group.length!==1?'s':'')+'</span></div>');
      h.push('<div class="ph-grid">');
      group.forEach(function(p){
        var isSel=!!st.selected[p.id];
        h.push('<div class="ph-thumb'+(isSel?' ph-sel':'')+'" data-ph-id="'+esc(p.id)+'">');
        h.push('<img src="/api/files/'+esc(p.id)+'?thumb=1" alt="'+esc(p.label||'')+'" loading="lazy">');
        h.push('<div class="ph-thumb-overlay"><span class="ph-thumb-label">'+esc(p.label||fmtDateTime(p.createdAt))+'</span></div>');
        if(st.selectMode) h.push('<span class="ph-check">✓</span>');
        h.push('</div>');
      });
      h.push('</div>');
    });
  }

  h.push('<input type="file" id="ph-file-input" accept="image/*" multiple style="display:none">');
  h.push('</div>');
  c.innerHTML=h.join('');
  _bindList();
}

function _bindList(){
  var ub=document.getElementById('ph-upload-btn');
  var fi=document.getElementById('ph-file-input');
  var selBtn=document.getElementById('ph-select-btn');
  var delBtn=document.getElementById('ph-delete-sel-btn');
  var sortSel=document.getElementById('ph-sort');

  if(ub&&fi) ub.addEventListener('click',function(){fi.click();});
  if(fi) fi.addEventListener('change',function(){
    var files=Array.from(fi.files);if(!files.length)return;
    var uploaded=0,failed=0;
    files.forEach(function(file){
      var form=new FormData();
      form.append('file',file);
      form.append('project_id',st.projectId);
      form.append('type','photo');
      form.append('metadata',JSON.stringify({label:file.name.replace(/\.[^.]+$/,'')}));
      fetch('/api/files/upload',{method:'POST',headers:_auth(),body:form}).then(function(r){return r.json();}).then(function(res){
        if(res.error){failed++;}else{uploaded++;}
        if(uploaded+failed===files.length){fi.value='';_paint(true);}
      }).catch(function(e){failed++;if(uploaded+failed===files.length){fi.value='';_paint(true);}});
    });
  });

  if(selBtn) selBtn.addEventListener('click',function(){
    st.selectMode=!st.selectMode;
    st.selected={};
    _renderList();
  });

  if(delBtn) delBtn.addEventListener('click',function(){
    var ids=Object.keys(st.selected).filter(function(k){return st.selected[k];});
    if(!ids.length||!confirm('Delete '+ids.length+' photo'+(ids.length!==1?'s':'')+'?'))return;
    var done=0,err=0;
    ids.forEach(function(id){
      _apiDelete('/api/files/'+id).then(function(){done++;if(done+err===ids.length){st.selected={};st.selectMode=false;_paint(true);}}).catch(function(e){err++;if(done+err===ids.length){st.selected={};st.selectMode=false;_paint(true);}});
    });
  });

  if(sortSel) sortSel.addEventListener('change',function(){
    st.sortBy=sortSel.value;
    _renderList();
  });

  var wrap=st.container.querySelector('.ph-wrap');
  if(wrap) wrap.addEventListener('click',function(e){
    var tb=e.target.closest('.ph-thumb');if(!tb)return;
    var pid=tb.getAttribute('data-ph-id');
    if(st.selectMode){
      st.selected[pid]=!st.selected[pid];
      if(!st.selected[pid]) delete st.selected[pid];
      _renderList();
      return;
    }
    var full=st.photoList.find(function(ph){return ph.id===pid;});
    st.photoIndex=full?st.photoList.indexOf(full):-1;
    st.viewingPhoto=full||{id:pid};
    st.container.innerHTML=_viewHtml();_bindView();
  });
}

function _nav(dir){
  var idx=st.photoIndex+dir;
  if(idx<0||idx>=st.photoList.length)return;
  st.photoIndex=idx;
  st.viewingPhoto=st.photoList[idx];
  st.container.innerHTML=_viewHtml();_bindView();
}

function _viewHtml(){
  var p=st.viewingPhoto||{};
  var projectName='';
  try{var s=S();var ap=s&&s.getActiveProject?function(){return s.getActiveProject()}():null;projectName=(ap&&ap.name)||'';}catch(e){}
  var uploaded=p.createdAt?fmtDateTime(p.createdAt):'';
  var hasPrev=st.photoIndex>0;
  var hasNext=st.photoIndex<st.photoList.length-1;
  var count=st.photoList.length;
  var pos=count?st.photoIndex+1:0;
  return '<div class="ph-view-wrap">'+
    '<div class="ph-view-header"><button class="pm-btn small" id="ph-view-back">← Back</button><button class="pm-btn small danger" id="ph-view-delete">Delete</button></div>'+
    '<div class="ph-view-stage">'+
      (hasPrev?'<div class="ph-nav-zone ph-nav-zone-left" id="ph-nav-prev"><div class="ph-nav-arrow ph-nav-arrow-left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div></div>':'')+
      '<img src="/api/files/'+esc(p.id)+'" alt="">'+
      (hasNext?'<div class="ph-nav-zone ph-nav-zone-right" id="ph-nav-next"><div class="ph-nav-arrow ph-nav-arrow-right"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div></div>':'')+
    '</div>'+
    '<div class="ph-view-meta">'+
      (count?'<div class="ph-meta-counter">'+pos+' / '+count+'</div>':'')+
      (projectName?'<div class="ph-meta-project">'+esc(projectName)+'</div>':'')+
      (uploaded?'<div>Uploaded: '+esc(uploaded)+'</div>':'')+
    '</div>'+
    '</div>';
}

function _bindView(){
  var backBtn=document.getElementById('ph-view-back');
  var delBtn=document.getElementById('ph-view-delete');
  var prev=document.getElementById('ph-nav-prev');
  var next=document.getElementById('ph-nav-next');

  if(backBtn) backBtn.addEventListener('click',function(){st.viewingPhoto=null;_renderList();});
  if(delBtn) delBtn.addEventListener('click',function(){
    if(confirm('Delete this photo?')){
      _apiDelete('/api/files/'+st.viewingPhoto.id).then(function(){st.viewingPhoto=null;_paint(true);});
    }
  });
  if(prev) prev.addEventListener('click',function(){_nav(-1);});
  if(next) next.addEventListener('click',function(){_nav(1);});

  var onKey=function(e){if(e.key==='ArrowLeft')_nav(-1);if(e.key==='ArrowRight')_nav(1);if(e.key==='Escape'){st.viewingPhoto=null;_renderList();}};
  document.addEventListener('keydown',onKey);
  if(backBtn) backBtn.addEventListener('click',function(){document.removeEventListener('keydown',onKey);},{once:true});
}

g.AlignPhotos=Object.freeze({render:render,CATEGORY:CAT});
if(window.TileRegistry) window.TileRegistry.register({id:'photos',title:'Photos',icon:'[]',route:'photos',roles:['user','admin'],order:5});
})(window);

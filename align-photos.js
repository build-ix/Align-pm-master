/* align-photos.js — Align Photos module (site progress gallery) */
(function(g){'use strict';
var S=function(){return g.AlignStorage;};
var CAT='photos';
var st={container:null,projectId:null,viewingPhoto:null,photoList:[],photoIndex:-1,selectMode:false,selected:{},catQueue:[],filterCompany:'all',sortBy:'date-desc'};

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}
function uid(){return'ph_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function nowISO(){return new Date().toISOString();}
function fmtDate(iso){try{var d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});}catch(e){return'';}}

function getCompanies(){
  if(!st.projectId)return[];
  var contacts=S().listRecords(st.projectId,'contacts')||[];
  var companies={};
  contacts.forEach(function(c){
    if(c.type==='company'&&c.company){companies[c.company.trim()]=true;}
    if(!c.type&&c.company){var n=c.company.trim();if(n)companies[n]=true;}
  });
  return Object.keys(companies).sort();
}

function getPhotos(){
  if(!st.projectId)return[];
  var all=S().listRecords(st.projectId,CAT);
  if(st.filterCompany!=='all'){
    all=all.filter(function(p){return(p.company||'')===st.filterCompany;});
  }
  if(st.sortBy==='company'){
    all.sort(function(a,b){return(a.company||'').localeCompare(b.company||'');});
  } else if(st.sortBy==='date-asc'){
    all.sort(function(a,b){return(a.createdAt||'').localeCompare(b.createdAt||'');});
  } else {
    all.sort(function(a,b){return(b.createdAt||'').localeCompare(a.createdAt||'');});
  }
  return all;
}

function render(c){if(!c)return;st.container=c;st.projectId=null;st.viewingPhoto=null;st.photoList=[];st.photoIndex=-1;st.selectMode=false;st.selected={};st.catQueue=[];st.filterCompany='all';st.sortBy='date-desc';_pid();_paint();}
function _pid(){var s=S();st.projectId=s&&s.getActiveProject()?s.getActiveProject().id:null;}
function _paint(){var c=st.container;if(!c)return;_pid();
  if(!st.projectId){c.innerHTML='<div class="ph-empty"><strong>No project</strong><p>Select a project.</p></div>';return;}
  if(st.viewingPhoto){c.innerHTML=_viewHtml();_bindView();return;}
  c.innerHTML=_listHtml();_bindList();}

function _listHtml(){
  var photos=getPhotos(),h=[];
  var selCount=Object.keys(st.selected).length;
  h.push('<div class="ph-wrap">');
  
  // Header
  h.push('<div class="ph-header" style="justify-content:flex-start;gap:0.5rem;flex-wrap:wrap;">');
  h.push('<h3 class="ph-title" style="flex:1 1 auto;">Site Photos</h3>');
  if(st.selectMode){
    h.push('<button class="pm-btn" id="ph-select-btn" style="margin-left:auto;">Cancel</button>');
    if(selCount>0){
      h.push('<button class="pm-btn primary" id="ph-categorize-btn">Categorize</button>');
      h.push('<button class="pm-btn danger" id="ph-delete-sel-btn" style="margin-left:0.25rem;">Delete ('+selCount+')</button>');
    }
  } else {
    h.push('<span style="margin-left:auto;"></span>');
    h.push('<button class="pm-btn primary" id="ph-upload-btn">Add Photos</button>');
  }
  h.push('</div>');

  if(!photos.length){
    h.push('<div class="ph-empty"><strong>No photos yet</strong><p>Upload site progress photos.</p></div>');
  } else {
    var grouped={};
    photos.forEach(function(p){var d=(p.createdAt||'').slice(0,10)||'Unknown';if(!grouped[d])grouped[d]=[];grouped[d].push(p);});
    var dates=Object.keys(grouped).sort().reverse();

    dates.forEach(function(date){
      var group=grouped[date];
      h.push('<div class="ph-date-header">'+fmtDate(group[0].createdAt)+' <span class="ph-date-count">'+group.length+' photo'+(group.length!==1?'s':'')+'</span></div>');
      h.push('<div class="ph-grid">');
      group.forEach(function(p){
        var isSel=st.selected[p.id];
        var company=p.company||'';
        h.push('<div class="ph-thumb'+(isSel?' ph-sel':'')+'" data-ph-id="'+esc(p.id)+'" data-ph-data="'+esc(p.dataUrl||'')+'">');
        if(p.dataUrl){
          h.push('<img src="'+esc(p.dataUrl)+'" alt="'+esc(p.label||'')+'" loading="lazy">');
        } else {
          h.push('<div class="ph-thumb-placeholder">📷</div>');
        }
        h.push('<div class="ph-thumb-overlay"><span class="ph-thumb-label">'+esc(p.label||fmtDate(p.createdAt))+'</span></div>');
        if(company) h.push('<span class="ph-tag">'+esc(company)+'</span>');
        if(st.selectMode) h.push('<span class="ph-check">✓</span>');
        h.push('</div>');
      });
      h.push('</div>');
    });
  }
  h.push('<input type="file" id="ph-file-input" accept="image/*" multiple style="display:none">');
  
  // Categorize dialog (hidden)
  var companiesForDialog=getCompanies();
  h.push('<div class="ph-cat-overlay" id="ph-cat-overlay" style="display:none;"><div class="ph-cat-dialog"><div class="ph-cat-title">Categorize by Company</div><div class="ph-cat-grid" id="ph-cat-grid">');
  companiesForDialog.forEach(function(c){
    h.push('<button class="ph-cat-tile" data-company="'+esc(c)+'">'+esc(c)+'</button>');
  });
  if(!companiesForDialog.length) h.push('<div style="grid-column:1/-1;font-size:0.75rem;color:var(--muted);text-align:center;">No companies in this project — add some in Directory first.</div>');
  h.push('<button class="ph-cat-tile" data-company="" style="opacity:0.6;">Uncategorized</button>');
  h.push('</div><button class="pm-btn" id="ph-cat-cancel" style="margin-top:0.75rem;width:100%;">Cancel</button></div></div>');
  
  h.push('</div>'); // .ph-wrap
  return h.join('');
}

function _bindList(){
  var ub=document.getElementById('ph-upload-btn');
  var fi=document.getElementById('ph-file-input');
  var selBtn=document.getElementById('ph-select-btn');
  var catBtn=document.getElementById('ph-categorize-btn');
  var delBtn=document.getElementById('ph-delete-sel-btn');
  var catOverlay=document.getElementById('ph-cat-overlay');
  var catCancel=document.getElementById('ph-cat-cancel');

  // Upload — save directly without prompt
  if(ub&&fi) ub.addEventListener('click',function(){fi.click();});
  if(fi) fi.addEventListener('change',function(){
    var files=Array.from(fi.files);if(!files.length)return;
    files.forEach(function(file){
      var reader=new FileReader();
      reader.onload=function(){
        var record = {id:uid(),dataUrl:reader.result,label:file.name.replace(/\.[^.]+$/,''),mimeType:file.type,size:file.size,createdAt:nowISO(),updatedAt:nowISO()};
        S().saveRecord(st.projectId,CAT,record);
      };
      reader.readAsDataURL(file);
    });
    fi.value='';
    setTimeout(function(){ _paint(); }, 300);
  });

  // Select mode toggle
  if(selBtn) selBtn.addEventListener('click',function(){
    st.selectMode=!st.selectMode;
    st.selected={};
    _paint();
  });

  // Categorize selected
  if(catBtn) catBtn.addEventListener('click',function(){
    var ids=Object.keys(st.selected).filter(function(k){return st.selected[k];});
    if(!ids.length)return;
    st.catQueue=ids.map(function(id){
      var photos=getPhotos();
      return photos.find(function(p){return p.id===id;});
    }).filter(Boolean);
    _showCatDialog(st.catQueue,false);
  });

  // Delete selected
  if(delBtn) delBtn.addEventListener('click',function(){
    var ids=Object.keys(st.selected).filter(function(k){return st.selected[k];});
    if(!ids.length||!confirm('Delete '+ids.length+' photo'+(ids.length!==1?'s':'')+'?'))return;
    ids.forEach(function(id){S().deleteRecord(st.projectId,CAT,id);});
    st.selected={};
    st.selectMode=false;
    _paint();
  });

  // Cat dialog cancel
  if(catCancel) catCancel.addEventListener('click',function(){
    catOverlay.style.display='none';
    if(st.catQueue.length&&!st.catQueue[0].id){
      st.catQueue.forEach(function(p){p.company='';S().saveRecord(st.projectId,CAT,p);});
      st.catQueue=[];
      _paint();
    }
  });

  // Cat dialog trade selection
  var catGrid=document.getElementById('ph-cat-grid');
  if(catGrid) catGrid.addEventListener('click',function(e){
    var btn=e.target.closest('.ph-cat-tile');if(!btn)return;
    var company=btn.getAttribute('data-company');
    if(company===null)return;
    st.catQueue.forEach(function(p){p.company=company;S().saveRecord(st.projectId,CAT,p);});
    st.catQueue=[];
    st.selected={};
    st.selectMode=false;
    catOverlay.style.display='none';
    _paint();
  });

  // Thumbnail click — view or select
  var wrap = st.container.querySelector('.ph-wrap');
  if (wrap) wrap.addEventListener('click', function(e) {
    var tb = e.target.closest('.ph-thumb'); if (!tb) return;
    var pid = tb.getAttribute('data-ph-id');
    
    if(st.selectMode){
      st.selected[pid]=!st.selected[pid];
      _paint();
      return;
    }

    var photos = getPhotos();
    var full = photos.find(function(ph) { return ph.id === pid; });
    st.photoList = photos;
    st.photoIndex = full ? photos.indexOf(full) : -1;
    st.viewingPhoto = full || { id: pid, dataUrl: tb.getAttribute('data-ph-data') };
    _paint();
  });
}

function _showCatDialog(queue, isUpload){
  var overlay=document.getElementById('ph-cat-overlay');
  if(!overlay)return;
  overlay.style.display='flex';
  var first=overlay.querySelector('.ph-cat-tile');
  if(first) setTimeout(function(){first.focus();},100);
}

function _nav(dir){
  var idx=st.photoIndex+dir;
  if(idx<0||idx>=st.photoList.length)return;
  st.photoIndex=idx;
  st.viewingPhoto=st.photoList[idx];
  _paint();
}

function _viewHtml(){
  var p=st.viewingPhoto||{};
  var projectName='';
  try{var s=S();var ap=s&&s.getActiveProject?function(){return s.getActiveProject()}():null;projectName=(ap&&ap.name)||'';}catch(e){}
  var uploaded=p.createdAt?fmtDate(p.createdAt):'';
  var company=p.company||'';
  var hasPrev=st.photoIndex>0;
  var hasNext=st.photoIndex<st.photoList.length-1;
  var count=st.photoList.length;
  var pos=count?st.photoIndex+1:0;
  return '<div class="ph-view-wrap">'+
    '<div class="ph-view-header"><button class="pm-btn" id="ph-view-back">← Back</button><button class="pm-btn danger" id="ph-view-delete">🗑 Delete</button></div>'+
    '<div class="ph-view-stage">'+
      (hasPrev?'<div class="ph-nav-zone ph-nav-zone-left" id="ph-nav-prev" style="position:absolute;left:0;top:0;bottom:0;width:50%;z-index:2;display:flex;align-items:center;justify-content:flex-start;cursor:pointer;opacity:0;transition:opacity 0.15s ease;"><span style="background:rgba(0,0,0,0.55);color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-left:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></span></div>':'')+
      '<img src="'+esc(p.dataUrl)+'" class="ph-view-img">'+
      (hasNext?'<div class="ph-nav-zone ph-nav-zone-right" id="ph-nav-next" style="position:absolute;right:0;top:0;bottom:0;width:50%;z-index:2;display:flex;align-items:center;justify-content:flex-end;cursor:pointer;opacity:0;transition:opacity 0.15s ease;"><span style="background:rgba(0,0,0,0.55);color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-right:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>':'')+
    '</div>'+
    '<div class="ph-view-meta">'+
      (count?'<div class="ph-meta-counter">'+pos+' / '+count+'</div>':'')+
      (projectName?'<div class="ph-meta-project">'+esc(projectName)+'</div>':'')+
      (uploaded?'<div style="margin-bottom:0.5rem;">Uploaded: '+esc(uploaded)+'</div>':'')+
      // Company row
      '<div style="display:flex;align-items:center;gap:0.5rem;">'+
        (company
          ? '<span class="ph-tag" style="display:inline-block;margin:0;font-size:0.6875rem;">'+esc(company)+'</span><button class="ph-edit-company" id="ph-edit-company" title="Change company" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--muted);font-size:0.75rem;opacity:0.6;transition:opacity 0.15s;">✎</button>'
          : '<button class="ph-add-company" id="ph-add-company" style="background:transparent;border:1.5px solid #fff;color:#fff;padding:0.3rem 0.75rem;border-radius:100px;font-size:0.6875rem;cursor:pointer;font-weight:500;letter-spacing:0.03em;transition:all 0.15s;mix-blend-mode:screen;">Add Company</button>'
        )+
      '</div>'+
    '</div>'+
    '</div>';
}

function _bindView(){
  var backBtn = document.getElementById('ph-view-back');
  var delBtn = document.getElementById('ph-view-delete');
  var prev = document.getElementById('ph-nav-prev');
  var next = document.getElementById('ph-nav-next');
  var addBtn = document.getElementById('ph-add-company');
  var editBtn = document.getElementById('ph-edit-company');

  if(backBtn) backBtn.addEventListener('click',function(){st.viewingPhoto=null;_paint();});
  if(delBtn) delBtn.addEventListener('click',function(){
    if(confirm('Delete this photo?')){S().deleteRecord(st.projectId,CAT,st.viewingPhoto.id);st.viewingPhoto=null;_paint();}
  });
  if(prev) prev.addEventListener('click',function(){_nav(-1);});
  if(next) next.addEventListener('click',function(){_nav(1);});

  var onKey=function(e){if(e.key==='ArrowLeft')_nav(-1);if(e.key==='ArrowRight')_nav(1);};
  document.addEventListener('keydown',onKey,{once:false, signal: window._sectionSignal});
  if(backBtn) backBtn.addEventListener('click',function(){document.removeEventListener('keydown',onKey);},{once:true});

  // Add Company / Edit company — open single-photo categorize dialog
  function openSingleCat(){
    if(!st.viewingPhoto)return;
    st.catQueue=[st.viewingPhoto];
    _showCatDialog(st.catQueue,false);
    var checkClose=setInterval(function(){
      if (window._sectionSignal && window._sectionSignal.aborted) { clearInterval(checkClose); return; }
      var ov=document.getElementById('ph-cat-overlay');
      if(!ov||ov.style.display==='none'){
        clearInterval(checkClose);
        st.viewingPhoto=S().listRecords(st.projectId,CAT).find(function(p){return p.id===st.viewingPhoto.id;})||st.viewingPhoto;
        _paint();
      }
    },200);
  }
  if(addBtn) addBtn.addEventListener('click',openSingleCat);
  if(editBtn) editBtn.addEventListener('click',openSingleCat);
}

g.AlignPhotos=Object.freeze({render:render,CATEGORY:CAT});
  if (window.TileRegistry) window.TileRegistry.register({ id: 'photos', title: 'Photos', icon: '[]', route: 'photos', roles: ['user','admin'], order: 5 });
})(window);

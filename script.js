// ─── SECTION CONTENT ───
// Each key matches the data-section attribute on the tile in index.html.
const sections = {
  "drawings":    { title: "Drawings",    content: `<p>View and manage all project drawings here.</p>`, render: function(el) { if (window.AlignDrawings) window.AlignDrawings.render(el); } },
  "daily-logs":  { title: "Daily Logs",  content: `<p>Record and review daily site activity logs here.</p>`, render: function(el) { if (window.AlignDailyLogs) window.AlignDailyLogs.render(el); } },
  "specs":       { title: "Specs",       content: `<p>Access all project specifications and technical documents here.</p>`, render: function(el) { if (window.AlignSpecs) window.AlignSpecs.render(el); } },
  "rfis":        { title: "RFIs",        content: `<p>Submit and track Requests for Information (RFIs) here.</p>`, render: function(el, chrome) { if (window.AlignRfis) window.AlignRfis.render(el, chrome); } },
  "punchlist":   { title: "Punchlist",   content: `<p>Manage and close out punchlist items here.</p>`, render: function(el, chrome) { if (window.AlignPunchlist) window.AlignPunchlist.render(el, chrome); } },
  "schedule":    { title: "Schedule",    content: `<p>View the project timeline and milestone schedule here.</p>`, render: function(el) { if (window.AlignSchedule) window.AlignSchedule.render(el); } },
  "budget":      { title: "Budget",      content: `<p>Track project costs, change orders, and budget status here.</p>`, render: function(el) { if (window.AlignBudget) window.AlignBudget.render(el); } },
  "contacts":    { title: "Directory",   content: ``, render: function(el) { if (window.AlignContacts) window.AlignContacts.render(el); } },
  "photos":      { title: "Photos",      content: `<p>Browse and upload site progress photos here.</p>`, render: function(el) { if (window.AlignPhotos) window.AlignPhotos.render(el); } },
  "tasks":       { title: "Tasks",       content: `<p>Assign, track, and complete project tasks here.</p>`, render: function(el) { if (window.AlignTasks) window.AlignTasks.render(el); } },
  "procurement": { title: "Procurement", content: `<p>Manage purchase orders, material orders, and lead times here.</p>`, render: function(el) { if (window.AlignProcurement) window.AlignProcurement.render(el); } },
  "files":       { title: "Files",       content: ``, render: function(el) { if (window.AlignFiles) { var active = window.AlignStorage ? window.AlignStorage.getActiveProject() : null; if (active) window.AlignFiles.render(el, active.id); else el.innerHTML = '<div class=\"pm-empty\"><strong>No active project</strong> Select a project first.</div>'; } } },
  "settings":    { title: "Settings",    content: `<p>Configure project settings and preferences here.</p>`, render: function(el) { if (window.AlignSettings) window.AlignSettings.render(el); } },
  "project-select": { title: "Select Project", render: function(el) { if (window._renderProjectSelect) window._renderProjectSelect(el); } },
  "all-tools": { title: "All Tools", render: function(el) {
    // Clone the tile grid into the section page
    var grid = document.querySelector('.tile-grid');
    if (grid) {
      el.innerHTML = '<div class="tile-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px;">' + grid.innerHTML + '</div>';
      // Re-attach click handlers to the cloned tiles
      el.querySelectorAll('.tile').forEach(function(tile) {
        tile.addEventListener('click', function() {
          var key = this.getAttribute('data-section');
          if (key && sections[key]) location.hash = '#/' + key;
        });
      });
    } else {
      el.innerHTML = '<div class="pm-empty">No tools available</div>';
    }
  } }
};

// ─── ELEMENT REFERENCES ───
const tiles            = document.querySelectorAll(".tile");
const tileGrid         = document.querySelector(".tile-grid");
const appHeader        = document.querySelector(".app-header");
const dashboard        = document.getElementById("dashboard");
const essentials       = document.getElementById("essentials");
const sectionPage      = document.getElementById("section-page");
const sectionTitle     = document.getElementById("section-title");
const sectionBody      = document.getElementById("section-body");
const sectionBack      = document.getElementById("section-back");
const sectionHeaderActions = document.getElementById("section-header-actions");

const projectPicker    = document.getElementById("project-picker");
const projectName      = document.getElementById("project-name");

// ─── HASH ROUTING STATE ───

// ─── SECTION PAGE NAVIGATION ───
// iOS Safari ignores CSS touch-action + overflow:hidden on <body> for
// rubber-band prevention.  The only 100 % reliable lock is a document-level
// touchmove handler that calls preventDefault().
var _sectionScrollY = 0;
function _bodyTouchLock(e) {
  var t = e.target;
  while (t) {
    if (false || false) return;
    if (t.id === 'dr-mv-overlay-host' || t.closest('#dr-mv-overlay-host')) { e.preventDefault(); return; }
    t = t.parentElement;
  }
  e.preventDefault();
}
var _lastFocusedEl = null; // saved before opening modal, restored on close

function _openSection() {
  document.body.classList.add('section-open');
  if (tileGrid) tileGrid.style.display = 'none';
  if (appHeader) appHeader.style.display = 'none';
  if (dashboard) dashboard.style.display = 'none';
  if (essentials) essentials.style.display = 'none';
  sectionPage.style.display = 'block';
  sectionPage.scrollTop = 0;
}

function _closeSection() {
  document.body.classList.remove('section-open');
  document.body.classList.remove('ps-open');
  // Abort any in-flight work from the current section
  if (_sectionController) { _sectionController.abort(); _sectionController = null; }
  window._sectionSignal = null;

  // Show home screen, hide section page
  if (tileGrid) tileGrid.style.display = '';
  if (appHeader) appHeader.style.display = '';
  if (dashboard) dashboard.style.display = '';
  if (essentials) essentials.style.display = '';
  sectionPage.style.display = 'none';
  sectionBody.innerHTML = '';
  sectionTitle.textContent = '';
  if (sectionHeaderActions) sectionHeaderActions.replaceChildren();
  _navStack = [];
  _currentSection = null;
}

// ─── SECTION HEADER CHROME (script-owned; modules drive it via chrome.setHeader) ───
function setSectionHeader(config) {
  config = config || {};
  if (sectionTitle) sectionTitle.textContent = config.title || '';
  if (sectionBack) {
    sectionBack.textContent = config.backLabel || 'Back';
    sectionBack.setAttribute('aria-label', config.backLabel || 'Back');
    sectionBack.hidden = false;
  }
  if (sectionHeaderActions) {
    sectionHeaderActions.replaceChildren();
    (config.actions || []).forEach(function (action) {
      var button = document.createElement('button');
      button.id = action.id || '';
      button.type = action.type || 'button';
      button.textContent = action.label || '';
      button.className = 'section-header-action section-header-action--' + (action.variant || 'secondary');
      if (action.form) button.setAttribute('form', action.form);
      if (action.disabled) button.disabled = true;
      if (action.ariaLabel) button.setAttribute('aria-label', action.ariaLabel);
      if (typeof action.onClick === 'function') button.addEventListener('click', action.onClick);
      sectionHeaderActions.appendChild(button);
    });
  }
}
function _makeSectionChrome(sectionKey) {
  return {
    setHeader: function (config) {
      if (_currentSection !== sectionKey) return;
      setSectionHeader(config);
    }
  };
}
// Tiles whose modules implement handleBack() to consume the back button internally
const _sectionBackModules = {
  punchlist: 'AlignPunchlist',
  rfis: 'AlignRfis',
  tasks: 'AlignTasks',
  contacts: 'AlignContacts',
  specs: 'AlignSpecs',
  schedule: 'AlignSchedule',
  budget: 'AlignBudget',
  procurement: 'AlignProcurement'
};

// ─── INIT: RESTORE ACTIVE PROJECT NAME IN HEADER ───
(function initHeader() {
  if (!window.AlignStorage) return;
  var active = window.AlignStorage.getActiveProject();
  if (active) {
    projectName.textContent = active.name;
    window._fetchMyPermissions(active.id);
  }
})();

// ─── Tile icon colors are controlled by align-polish.css ───

// ─── PERMISSIONS: Tile visibility based on room access ───
window._myPermissions = {};

window._applyTilePermissions = function(perms) {
  window._myPermissions = perms || {};
  tiles.forEach(function(t) {
    var section = t.getAttribute('data-section');
    if (!section) return;
    var level = (perms && perms[section]) ? perms[section] : 'rw';
    t.style.display = level === 'none' ? 'none' : '';
  });
};

window._fetchMyPermissions = function(pid) {
  if (!pid) return;
  var token = localStorage.getItem('align-token') || '';
  fetch('/api/projects/' + encodeURIComponent(pid) + '/my-permissions', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    window._applyTilePermissions(data.permissions);
  })
  .catch(function() {
    // If server is unreachable, show all tiles (fail open)
    window._applyTilePermissions({});
  });
};

// ─── TILE CLICK → OPEN SECTION (event delegation on grid) ───
// ─── TILE CACHE ───
// Caches rendered tile HTML so back-navigation is instant. Invalidated on writes.
let _tileCache = {};
var TILE_STALE_MS = 60000; // re-fetch data after 60s

// Called after any successful write to bust the cache for affected tiles
window._invalidateTileCache = function(tileKey) {
  if (tileKey) delete _tileCache[tileKey];
  else _tileCache = {}; // bust all if no tile specified
};
// All navigation goes through location.hash. Browser back/forward work for free.
// Hash format: #section or #settings/subview

let _currentSection = null;
let _sectionController = null; // AbortController for cleanup
let _navStack = []; // Settings sub-view stack

function _handleRoute() {
  var hash = location.hash.replace(/^#\/?/, '') || '';
  var parts = hash.split('/');
  var sectionKey = parts[0] || null;

  // Permission gate: block forbidden rooms
  if (sectionKey && window._myPermissions) {
    var perm = window._myPermissions[sectionKey];
    if (perm === 'none') {
      location.hash = '';
      return;
    }
  }

  // Close current section cleanly if navigating away
  if (_currentSection && _currentSection !== sectionKey) {
    _closeSection();
  }

  // Home page (no hash)
  if (!sectionKey) {
    _closeSection();
    return;
  }

  // Open section
  var section = sections[sectionKey];
  if (!section) return;

  _sectionController = new AbortController();
  window._sectionSignal = _sectionController.signal;
  _currentSection = sectionKey;
  document.body.classList.toggle('ps-open', sectionKey === 'project-select');
  _navStack = [];
  setSectionHeader({ title: section.title, backLabel: 'Back', actions: [] });

  // Tile cache — skip data re-fetch if rendered recently
  // These sections manage their own state/live data; never cache them
  var cacheEntry = (sectionKey === 'settings' || sectionKey === 'essentials-config' || sectionKey === 'daily-logs' || sectionKey === 'contacts' || sectionKey === 'project-select' || sectionKey === 'photos' || sectionKey === 'punchlist' || sectionKey === 'drawings') ? null : _tileCache[sectionKey];
  if (cacheEntry && (Date.now() - cacheEntry.ts < TILE_STALE_MS)) {
    sectionBody.innerHTML = cacheEntry.html;
    _openSection();
    sectionPage.scrollTop = 0;
    return;
  }

  sectionBody.innerHTML = '';

  if (typeof section.render === 'function') {
    try { section.render(sectionBody, _makeSectionChrome(sectionKey)); } catch(e) {
      sectionBody.innerHTML = '<div class="pm-empty"><strong>Error</strong><p>'+e.message+'</p></div>';
    }
  } else {
    sectionBody.innerHTML = section.content;
  }

  // Cache rendered HTML for instant back-navigation
  _tileCache[sectionKey] = { html: sectionBody.innerHTML, ts: Date.now() };

  _openSection();
  sectionPage.scrollTop = 0;
}

window.addEventListener('hashchange', _handleRoute);
// Delay initial routing until boot is complete (project cache hydrated)
document.addEventListener('align-ready', function() {
  var active = window.AlignStorage && window.AlignStorage.getActiveProject();
  if (active) window._fetchMyPermissions(active.id);
  if (location.hash) _handleRoute();
});
// Fallback: if align-ready already fired before this script ran
if (window._alignReadyFired && location.hash) _handleRoute();

// ─── TILE CLICKS → just set the hash ───
if (tileGrid) {
  tileGrid.addEventListener('click', function(e) {
    var tile = e.target.closest('.tile');
    if (!tile) return;
    var key = tile.getAttribute('data-section');
    if (!key || !sections[key]) return;
    if (location.hash === '#' + key) return; // already there
    location.hash = '#' + key;
  });
}

window._pushSettingsSubview = function(title, renderFn) {
  _navStack.push({ title: title, renderFn: renderFn });
  sectionTitle.textContent = title;
  sectionBody.innerHTML = '';
  try { renderFn(sectionBody); } catch(e) {
    sectionBody.innerHTML = '<div class="pm-empty"><strong>Error</strong><p>' + e.message + '</p></div>';
  }
};

// ─── BACK BUTTON — document-level delegation (survives DOM rebuilds) ───
document.addEventListener('click', function(e) {
  if (!e.target.closest('#section-back')) return;
  e.preventDefault();

  // Module-internal back navigation (drill-down tiles return true to consume the back)
  var backModule = _sectionBackModules[_currentSection];
  if (backModule && window[backModule] && typeof window[backModule].handleBack === 'function' && window[backModule].handleBack()) {
    return;
  }

  // Essentials config — close cleanly without hash cycle
  if (_currentSection === 'essentials-config') {
    _currentSection = null;
    var hdrSave = document.getElementById('ess-config-header-save');
    if (hdrSave) hdrSave.remove();
    _closeSection();
    return;
  }

  if (_currentSection === 'settings' && _navStack.length > 0) {
    // Pop sub-view and re-render previous
    _navStack.pop();
    if (_navStack.length > 0) {
      var prev = _navStack[_navStack.length - 1];
      sectionTitle.textContent = prev.title;
      sectionBody.innerHTML = '';
      try { prev.renderFn(sectionBody); } catch(e) {
        sectionBody.innerHTML = '<div class="pm-empty"><strong>Error</strong><p>' + e.message + '</p></div>';
      }
      return;
    }
    // Stack empty — back to Settings main
    if (window.AlignSettings) {
      window.AlignSettings.render(sectionBody);
      sectionTitle.textContent = 'Settings';
      return;
    }
  }
  // Go home via hash
  _navStack = [];
  location.hash = '';
});

// ─── PROJECT PICKER ───
if (projectPicker) {
  projectPicker.addEventListener("click", () => {
    location.hash = '#project-select';
  });
}

// ─── LISTEN FOR PROJECT CHANGES FROM SETTINGS PANEL ───
if (window.AlignProjects) {
  window.AlignProjects.onProjectChange(function (project) {
    if (project) {
      projectName.textContent = project.name;
    } else {
      // Active project was deleted
      projectName.textContent = "Choose Project";
    }
  });
}


// ─── CLOSE ANY OPEN MODAL ON BACK GESTURE / ESC ───
function closeAllModals() {
  // If the drawing viewer is open, let its own escape handler manage closing
  if (document.getElementById('dr-mv-overlay-host')) {
    document.removeEventListener('touchmove', _bodyTouchLock);
    return;
  }
  // Restore home page visibility
  if (tileGrid) tileGrid.style.display = '';
  if (appHeader) appHeader.style.display = '';
  sectionPage.style.display = 'none';
  sectionBody.innerHTML = "";
  sectionTitle.textContent = "";
  _currentSection = null;
  // Restore scroll position (clear the position:fixed lock)
  document.body.classList.remove("section-open");
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.top = '';
  document.removeEventListener('touchmove', _bodyTouchLock);
  window.scrollTo(0, _sectionScrollY);
}

window.addEventListener("popstate", closeAllModals);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") return closeAllModals();
  
  // Focus trapping: when modal is open, keep Tab within the modal
  if (e.key === "Tab" && document.body.classList.contains("section-open")) {
    var focusable = sectionPage.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
});

// ─── AUTH: PROJECT NAME IN HEADER ─────────────────────────────────────────────
function _updateProjectName() {
  if (!window.AlignStorage) return;
  var active = window.AlignStorage.getActiveProject();
  if (active && projectName) {
    if (typeof active.then === 'function') {
      active.then(function(p) { if (p && projectName) projectName.textContent = p.name; });
    } else {
      projectName.textContent = active.name;
    }
  }
}

// ─── AUTH: TILE FILTERING ────────────────────────────────────────────────────
function _applyPermissionsFilter() {
  if (!window.AlignAuth) return;

  var user = window.AlignAuth.getActiveUser();
  if (!user) return; // no user signed in yet → auth overlay handles this

  // Admins see everything
  if (user.role === 'admin') {
    tiles.forEach(function (t) { t.style.display = ''; });
    return;
  }

  // Project admins: see everything within their project
  var active = window.AlignStorage ? window.AlignStorage.getActiveProject() : null;
  var isProjectAdmin = false;
  if (active && window.AlignAuth.isProjectAdmin) {
    isProjectAdmin = window.AlignAuth.isProjectAdmin(active.id);
  }

  // Regular users: filter by permissions
  var perms = window.AlignAuth.loadPermissions(user.email);

  tiles.forEach(function (tile) {
    var section = tile.getAttribute('data-section');
    // Files are GC/project-admin only — hidden from regular members
    if (section === 'files' && !isProjectAdmin) {
      tile.style.display = 'none';
      return;
    }
    if (perms[section] === false) {
      tile.style.display = 'none';
    } else {
      tile.style.display = '';
    }
  });
}

// ─── AUTH: USER BADGE IN HEADER ──────────────────────────────────────────────
function _renderUserBadge() {
  var container = document.getElementById('user-badge-container');
  if (!container) return;

  var user = (window.AlignAuth && window.AlignAuth.getActiveUser && window.AlignAuth.getActiveUser())
    || (window.Store && window.Store.get('user'));
  if (!user) {
    container.innerHTML = '';
    // Clear cached badge hint on sign-out
    try { localStorage.removeItem('align_badge_hint'); } catch(e) {}
    return;
  }

  var displayName = user.name || (user.firstName + ' ' + user.lastName);
  var initials = (displayName || '??').split(' ').map(function(p) { return p[0] || ''; }).join('').toUpperCase().slice(0, 2) || '?';
  var avatarCls = user.role === 'admin' ? ' admin' : '';
  // Cache badge info for instant render on next load
  try { localStorage.setItem('align_badge_hint', JSON.stringify({name: displayName, initials: initials, avatarCls: avatarCls})); } catch(e) {}

  container.innerHTML =
    '<div class="user-badge" id="user-badge">' +
      '<div class="user-badge-avatar' + avatarCls + '">' + _escHtml(initials) + '</div>' +
      '<span class="user-badge-name">' + _escHtml(displayName.split(' ')[0]) + '</span>' +
    '</div>' +
    '<div class="user-menu" id="user-menu">' +
      '<div class="user-menu-header">' +
        '<div class="user-menu-name">' + _escHtml(displayName) + '</div>' +
        '<div class="user-menu-email">' + _escHtml(user.email) + '</div>' +
        (user.role === 'admin' ? '<span class="user-menu-role-tag admin">Admin</span>' : '') +
      '</div>' +
      '<div class="user-menu-divider"></div>' +
      '<button class="user-menu-item" id="user-menu-settings">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
        'Settings' +
      '</button>' +
      '<button class="user-menu-item danger" id="user-menu-signout">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
        'Sign Out' +
      '</button>' +
    '</div>';

  // Toggle dropdown
  var badge = document.getElementById('user-badge');
  var menu  = document.getElementById('user-menu');
  if (badge && menu) {
    badge.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', function () {
      menu.classList.remove('open');
    });
  }

  // Settings link — opens settings section directly
  var settingsBtn = document.getElementById('user-menu-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function () {
      menu.classList.remove('open');
      location.hash = '#settings';
    });
  }

  // Sign out — clean reset via align-auth-change event
  var signOutBtn = document.getElementById('user-menu-signout');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', function () {
      menu.classList.remove('open');
      if (window.AlignAuth) {
        window.AlignAuth.signOut();
        // The 'align-auth-change' event handler takes care of:
        //   - clearing the user badge
        //   - hiding tileGrid + appHeader
        //   - showing the auth overlay
      }
    });
  }
}

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── AUTH: INIT ON LOAD ──────────────────────────────────────────────────────
(function _initAuth() {
  // If new router already booted, skip old auth overlay logic
  // If new router already booted, skip old auth overlay logic
  if (window._routerBooted) {
    // Suppress the old auth overlay (it's visible by default in HTML)
    var _ao = document.getElementById('align-auth-overlay');
    if (_ao) _ao.style.display = 'none';
    var _user = window.Store && window.Store.get('user');
    if (_user) { _renderUserBadge(_user); }
    return;
  }

  // Wait for boot (API detection) before deciding which Auth to use
  var bootPromise = window.Align && window.Align.ready
    ? window.Align.ready
    : Promise.resolve('local');

  // Optimistic badge render from cache — instant, before any network request
  try {
    var _badgeHint = JSON.parse(localStorage.getItem('align_badge_hint'));
    var _bc = document.getElementById('user-badge-container');
    if (_badgeHint && _bc && _bc.childElementCount === 0) {
      _bc.innerHTML = '<div class="user-badge"><div class="user-badge-avatar' + _badgeHint.avatarCls + '">' + _escHtml(_badgeHint.initials) + '</div><span class="user-badge-name">' + _escHtml(_badgeHint.name.split(' ')[0]) + '</span></div>';
    }
  } catch(e) {}

  bootPromise.then(function(mode) {
    if (!window.AlignAuth) return;

    // Check if a user is signed in
    var user = window.AlignAuth.getActiveUser();
    if (!user) {
      // Show sign-in overlay; hide app until signed in
      if (tileGrid) tileGrid.style.display = 'none';
      if (appHeader) appHeader.style.display = 'none';
      // If API mode, init() is already done by boot. Just show overlay.
      if (mode === 'api') {
        window.AlignAuth.showAuthOverlay();
      } else {
        window.AlignAuth.init();
        window.AlignAuth.showAuthOverlay();
      }
    } else {
      // User is signed in — render badge and apply permissions
      document.body.classList.add('auth-ready');
      _renderUserBadge();
      _applyPermissionsFilter();
      _updateProjectName();
      if (location.hash) _handleRoute();
    }

    // Listen for auth changes (sign-in / sign-out)
    document.addEventListener('align-auth-change', function () {
    var u = window.AlignAuth.getActiveUser();
    if (u) {
      // User just signed in
      document.body.classList.add('auth-ready');
      if (tileGrid) tileGrid.style.display = '';
      if (appHeader) appHeader.style.display = '';
      _renderUserBadge();
      _applyPermissionsFilter();
      // Update header project name
      _updateProjectName();
      if (location.hash) _handleRoute();
    } else {
      // User signed out
      document.body.classList.remove('auth-ready');
      if (tileGrid) tileGrid.style.display = 'none';
      if (appHeader) appHeader.style.display = 'none';
      var container = document.getElementById('user-badge-container');
      if (container) container.innerHTML = '';
      try { localStorage.removeItem('align_badge_hint'); } catch(e) {}
      window.AlignAuth.showAuthOverlay();
    }
  });

  // Also re-apply filter when project changes
  if (window.AlignProjects) {
    var _origOnProjectChange = window.AlignProjects.onProjectChange;
    window.AlignProjects.onProjectChange = function (cb) {
      _origOnProjectChange.call(window.AlignProjects, function (project) {
        cb(project);
        _applyPermissionsFilter();
      });
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DASHBOARD — date + 6-day weather forecast
     Uses Open-Meteo (free, no API key) + browser Geolocation
     ═══════════════════════════════════════════════════════════════════════ */

  (function () {
    var dashDay   = document.getElementById('dash-day');
    var dashFull  = document.getElementById('dash-full');
    var dashCity  = document.getElementById('dash-city');
    var dashLoc   = document.getElementById('dash-location');
    var weatherRow = document.getElementById('weather-row');

    if (!dashDay || !dashFull || !weatherRow) {
      console.warn('[Weather] Dashboard elements missing — DOM not ready?');
      return;
    }

    // ── 1. DATE ──────────────────────────────────────────────────────────

    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

    function updateDate() {
      var now = new Date();
      dashDay.textContent = days[now.getDay()];
      dashFull.textContent = months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
    }
    updateDate();

    // ── 2. WEATHER SVG ICONS ─────────────────────────────────────────────

    function weatherIconSVG(code, isDay, size) {
      // WMO codes → clean SVG icon
      size = size || 48;
      var s = '<svg width="100%" height="100%" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg">';

      // Helper: sun (rays + circle)
      function sun(cx, cy, r, color) {
        var o = '';
        // rays
        for (var i = 0; i < 8; i++) {
          var a = (i * 45) * Math.PI / 180;
          var x1 = cx + Math.cos(a) * (r + 4);
          var y1 = cy + Math.sin(a) * (r + 4);
          var x2 = cx + Math.cos(a) * (r + 10);
          var y2 = cy + Math.sin(a) * (r + 10);
          o += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + color + '" stroke-width="3" stroke-linecap="round"/>';
        }
        o += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '" class="wc-anim-sun"/>';
        return o;
      }

      // Helper: cloud body
      function cloud(cx, cy, color) {
        var o = '<g class="wc-anim-cloud">';
        o += '<ellipse cx="' + (cx - 12) + '" cy="' + (cy + 4) + '" rx="12" ry="9" fill="' + color + '"/>';
        o += '<ellipse cx="' + cx + '" cy="' + (cy - 2) + '" rx="15" ry="11" fill="' + color + '"/>';
        o += '<ellipse cx="' + (cx + 12) + '" cy="' + (cy + 3) + '" rx="11" ry="8" fill="' + color + '"/>';
        o += '<rect x="' + (cx - 27) + '" y="' + (cy + 4) + '" width="54" height="10" rx="5" fill="' + color + '"/>';
        o += '</g>';
        return o;
      }

      // Helper: raindrops
      function raindrops(cx, cy, color) {
        var o = '';
        var drops = [
          {x: cx - 14, y: cy + 14, s: 1.1},
          {x: cx,      y: cy + 20, s: 1.3},
          {x: cx + 14, y: cy + 13, s: 1.0}
        ];
        drops.forEach(function(d) {
          o += '<g class="wc-anim-rain">';
          o += '<line x1="' + d.x + '" y1="' + (d.y - 4) + '" x2="' + d.x + '" y2="' + (d.y + 2) + '" stroke="' + color + '" stroke-width="' + (2.5 * d.s) + '" stroke-linecap="round"/>';
          o += '<circle cx="' + d.x + '" cy="' + (d.y + 4.5) + '" r="' + (1.5 * d.s) + '" fill="' + color + '"/>';
          o += '</g>';
        });
        return o;
      }

      // Helper: snowflakes
      function snowflakes(cx, cy, color) {
        var o = '';
        var spots = [{x: cx-14, y: cy+16}, {x: cx, y: cy+22}, {x: cx+14, y: cy+15}];
        spots.forEach(function(p) {
          var x = p.x, y = p.y;
          o += '<g class="wc-anim-snow">';
          o += '<circle cx="' + x + '" cy="' + y + '" r="2" fill="' + color + '"/>';
          o += '<line x1="' + x + '" y1="' + (y-4) + '" x2="' + x + '" y2="' + (y+4) + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round"/>';
          o += '<line x1="' + (x-3.5) + '" y1="' + (y-2.5) + '" x2="' + (x+3.5) + '" y2="' + (y+2.5) + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round"/>';
          o += '<line x1="' + (x+3.5) + '" y1="' + (y-2.5) + '" x2="' + (x-3.5) + '" y2="' + (y+2.5) + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round"/>';
          o += '</g>';
        });
        return o;
      }

      // Helper: lightning bolt
      function bolt(cx, cy, color) {
        return '<polygon class="wc-anim-lightning" points="' + (cx+4) + ',' + (cy+10) + ' ' + (cx-2) + ',' + (cy+21) + ' ' + (cx+1) + ',' + (cy+21) + ' ' + (cx-5) + ',' + (cy+34) + ' ' + (cx+9) + ',' + (cy+19) + ' ' + (cx+5) + ',' + (cy+19) + ' ' + (cx+10) + ',' + (cy+10) + '" fill="' + color + '"/>';
      }

      // Helper: fog lines
      function fogLines(cx, cy, color) {
        var o = '';
        for (var i = 0; i < 4; i++) {
          o += '<line class="wc-anim-fog" x1="' + (cx - 22) + '" y1="' + (cy + i * 8 - 2) + '" x2="' + (cx + 22) + '" y2="' + (cy + i * 8 - 2) + '" stroke="' + color + '" stroke-width="3" stroke-linecap="round" opacity="' + (0.35 + i * 0.2) + '"/>';
        }
        return o;
      }

      // Helper: moon (crescent)
      function moon(cx, cy, r, color) {
        var o = '';
        o += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '" class="wc-anim-pulse"/>';
        // Crescent shadow
        o += '<circle cx="' + (cx + r*0.4) + '" cy="' + (cy - r*0.2) + '" r="' + (r*0.85) + '" fill="#0a0a12"/>';
        return o;
      }
      var sunC   = '#F59E0B';  // amber
      var cloudC = '#94A3B8';  // slate-400
      var rainC  = '#3B82F6';  // blue-500
      var snowC  = '#93C5FD';  // blue-300
      var stormC = '#6366F1';  // indigo-500
      var fogC   = '#A8A29E';  // stone-400

      // Compose based on WMO code group
      var group = code;
      if (group === 0) {
        // Clear
        if (isDay) { s += sun(28, 26, 11, sunC); }
        else { s += moon(30, 28, 10, '#E2E8F0'); }
      } else if (group === 1) {
        // Mostly clear
        if (isDay) { s += sun(22, 24, 9, sunC); }
        else { s += moon(24, 26, 8, '#E2E8F0'); }
        s += cloud(42, 34, cloudC);
      } else if (group === 2) {
        // Partly cloudy
        if (isDay) { s += sun(16, 20, 8, sunC); }
        else { s += moon(18, 22, 7, '#E2E8F0'); }
        s += cloud(36, 36, cloudC);
      } else if (group === 3) {
        // Overcast: cloud(s)
        s += cloud(32, 34, '#9CA3AF');
        s += cloud(20, 40, '#B0B7C3');
      } else if (group >= 45 && group <= 48) {
        // Fog
        s += fogLines(32, 20, fogC);
      } else if (group >= 51 && group <= 57) {
        // Drizzle
        s += cloud(32, 26, cloudC);
        s += raindrops(32, 38, rainC);
      } else if (group >= 61 && group <= 67) {
        // Rain
        s += cloud(32, 24, '#7C8BA0');
        s += raindrops(32, 38, rainC);
      } else if (group >= 71 && group <= 77) {
        // Snow
        s += cloud(32, 24, cloudC);
        s += snowflakes(32, 38, snowC);
      } else if (group >= 80 && group <= 82) {
        // Rain showers (heavier)
        s += cloud(32, 22, '#64748B');
        s += raindrops(32, 36, rainC);
      } else if (group >= 85 && group <= 86) {
        // Snow showers
        s += cloud(32, 22, '#64748B');
        s += snowflakes(32, 36, snowC);
      } else if (group >= 95 && group <= 99) {
        // Thunderstorm
        s += cloud(32, 20, '#4B5563');
        s += bolt(30, 30, stormC);
        s += raindrops(32, 42, rainC);
      } else {
        // Fallback: generic cloud
        s += cloud(32, 34, cloudC);
      }

      s += '</svg>';
      return s;
    }

    function conditionText(code) {
      var map = {
        0:'Clear', 1:'Mostly Clear', 2:'Partly Cloudy', 3:'Overcast',
        45:'Fog', 48:'Rime Fog',
        51:'Light Drizzle', 53:'Drizzle', 55:'Heavy Drizzle',
        56:'Freezing Drizzle', 57:'Heavy Freezing Drizzle',
        61:'Light Rain', 63:'Rain', 65:'Heavy Rain',
        66:'Freezing Rain', 67:'Heavy Freezing Rain',
        71:'Light Snow', 73:'Snow', 75:'Heavy Snow',
        77:'Snow Grains',
        80:'Light Showers', 81:'Showers', 82:'Heavy Showers',
        85:'Light Snow Showers', 86:'Snow Showers',
        95:'Thunderstorm', 96:'T-storm w/ Hail', 99:'Severe T-storm'
      };
      return map[code] || 'Unknown';
    }

    // ── Temp unit helpers (global for all modules)
    // API returns Celsius; convert to Fahrenheit if user prefers °F
    window._toTemp = function(c) {
      var raw = localStorage.getItem('align.settings.tempUnit');
      var u = (function() { try { return raw ? JSON.parse(raw) : 'F'; } catch(e) { return raw || 'F'; } })();
      return u === 'F' ? Math.round(c * 9 / 5 + 32) : Math.round(c);
    };
    window._tempUnit = function() { return '°'; };
    function getTempUnitRaw() {
      try { var r = localStorage.getItem('align.settings.tempUnit'); return r ? JSON.parse(r) : 'F'; } catch(e) { return 'F'; }
    }

    // Re-render weather cards from raw data (called on unit change)
    window._renderWeatherCards = function(data) {
      if (!data || !data.daily) return;
      var daily = data.daily;
      var weatherRow = document.getElementById('weather-row');
      if (!weatherRow) return;
      var dashCity = document.getElementById('dash-city');
      if (dashCity && data.city) dashCity.textContent = data.city;
      var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var html = '';
      for (var i = 0; i < Math.min(daily.length, 7); i++) {
        var dayData = daily[i];
        var d = new Date(dayData.date + 'T12:00');
        var label = i === 0 ? 'Today' : dayNames[d.getDay()];
        var hi = window._toTemp(dayData.tempMax);
        var lo = window._toTemp(dayData.tempMin);
        // Today card: use current hourly condition, not daily average
        var cardCode = dayData.code;
        var isDay = true;
        if (i === 0 && data.hourly && data.hourly.length > 0) {
          cardCode = data.hourly[0].code != null ? data.hourly[0].code : dayData.code;
          isDay = data.hourly[0].isDay !== false;
        }
        html += '<button class="weather-card' + (i === 0 ? ' today' : '') + '" data-day-idx="' + i + '" type="button">' +
          '<span class="wc-icon">' + weatherIconSVG(cardCode != null ? cardCode : weatherCodeFromText(dayData.shortForecast || ''), isDay, 28) + '</span>' +
          '<div class="wc-body">' +
            '<span class="wc-label">' + label + '</span>' +
            '<span class="wc-temp">' + hi + '°</span>' +
            '<span class="wc-hilo"><b>' + hi + '°</b><i>' + lo + '°</i></span>' +
            '<span class="wc-condition">' + conditionText(cardCode != null ? cardCode : weatherCodeFromText(dayData.shortForecast || '')) + '</span>' +
          '</div>' +
        '</button>';
      }
      weatherRow.innerHTML = html;
      try { localStorage.setItem('align_weather_html_v2', JSON.stringify({html: html, date: new Date().toDateString(), unit: getTempUnitRaw()})); } catch(e) {}
    };

    // ── 3. FETCH WEATHER ─────────────────────────────────────────────────

    function fetchWeather(lat, lon, cityName) {
      // Use our server's weather proxy
      var url = '/api/weather?lat=' + lat + '&lon=' + lon + '&_=' + Date.now();

      fetch(url).then(function(r) { return r.json(); }).then(function(data) {
        if (!data.ok || !data.daily) throw new Error('No data');
        // Save raw data so we can re-render on unit change without re-fetching
        window.__weatherData = data;
        window._renderWeatherCards(data);
        // Hourly panel now handled by _showHourlyPanel() at init
      }).catch(function(err) {
        console.error('[Weather] Proxy failed:', err.message || err);
        weatherRow.innerHTML = '<div class="weather-empty">⚠️ Could not load weather. <button data-dash-act="retry">Retry</button></div>';
      });
    }

    // Map forecast text to approximate WMO weather code for SVG icons
    function weatherEmoji(text) {
      var t = (text || '').toLowerCase();
      if (t.indexOf('sun') > -1 || t.indexOf('clear') > -1 || t.indexOf('fair') > -1) return '☀️';
      if (t.indexOf('partly') > -1 || t.indexOf('mostly') > -1) return '⛅';
      if (t.indexOf('cloud') > -1 || t.indexOf('overcast') > -1) return '☁️';
      if (t.indexOf('rain') > -1 || t.indexOf('shower') > -1 || t.indexOf('drizzle') > -1) return '🌧️';
      if (t.indexOf('snow') > -1 || t.indexOf('flurr') > -1) return '🌨️';
      if (t.indexOf('fog') > -1 || t.indexOf('haze') > -1) return '🌫️';
      if (t.indexOf('storm') > -1 || t.indexOf('thunder') > -1) return '⛈️';
      if (t.indexOf('wind') > -1) return '💨';
      return '🌤️';
    }

    // kept for backward compat
    function weatherCodeFromText(text) {
      var t = (text || '').toLowerCase();
      var chance = t.indexOf('chance') > -1 || t.indexOf('slight') > -1 || t.indexOf('isolated') > -1 || t.indexOf('scattered') > -1;
      var likely = t.indexOf('likely') > -1;

      // Clear/sunny/fair dominates — check FIRST
      if (t.indexOf('sun') > -1 || t.indexOf('clear') > -1 || t.indexOf('fair') > -1) return 0;
      // Partly cloudy
      if (t.indexOf('partly') > -1 || t.indexOf('mostly') > -1) return 2;
      // Cloudy/overcast
      if (t.indexOf('cloud') > -1 || t.indexOf('overcast') > -1) return 3;

      // Precipitation: only show the icon if "likely" (no prob data client-side)
      if (t.indexOf('thunderstorm') > -1 || t.indexOf('storm') > -1) return likely ? 95 : 2;
      if (t.indexOf('snow') > -1 || t.indexOf('flurr') > -1 || t.indexOf('wintry') > -1) return likely ? 71 : 2;
      if (t.indexOf('rain') > -1 || t.indexOf('shower') > -1 || t.indexOf('drizzle') > -1) return likely ? 61 : 2;

      if (t.indexOf('fog') > -1 || t.indexOf('haze') > -1 || t.indexOf('mist') > -1) return 45;
      if (t.indexOf('wind') > -1) return 50;
      return 2;
    }

    function _renderHourly(hours, dayIdx, daily, panel, card) {
      if (!hours || !hours.length) return;

      var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var dateObj = new Date(daily[dayIdx].date + 'T12:00');
      var label = dayIdx === 0 ? 'Today' : dayNames[dateObj.getDay()];

      // Mark active card
      document.querySelectorAll('.weather-card').forEach(function(c) { c.classList.remove('active'); });
      card.classList.add('active');

      var h = [];
      h.push('<div class="wh-arrow"></div>');
      h.push('<div class="wh-header">' + label + ' — Hourly Breakdown</div>');
      h.push('<div class="wh-scroll">');

      hours.forEach(function(hr) {
        var t = new Date(hr.time);
        var hourLabel = t.toLocaleTimeString([], {hour:'numeric', hour12:true});
        var now = new Date();
        var isNow = t.getDate() === now.getDate() && t.getHours() === now.getHours();

        h.push('<div class="wh-card' + (isNow ? ' wh-now' : '') + '">');
        h.push('<div class="wh-time">' + hourLabel + '</div>');
        h.push('<div class="wh-icon">' + weatherIconSVG(hr.code != null ? hr.code : weatherCodeFromText(hr.shortForecast || ''), (t.getHours() >= 6 && t.getHours() < 20), 28) + '</div>');
        h.push('<div class="wh-temp">' + hr.temp + '°</div>');
        if (hr.precip > 0) {
          h.push('<div class="wh-precip">' + hr.precip + '%</div>');
        }
        h.push('<div class="wh-cond">' + conditionText(hr.code != null ? hr.code : weatherCodeFromText(hr.shortForecast || '')) + '</div>');
        h.push('</div>');
      });

      h.push('</div>'); // .wh-scroll

      // Arrow offset: center over the clicked card (set via JS, not inline style)
      var cardRect = card.getBoundingClientRect();
      var rowRect = weatherRow.getBoundingClientRect();
      var arrowLeft = Math.round((cardRect.left + cardRect.width/2) - rowRect.left - 10);

      panel.innerHTML = h.join('');
      panel.style.display = 'block';
      panel.classList.add('wh-visible');

      // Position the arrow dynamically
      var arrow = panel.querySelector('.wh-arrow');
      if (arrow) arrow.style.marginLeft = arrowLeft + 'px';

      // Animate arrow
      requestAnimationFrame(function() {
        panel.style.opacity = '1';
      });

      // Active state for weather card
      card.style.position = 'relative';
    }

    function reverseGeocode(lat, lon) {
      // Use Open-Meteo's built-in timezone to guess city, or Nominatim
      var url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat +
                '&lon=' + lon + '&zoom=10&addressdetails=1';
      return fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var addr = data.address || {};
          return addr.city || addr.town || addr.village || addr.county || addr.state || '';
        })
        .catch(function () { return ''; });
    }

    function loadWeather(lat, lon) {
      // Cache coordinates so daily log doesn't need to re-prompt
      window.__dashLat = lat;
      window.__dashLon = lon;
      try {
        localStorage.setItem('align_location_lat', lat);
        localStorage.setItem('align_location_lon', lon);
      } catch (e) { /* storage full — non-critical */ }

      reverseGeocode(lat, lon).then(function (city) {
        fetchWeather(lat, lon, city);
      });
    }

    // ── 4. GET LOCATION ──────────────────────────────────────────────────

    function getLocation(forceRefresh) {
      // ── 1. Check localStorage cache first ──
      var cachedLat = null, cachedLon = null;
      try {
        cachedLat = localStorage.getItem('align_location_lat');
        cachedLon = localStorage.getItem('align_location_lon');
      } catch (e) { /* ignore */ }

      // If we have a cache AND the caller didn't explicitly force a refresh,
      // use the cached coords with zero geolocation API calls (no prompt, ever)
      if (!forceRefresh && cachedLat != null && cachedLon != null) {
        loadWeather(parseFloat(cachedLat), parseFloat(cachedLon));
        return;
      }

      // ── 2. No cache OR user explicitly requested refresh — do live lookup ──
      if (dashLoc) dashLoc.classList.add('loading');

      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            if (dashLoc) dashLoc.classList.remove('loading');
            loadWeather(pos.coords.latitude, pos.coords.longitude);
          },
          function () {
            if (dashLoc) dashLoc.classList.remove('loading');
            // If we already had a cached location, keep using it on failure
            if (cachedLat != null && cachedLon != null) {
              loadWeather(parseFloat(cachedLat), parseFloat(cachedLon));
            } else {
              fallbackIPLocation();
            }
          },
          { timeout: 8000, maximumAge: 30 * 60 * 1000 }
        );
      } else {
        if (dashLoc) dashLoc.classList.remove('loading');
        if (cachedLat != null && cachedLon != null) {
          loadWeather(parseFloat(cachedLat), parseFloat(cachedLon));
        } else {
          fallbackIPLocation();
        }
      }
    }

    function fallbackIPLocation() {
      fetch('https://ipapi.co/json/')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.latitude && data.longitude) {
            loadWeather(data.latitude, data.longitude);
            if (dashCity) dashCity.textContent = data.city || data.region || '';
          } else {
            // Default: New York City
            loadWeather(40.7128, -74.006);
            if (dashCity) dashCity.textContent = 'New York';
          }
        })
        .catch(function () {
          // Ultimate fallback
          loadWeather(40.7128, -74.006);
          if (dashCity) dashCity.textContent = 'New York';
        });
    }

    // Click location badge to refresh (force fresh geolocation lookup)
    if (dashLoc) {
      dashLoc.addEventListener('click', function () {
        getLocation(true);
      });
    }

    // Expose refresh for the retry button (forces fresh geolocation lookup)
    window.__dashRefresh = function () { getLocation(true); };

    // ── 5. START ─────────────────────────────────────────────────────────
    // Stale-while-revalidate: render cached weather instantly if same-day
    try {
      var _cachedWx = JSON.parse(localStorage.getItem('align_weather_html_v2'));
      if (_cachedWx && _cachedWx.date === new Date().toDateString() && _cachedWx.unit === getTempUnitRaw() && weatherRow && weatherRow.childElementCount === 0) {
        weatherRow.innerHTML = _cachedWx.html;
      }
    } catch(e) {}
    getLocation();

    // ── Shared hourly panel renderer (used by click handler below)
    function _showHourlyPanel(idx, data, panel) {
      var selDate = data.daily[idx].date;
      var dayHours = data.hourly.filter(function(h) {
        return h.time.slice(0, 10) === selDate;
      }).sort(function(a, b) {
        return new Date(a.time) - new Date(b.time);
      });
      var now = new Date();
      var isToday = (selDate === now.toISOString().slice(0, 10));
      var html = '<div class="wh-header">' + selDate + ' — Hourly</div><div class="wh-scroll">';
      if (dayHours.length > 0) {
        var dayInfo = data.daily[idx];
        var srTime = dayInfo.sunrise ? new Date(dayInfo.sunrise) : null;
        var ssTime = dayInfo.sunset  ? new Date(dayInfo.sunset)  : null;
        var cards = [];
        dayHours.forEach(function(h) {
          var t = new Date(h.time);
          var hr = t.getHours();
          cards.push({ type: 'hour', hourData: h, time: t, hr: hr });
          var nextHr = new Date(t.getTime() + 3600000);
          // Sunrise/sunset AFTER this hour card if it falls between this hour and next
          if (srTime && srTime >= t && srTime < nextHr) {
            cards.push({ type: 'sunrise', time: srTime, label: 'Sunrise' });
          }
          if (ssTime && ssTime >= t && ssTime < nextHr) {
            cards.push({ type: 'sunset', time: ssTime, label: 'Sunset' });
          }
        });
        cards.forEach(function(c) {
          if (c.type === 'sunrise' || c.type === 'sunset') {
            var isSunrise = c.type === 'sunrise';
            var timeLabel = c.time.toLocaleTimeString([], {hour:'numeric', minute:'2-digit', hour12:true});
            var cssClass = 'wh-card-sun wh-card-sun--' + c.type;
            var uid = c.type + '-' + selDate + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
            html += '<div class="' + cssClass + '"><svg width="72" height="100" viewBox="0 0 72 100" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<defs><linearGradient id="sun-sky-' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
              (isSunrise ? '<stop offset="0%" stop-color="#0c0a20"/><stop offset="35%" stop-color="#4c1d95"/><stop offset="65%" stop-color="#d97706"/><stop offset="100%" stop-color="#fbbf24"/>' : '<stop offset="0%" stop-color="#fbbf24"/><stop offset="20%" stop-color="#ea580c"/><stop offset="50%" stop-color="#7c2d12"/><stop offset="100%" stop-color="#0c0a20"/>') +
              '</linearGradient><radialGradient id="sun-halo-' + uid + '" cx="50%" cy="65%" r="30%">' +
              '<stop offset="0%" stop-color="' + (isSunrise ? '#f59e0b' : '#ea580c') + '" stop-opacity="0.9"/>' +
              '<stop offset="100%" stop-color="' + (isSunrise ? '#f59e0b' : '#ea580c') + '" stop-opacity="0"/>' +
              '</radialGradient></defs>' +
              '<rect x="0" y="0" width="72" height="100" rx="10" fill="url(#sun-sky-' + uid + ')"/>' +
              '<circle cx="36" cy="62" r="28" fill="url(#sun-halo-' + uid + ')"/>' +
              '<rect x="0" y="72" width="72" height="28" fill="#17120d"/>' +
              '<line x1="0" y1="72" x2="72" y2="72" stroke="#292524" stroke-width="1" opacity="0.6"/>' +
              '<circle cx="36" cy="64" r="10" fill="#fef3c7"/>' +
              '<circle cx="36" cy="64" r="15" fill="#fbbf24" opacity="0.25"/>' +
              '<circle cx="36" cy="64" r="22" fill="#f59e0b" opacity="0.1"/>' +
              '<text x="36" y="90" text-anchor="middle" fill="#fff" font-size="12" font-weight="700" font-family="inherit">' + timeLabel + '</text>' +
              '<text x="36" y="96" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-size="8" font-weight="500" font-family="inherit">' + c.label.toUpperCase() + '</text>' +
              '</svg></div>';
          } else {
            var h = c.hourData;
            var isNow = isToday && c.hr === now.getHours();
            var isDaytime = h.isDay !== false;
            var hrIcon = weatherIconSVG(h.code != null ? h.code : weatherCodeFromText(h.shortForecast || ''), isDaytime, 22);
            html += '<div class="wh-card' + (isNow ? ' wh-now' : '') + '">' +
              '<div class="wh-time">' + c.time.toLocaleTimeString([], {hour:'numeric', hour12:true}) + '</div>' +
              '<div class="wh-icon">' + hrIcon + '</div>' +
              '<div class="wh-temp">' + window._toTemp(h.temp) + '°</div>' +
              (h.precip > 0 ? '<div class="wh-precip">' + h.precip + '%</div>' : '') +
              '<div class="wh-cond">' + conditionText(h.code != null ? h.code : weatherCodeFromText(h.shortForecast || '')) + '</div></div>';
          }
        });
      } else {
        var dInfo = data.daily[idx];
        html += '<div class="wh-day-summary"><div class="wh-sum-icon">' + weatherIconSVG(dInfo.code != null ? dInfo.code : weatherCodeFromText(dInfo.shortForecast || ''), true, 36) + '</div>' +
          '<div class="wh-sum-temps"><b>' + window._toTemp(dInfo.tempMax) + '°</b> / ' + window._toTemp(dInfo.tempMin) + '°</div>' +
          '<div class="wh-sum-cond">' + (dInfo.shortForecast || '') + '</div></div>';
      }
      html += '</div>';
      panel.innerHTML = html;
      panel.style.display = 'block';
      panel.style.opacity = '1';
    }

    // Weather card click handler — attached once, works immediately on cached cards
    weatherRow.addEventListener('click', function(e) {
      var retryBtn = e.target.closest('[data-dash-act="retry"]');
      if (retryBtn) { if (window.__dashRefresh) window.__dashRefresh(); return; }
      var card = e.target.closest('.weather-card');
      if (!card) return;
      var idx = parseInt(card.getAttribute('data-day-idx'));
      if (isNaN(idx)) return;
      var data = window.__weatherData;
      if (!data || !data.daily || !data.hourly) return;

      var wasActive = card.classList.contains('active');
      weatherRow.querySelectorAll('.weather-card').forEach(function(c){c.classList.remove('active');});
      var hourlyPanel = document.getElementById('weather-hourly');
      if (wasActive) {
        if (hourlyPanel) { hourlyPanel.style.display = 'none'; hourlyPanel.classList.remove('wh-visible'); hourlyPanel.style.opacity = '0'; }
        return;
      }
      card.classList.add('active');
      if (hourlyPanel) _showHourlyPanel(idx, data, hourlyPanel);
    });
  })();

  /* ═══════════════════════════════════════════════════════════════════════
     ESSENTIALS DASHBOARD — at-a-glance project cards (FULLY CUSTOMIZABLE)
     ═══════════════════════════════════════════════════════════════════════ */

  (function () {
    var grid = document.getElementById('essentials-grid');
    if (!grid) return;

    // Delegated click handler for ess-card links (replaces inline onclick)
    grid.addEventListener('click', function(e) {
      var card = e.target.closest('.ess-card');
      if (!card) return;
      var link = card.getAttribute('data-link');
      if (link) window._essCardClick(link);
    });

    // ── Card SVG icons — defined inline since global may not exist yet
    window.SECTION_ICONS = window.SECTION_ICONS || {
      manpower:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      tasks:      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
      rfi:        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      punchlist:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="9 12 11 14 15 10"/></svg>',
      schedule:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      budget:     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      photos:     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
    };
    var icons = window.SECTION_ICONS;

    // ── Color per card type ──────────────────────────────────────────────
    var colors = {
      manpower:   '#3B82F6',
      tasks:      '#8B5CF6',
      rfi:        '#F59E0B',
      punchlist:  '#10B981',
      schedule:   '#06B6D4',
      budget:     '#EC4899',
      photos:     '#F97316',

    };

    // ── ALL available card definitions ───────────────────────────────────
    // Each: { id, label, desc, compute(pid, dataCache) → { value, sub } }
    // compute receives the pre-fetched data cache so we don't re-fetch

    var allCardDefs = [
      {
        id: 'manpower', label: 'Manpower', desc: 'Workers on site today from the daily log', link: 'daily-logs',
        compute: function (pid, cache) {
          var dailyAll = cache['daily-logs'] || [];
          var manpower = 0;
          var manpowerSub = 'no logs yet';
          if (dailyAll.length > 0) {
            var now2 = new Date();
            var todayStr = now2.getFullYear() + '-' + String(now2.getMonth() + 1).padStart(2, '0') + '-' + String(now2.getDate()).padStart(2, '0');
            // Get all revisions for today, use the latest
            var todayLogs = [];
            for (var i = 0; i < dailyAll.length; i++) {
              if (String(dailyAll[i].date || '').slice(0, 10) === todayStr) todayLogs.push(dailyAll[i]);
            }
            todayLogs.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
            var todayLog = todayLogs[0];
            if (todayLog) {
              var comps = todayLog.companies || [];
              if (comps.length === 0 && todayLog.workforce) {
                manpower = parseInt(todayLog.workforce, 10) || 0;
                manpowerSub = 'workers on site';
              } else {
                var total = 0;
                comps.forEach(function (c) { total += parseInt(c.count, 10) || 0; });
                manpower = total;
                if (comps.length === 1) {
                  manpowerSub = comps[0].name || '1 company on site';
                } else if (comps.length > 1) {
                  var names = comps.map(function (c) { return (c.name || '?') + ': ' + (parseInt(c.count, 10) || 0); });
                  manpowerSub = names.join(', ');
                } else {
                  manpowerSub = 'workers on site';
                }
              }
            }
          }
          return { value: manpower, sub: manpowerSub };
        }
      },
      {
        id: 'tasks', label: 'Tasks', desc: 'Active (not done/closed) tasks',
        compute: function (pid, cache) {
          var tasksAll = cache['tasks'] || [];
          var activeTasks = 0;
          tasksAll.forEach(function (t) { if (t.status !== 'done' && t.status !== 'closed') activeTasks++; });
          return { value: activeTasks, sub: 'active tasks' };
        }
      },
      {
        id: 'rfi', label: 'RFIs', desc: 'Open (not closed/resolved) RFIs',
        compute: function (pid, cache) {
          var rfiAll = cache['rfis'] || [];
          var openRFIs = 0;
          rfiAll.forEach(function (r) { if (r.status !== 'closed' && r.status !== 'resolved') openRFIs++; });
          return { value: openRFIs, sub: 'open RFIs' };
        }
      },
      {
        id: 'punchlist', label: 'Punchlist', desc: 'Open (not done/closed) punch items', link: 'punchlist',
        compute: function (pid, cache) {
          var punchAll = cache['punchlist'] || [];
          var openPunch = 0;
          punchAll.forEach(function (p) { if (p.status !== 'done' && p.status !== 'closed') openPunch++; });
          return { value: openPunch, sub: 'items open' };
        }
      },
      {
        id: 'schedule', label: 'Schedule', desc: 'Upcoming milestones this week',
        compute: function (pid, cache) {
          var sched = cache['schedule'] || [];
          if (sched.length === 0) return { value: '—', sub: 'no milestones set' };
          var upcoming = 0;
          var today = new Date();
          var weekEnd = new Date(today);
          weekEnd.setDate(weekEnd.getDate() + 7);
          sched.forEach(function (s) {
            if (s.date && new Date(s.date) >= today && new Date(s.date) <= weekEnd) upcoming++;
          });
          if (upcoming === 0) return { value: '0', sub: 'this week' };
          return { value: upcoming, sub: upcoming === 1 ? 'this week' : 'this week' };
        }
      },
      {
        id: 'budget', label: 'Budget', desc: 'Budget summary from budget records',
        compute: function (pid, cache) {
          var budgetAll = cache['budget'] || [];
          if (budgetAll.length === 0) return { value: '—', sub: 'no budget set' };
          var totalBudget = 0, totalSpent = 0;
          budgetAll.forEach(function (b) {
            totalBudget += (b.amount || b.budget || 0);
            totalSpent += (b.spent || b.actual || 0);
          });
          if (totalBudget === 0) return { value: '—', sub: 'no budget set' };
          var remaining = totalBudget - totalSpent;
          return { value: '$' + remaining.toLocaleString(), sub: 'remaining of $' + totalBudget.toLocaleString() };
        }
      },
      {
        id: 'photos', label: 'Photos', desc: 'Total photos in the project',
        compute: function (pid, cache) {
          var photos = cache['photos'] || [];
          return { value: photos.length, sub: photos.length === 1 ? 'photo' : 'photos' };
        }
      },
    ];

    // ── Config storage (per project) ─────────────────────────────────────
    var CONFIG_PREFIX = 'align_essentials_';

    function loadConfig(pid) {
      try {
        var raw = localStorage.getItem(CONFIG_PREFIX + pid);
        if (raw) {
          var ids = JSON.parse(raw);
          if (Array.isArray(ids)) return ids;
        }
      } catch (e) { /* ignore */ }
      // Default: the original six
      return ['manpower', 'tasks', 'rfi', 'punchlist', 'schedule', 'budget'];
    }

    function saveConfig(pid, ids) {
      try {
        localStorage.setItem(CONFIG_PREFIX + pid, JSON.stringify(ids));
      } catch (e) { /* ignore */ }
    }

    // Build a lookup for card defs by id
    var cardDefMap = {};
    allCardDefs.forEach(function (d) { cardDefMap[d.id] = d; });

    // ── resolveMaybePromise ──────────────────────────────────────────────
    function _r(v, fb) { return (v && typeof v.then === 'function') ? v : Promise.resolve(v || fb); }

    // Fetch categories needed by remaining card defs
    var FETCH_CATEGORIES = ['tasks', 'rfis', 'punchlist', 'daily-logs', 'schedule', 'budget', 'photos'];

    // Global click handler for linked essentials cards
    window._essCardClick = function (sectionKey) {
      location.hash = '#' + sectionKey;
    };

    function renderCards(active) {
      if (!active || !active.id) {
        grid.innerHTML = '<div class="essentials-empty">Select a project to see your essentials</div>';
        return;
      }

      var pid = active.id;
      var config = loadConfig(pid);

      // Build fetch promises for all categories we might need
      var fetches = {};
      FETCH_CATEGORIES.forEach(function (cat) {
        if (cat === 'daily-logs') {
          // Fetch from server API (disk-persistent)
          var token = localStorage.getItem('align-token') || '';
          fetches[cat] = fetch('/api/projects/' + encodeURIComponent(pid) + '/daily-logs', {
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
          }).then(function(r) { return r.ok ? r.json() : []; })
            .then(function(data) { return (data.records || []).map(function(r) { return r.data || r; }); })
            .catch(function() { return []; });
        } else {
          fetches[cat] = _r(window.AlignStorage.listRecords(pid, cat), []);
        }
      });

      // Resolve all
      var keys = Object.keys(fetches);
      Promise.all(keys.map(function (k) { return fetches[k]; })).then(function (results) {
        var cache = {};
        keys.forEach(function (k, i) { cache[k] = results[i]; });

        var cards = [];
        config.forEach(function (cid) {
          var def = cardDefMap[cid];
          if (!def) return;
          var result = def.compute(pid, cache);
          cards.push({
            id: cid,
            label: def.label,
            value: result.value,
            sub: result.sub,
            link: def.link || null
          });
        });

        var html = '';
        cards.forEach(function (c) {
          var col = colors[c.id] || '#6B7280';
          var linkAttr = c.link ? ' data-link="' + c.link + '" style="cursor:pointer"' : '';
          html += '<div class="ess-card"' + linkAttr + '>' +
            '<div class="ess-card-icon" style="color:' + col + ';background:' + col + '15;">' + (icons[c.id] || '') + '</div>' +
            '<div class="ess-card-value">' + c.value + '</div>' +
            '<div class="ess-card-label">' + c.label + '</div>' +
          '</div>';
        });

        if (cards.length === 0) {
          html = '<div class="essentials-empty">No cards selected — click <strong>Customize</strong> to add some</div>';
        }

        grid.innerHTML = html;
      });
    }

    function refresh() {
      var active = window.AlignStorage && window.AlignStorage.getActiveProject();
      if (active && typeof active.then === 'function') {
        active.then(renderCards);
      } else {
        renderCards(active);
      }
    }

    // ── Customize button → open config modal ────────────────────────────
    var customizeBtn = document.getElementById('ess-customize-btn');
    if (customizeBtn) {
      customizeBtn.addEventListener('click', function () {
        var active = window.AlignStorage && window.AlignStorage.getActiveProject();
        if (active && typeof active.then === 'function') {
          active.then(openConfigModal);
        } else {
          openConfigModal(active);
        }
      });
    }

    function openConfigModal(active) {
      if (!active || !active.id) {
        alert('Select a project first to customize your essentials.');
        return;
      }

      var pid = active.id;
      var config = loadConfig(pid);

      // Build the config panel HTML
      var cardOrder = config.slice(); // working copy

      function renderConfigGrid() {
        var html = '<div class="ess-config-grid" id="ess-config-grid">';
        cardOrder.forEach(function (cid, idx) {
          var def = cardDefMap[cid];
          if (!def) return;
          var col = colors[cid] || '#6B7280';
          html += '<div class="ess-card ess-config-card on" data-card-id="' + cid + '" draggable="true" style="cursor:grab;position:relative;">' +
            '<div class="ess-card-icon" style="color:' + col + ';background:' + col + '15;">' + (icons[cid] || '') + '</div>' +
            '<div class="ess-card-value" style="font-size:14px;font-weight:700;">' + def.label + '</div>' +
            '<div class="ess-config-toggle" title="Remove" style="position:absolute;top:4px;right:6px;font-size:14px;color:var(--muted);cursor:pointer;">✕</div>' +
          '</div>';
        });
        html += '</div>';

        // Add available (not yet selected) cards
        var selectedSet = {};
        cardOrder.forEach(function (c) { selectedSet[c] = true; });
        var available = allCardDefs.filter(function (d) { return !selectedSet[d.id]; });

        if (available.length > 0) {
          html += '<p style="font-size:0.75rem;font-weight:700;color:var(--muted);margin:20px 0 8px;text-transform:uppercase;letter-spacing:0.5px;">Available — tap to add</p>';
          html += '<div class="ess-config-grid" id="ess-config-available">';
          available.forEach(function (d) {
            var col = colors[d.id] || '#6B7280';
            html += '<div class="ess-card ess-config-card" data-card-id="' + d.id + '" style="cursor:pointer;opacity:0.6;">' +
              '<div class="ess-card-icon" style="color:' + col + ';background:' + col + '15;">' + (icons[d.id] || '') + '</div>' +
              '<div class="ess-card-value" style="font-size:14px;font-weight:700;">' + d.label + '</div>' +
              '<div class="ess-config-toggle" style="color:var(--brand);font-weight:700;font-size:18px;">+</div>' +
            '</div>';
          });
          html += '</div>';
        }

        return html;
      }

      // Inject a Save button into the section header (top-right)
      var headerSave = document.createElement('button');
      headerSave.id = 'ess-config-header-save';
      headerSave.className = 'pm-btn primary';
      headerSave.textContent = 'Save & Close';
      headerSave.style.cssText = 'margin-left:auto;font-size:0.8rem;padding:5px 14px;';
      sectionTitle.textContent = 'Customize';
      sectionTitle.parentNode.appendChild(headerSave);

      sectionBody.innerHTML = renderConfigGrid() +
        '<div class="ess-config-actions">' +
          '<button class="pm-btn" id="ess-config-reset">Reset to defaults</button>' +
        '</div>';

      _currentSection = 'essentials-config';
      _openSection();

      // ── Bind events (delegated on body so they survive innerHTML rewrites) ──

      function handleConfigCardClick(e) {
        // Remove from active grid?
        var activeCard = e.target.closest('#ess-config-grid .ess-config-card');
        if (activeCard && !e.target.closest('.ess-config-handle')) {
          var cid = activeCard.getAttribute('data-card-id');
          cardOrder = cardOrder.filter(function (c) { return c !== cid; });
          rerender();
          return;
        }

        // Add from available grid?
        var availCard = e.target.closest('#ess-config-available .ess-config-card');
        if (availCard) {
          var cid = availCard.getAttribute('data-card-id');
          if (cardOrder.indexOf(cid) === -1) cardOrder.push(cid);
          rerender();
          return;
        }
      }

      sectionBody.addEventListener('click', handleConfigCardClick);

      var _saved = false;

      function rerender() {
        sectionBody.innerHTML = renderConfigGrid() +
          '<div class="ess-config-actions">' +
            '<button class="pm-btn" id="ess-config-reset">Reset to defaults</button>' +
          '</div>';
        rebindConfigButtons();
        rebindDragDrop();
      }

      // Header Save button
      headerSave.addEventListener('click', function () {
        if (_saved) return;
        saveConfig(pid, cardOrder);
        _saved = true;
        headerSave.textContent = 'Saved';
        headerSave.className = 'pm-btn';
        headerSave.style.background = 'var(--card)';
        headerSave.style.color = 'var(--muted)';
        headerSave.style.borderColor = 'var(--line)';
        refresh();
        _closeSection();
      });

      function rebindConfigButtons() {
        var resetBtn = document.getElementById('ess-config-reset');
        if (resetBtn) {
          resetBtn.addEventListener('click', function () {
            var defaults = ['manpower', 'tasks', 'rfi', 'punchlist', 'schedule', 'budget'];
            cardOrder = defaults.slice();
            rerender();
          });
        }
      }
      function rebindDragDrop() {
        var cards = document.querySelectorAll('#ess-config-grid .ess-config-card');
        var draggedEl = null;
        var draggedIdx = -1;

        cards.forEach(function (card, idx) {
          card.addEventListener('dragstart', function (e) {
            draggedEl = card;
            draggedIdx = idx;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.getAttribute('data-card-id'));
          });

          card.addEventListener('dragend', function (e) {
            card.classList.remove('dragging');
            // Remove all drag-over indicators
            document.querySelectorAll('#ess-config-grid .ess-config-card').forEach(function(c) { c.classList.remove('drag-over'); });
          });

          card.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
          });

          card.addEventListener('dragleave', function (e) {
            card.classList.remove('drag-over');
          });

          card.addEventListener('drop', function (e) {
            e.preventDefault();
            card.classList.remove('drag-over');
            if (draggedEl && draggedEl !== card) {
              var from = parseInt(draggedEl.getAttribute('data-card-idx'));
              var to = parseInt(card.getAttribute('data-card-idx'));
              if (!isNaN(from) && !isNaN(to)) {
                var moved = cardOrder.splice(from, 1)[0];
                cardOrder.splice(to, 0, moved);
                rerender();
              }
            }
            draggedEl = null;
            draggedIdx = -1;
          });
        });
      }

      rebindDragDrop();
      rebindConfigButtons();
    }

    // ── EXPOSE refresh so modules can update Essentials ──
    window._refreshEssentials = refresh;

    // Initial render
    refresh();

  })(); // end weather + essentials IIFE

  }); // end bootPromise.then

})(); // end _initAuth IIFE

  function _esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var _psSeq = 0; // race guard — ignore stale fetch responses

  function _renderProjectSelect(el) {
    if (!el) return;
    var seq = ++_psSeq;
    el.innerHTML = '<div class="ps-loading">Loading projects…</div>';

    function showError(msg, canRetry) {
      if (seq !== _psSeq) return; // stale
      var h = '<div class="ps-error"><p>' + _esc(msg) + '</p>';
      if (canRetry) {
        h += '<button class="pm-btn small" id="ps-retry">Retry</button>';
      }
      h += '</div>';
      el.innerHTML = h;
      if (canRetry) {
        var btn = el.querySelector('#ps-retry');
        if (btn) btn.addEventListener('click', function() { _renderProjectSelect(el); });
      }
    }

    var isAdmin = window.AlignAuth && window.AlignAuth.isAdmin ? window.AlignAuth.isAdmin() : false;

    fetch('/api/projects', { credentials: 'include' })
      .then(function(r) {
        if (r.status === 401) {
          if (window.AlignAuth && window.AlignAuth.signOut) {
            window.AlignAuth.signOut();
          } else {
            showError('Session expired. Please sign in again.', false);
          }
          throw new Error('unauthorized');
        }
        if (!r.ok) throw new Error('Server error (' + r.status + ')');
        return r.json();
      })
      .then(function(d) {
        if (seq !== _psSeq) return; // stale
        var projs = d.projects || [];
        var h = '<div class="ps-page"><div class="ps-header"><div class="ps-logo-wrap"><img class="ps-logo auth-logo-light" src="assets/c3-wordmark-light.svg" alt="Align"><img class="ps-logo auth-logo-dark" src="assets/c3-wordmark-dark.svg" alt="Align"></div><h1 class="ps-title">Select Project</h1><div class="ps-header-actions">' + (isAdmin ? '<button class="pm-btn primary ps-new-btn" id="ps-new-project">+ New Project</button>' : '') + '<button class="ps-signout-btn" id="ps-signout">Sign Out</button></div></div>';

        if (!projs.length) {
          // #4: Differentiate empty state — admin can create, member can't
          if (isAdmin) {
            h += '<div class="ps-empty"><p>No projects yet.</p><button class="pm-btn" id="ps-create-first-btn" style="margin-top:12px">+ Create First Project</button></div>';
          } else {
            h += '<div class="ps-empty"><p>No projects assigned.</p><p class="ps-empty-hint">Ask an admin to add you to a project.</p></div>';
          }
        } else {
          h += '<div class="ps-grid" id="ps-grid">';
          for (var i = 0; i < projs.length; i++) {
            var p = projs[i];
            var pid = String(p.id);
            var initial = String(p.name || 'P').trim().charAt(0).toUpperCase() || 'P';
            h += '<div class="ps-card" data-pid="' + _esc(pid) + '">';
            h += '<div class="ps-card-img ps-card-img-empty">';
            h += '<span class="ps-card-initial">' + _esc(initial) + '</span>';
            if (p.image_file_id) {
              h += '<img class="ps-card-photo" src="/api/files/' + _esc(String(p.image_file_id)) + '" alt="">';
            }
            h += '</div>';
            h += '<div class="ps-card-body">';
            h += '<div class="ps-card-name">' + _esc(p.name) + '</div>';
            if (p.address) h += '<div class="ps-card-addr">' + _esc(p.address) + '</div>';
            h += '</div>';
            h += '<div class="ps-card-arrow">\u2192</div>';
            h += '</div>';
          }
          h += '</div>';
        }
        h += '</div>';
        el.innerHTML = h;

        // Keep the project initial visible when a stored project image is missing.
        el.querySelectorAll('.ps-card-photo').forEach(function(photo) {
          function removeBrokenPhoto() { photo.remove(); }
          photo.addEventListener('error', removeBrokenPhoto, { once: true });
          if (photo.complete && photo.naturalWidth === 0) removeBrokenPhoto();
        });

        // #6: Event delegation — single listener on grid, survives re-renders
        var grid = el.querySelector('#ps-grid');
        if (grid) {
          grid.addEventListener('click', function(e) {
            var card = e.target.closest('.ps-card');
            if (!card) return;
            var pid = card.getAttribute('data-pid');
            if (!pid) return;
            // Use switchProject to await full hydration before showing dashboard
            var switcher = window.AlignStorage.switchProject || window.AlignStorage.setActiveProject;
            var promise = switcher.call(window.AlignStorage, pid);
            if (promise && promise.then) {
              promise.then(function() {
                window._fetchMyPermissions(pid);
                _updateProjectName();
                if (window._refreshEssentials) window._refreshEssentials();
                _tileCache = {}; // <-- clear stale tile cache on project switch
                location.hash = '';
              });
            } else {
              window._fetchMyPermissions(pid);
              _updateProjectName();
              if (window._refreshEssentials) window._refreshEssentials();
              _tileCache = {}; // <-- clear stale tile cache on project switch
              location.hash = '';
            }
          });
        }

        var so = el.querySelector('#ps-signout');
        if (so) so.addEventListener('click', function() { if (window.AlignAuth) window.AlignAuth.signOut(); });

        var cf = el.querySelector('#ps-create-first-btn');
        if (cf) cf.addEventListener('click', function() {
          var name = prompt('Project name:');
          if (!name) return;
          fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
          }).then(function(r) {
            if (r.ok) { location.hash = '#project-select'; location.reload(); }
            else alert('Failed to create project.');
          });
        });

        var np = el.querySelector('#ps-new-project');
        if (np) np.addEventListener('click', function() {
          var name = prompt('Project name:');
          if (!name) return;
          fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
          }).then(function(r) {
            if (r.ok) { location.hash = '#project-select'; location.reload(); }
            else alert('Failed to create project.');
          });
        });
      })
      .catch(function(e) {
        if (e && e.message === 'unauthorized') return;
        showError('Could not load projects. Check your connection.', true);
      });
  }
  window._renderProjectSelect = _renderProjectSelect;

  // Bridge for new router
  window.Home = {
    mount: function (container) {
      // Trigger old home screen: show header + tile grid + dashboard + essentials
      document.body.classList.remove('section-open');
      document.body.classList.remove('ps-open');
      if (appHeader) appHeader.style.display = '';
      if (tileGrid) tileGrid.style.display = '';
      if (dashboard) dashboard.style.display = '';
      if (essentials) essentials.style.display = '';
      if (sectionPage) sectionPage.style.display = 'none';
    },
    unmount: function () {}
  };

  window.AlignProjects = {
    mount: function (container) {
      container.innerHTML = '';
      var el = document.createElement('div');
      el.id = 'ps-root';
      container.appendChild(el);
      _renderProjectSelect(el);
    },
    unmount: function () {
      var el = document.getElementById('ps-root');
      if (el) el.remove();
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // BOTTOM NAV — Phase 1 (tabs + quick-add sheet + all-tools sheet)
  // ═══════════════════════════════════════════════════════════════════════════

  (function() {
    var bottomNav = document.getElementById('bottom-nav');
    if (!bottomNav) return;

    var tabs = bottomNav.querySelectorAll('.bn-tab');
    var fab = document.getElementById('bn-add');
    var sheet = document.getElementById('bn-sheet');
    var overlay = document.getElementById('bn-sheet-overlay');
    var sheetClose = document.getElementById('bn-sheet-close');
    var sheetItems = document.querySelectorAll('.bn-sheet-item');

    // ── All Tools sheet elements ──
    var toolsOverlay = document.getElementById('bn-tools-overlay');
    var toolsSheet = document.getElementById('bn-tools-sheet');
    var toolsGrid = document.getElementById('bn-tools-grid');
    var toolsClose = document.getElementById('bn-tools-close');
    var _lastFocusedToolsEl = null;

    // ── Tab active state ──
    function _updateBottomNavActive() {
      var hash = location.hash.replace('#/', '') || 'home';
      tabs.forEach(function(tab) {
        var bn = tab.getAttribute('data-bn');
        var isActive = false;
        if (hash === 'home' || hash === '') {
          isActive = (bn === 'overview');
        } else if (hash === 'all-tools') {
          isActive = (bn === 'all-tools');
        } else if (hash === 'daily-logs') {
          isActive = (bn === 'logs');
        } else if (hash === 'drawings') {
          isActive = (bn === 'drawings');
        }
        tab.classList.toggle('active', isActive);
      });
    }

    window.addEventListener('hashchange', _updateBottomNavActive);
    if (window._alignReadyFired) {
      _updateBottomNavActive();
    } else {
      window.addEventListener('align-ready', _updateBottomNavActive);
    }

    // ── Overview tab → home (dashboard + tiles) ──
    var overviewTab = bottomNav.querySelector('[data-bn="overview"]');
    if (overviewTab) {
      overviewTab.addEventListener('click', function(e) {
        // Let the href handle it, just ensure we're at home
        if (location.hash === '#/home' || location.hash === '') return;
      });
    }

    // ── All Tools tab → open bottom sheet (mobile only) ──
    var allToolsTab = bottomNav.querySelector('[data-bn="all-tools"]');
    if (allToolsTab) {
      allToolsTab.addEventListener('click', function(e) {
        e.preventDefault();
        // Mobile only: open the tools sheet instead of navigating via hash
        if (window.innerWidth <= 768) {
          _openToolsSheet();
        } else {
          location.hash = '#/all-tools';
        }
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ALL TOOLS SHEET — open / close / interaction
    // ══════════════════════════════════════════════════════════════════════

    function _openToolsSheet() {
      if (!toolsSheet || !toolsOverlay || !toolsGrid) return;
      // Close Quick Add sheet if open (prevent stacking)
      if (sheet && sheet.classList.contains('open')) _closeSheet();

      // Save focus target for restore
      _lastFocusedToolsEl = document.activeElement;

      // Clone tile innerHTML from the source tile-grid into the tools grid
      var sourceGrid = document.querySelector('.tile-grid');
      if (sourceGrid) {
        // Convert .tile buttons → .bn-tools-tile buttons preserving data-section
        var tiles = sourceGrid.querySelectorAll('.tile');
        var html = '';
        tiles.forEach(function(tile) {
          var section = tile.getAttribute('data-section');
          var labelEl = tile.querySelector('.tile-label');
          var iconEl = tile.querySelector('.tile-icon');
          var label = labelEl ? labelEl.textContent : '';
          var iconHTML = iconEl ? iconEl.innerHTML : '';
          html += '<button class="bn-tools-tile" data-section="' + section + '" type="button">' +
            '<span class="bn-tools-tile-icon">' + iconHTML + '</span>' +
            '<span class="bn-tools-tile-label">' + label + '</span>' +
            '</button>';
        });
        toolsGrid.innerHTML = html;
      }

      // Lock body scroll (overflow only — never position:fixed)
      document.body.style.overflow = 'hidden';

      // Show overlay + sheet with animation
      toolsOverlay.style.display = 'block';
      // Force reflow for transition
      void toolsOverlay.offsetWidth;
      toolsOverlay.classList.add('open');
      toolsSheet.classList.add('open');

      // Focus management — focus first tile or close button
      requestAnimationFrame(function() {
        var firstTile = toolsGrid.querySelector('.bn-tools-tile');
        if (firstTile) firstTile.focus();
      });
    }

    function _closeToolsSheet() {
      if (!toolsSheet || !toolsOverlay) return;
      toolsOverlay.classList.remove('open');
      toolsSheet.classList.remove('open');
      document.body.style.overflow = '';

      // Restore focus
      if (_lastFocusedToolsEl && typeof _lastFocusedToolsEl.focus === 'function') {
        try { _lastFocusedToolsEl.focus(); } catch(e) {}
        _lastFocusedToolsEl = null;
      }

      // Hide overlay after transition completes
      setTimeout(function() {
        if (!toolsOverlay.classList.contains('open')) {
          toolsOverlay.style.display = 'none';
        }
      }, 250);
    }

    // ── Overlay click closes sheet ──
    if (toolsOverlay) {
      toolsOverlay.addEventListener('click', function(e) {
        if (e.target === toolsOverlay) _closeToolsSheet();
      });
    }

    // ── Close button ──
    if (toolsClose) {
      toolsClose.addEventListener('click', _closeToolsSheet);
    }

    // ── Escape key closes sheet ──
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && toolsSheet && toolsSheet.classList.contains('open')) {
        _closeToolsSheet();
      }
    });

    // ── Tile click delegation on tools grid ──
    if (toolsGrid) {
      toolsGrid.addEventListener('click', function(e) {
        var tile = e.target.closest('.bn-tools-tile');
        if (!tile) return;
        var section = tile.getAttribute('data-section');
        if (!section) return;
        _closeToolsSheet();
        // Use existing hash router to navigate
        if (location.hash === '#' + section) {
          // Force re-navigation if already on same hash
          location.hash = '';
          setTimeout(function() { location.hash = '#' + section; }, 50);
        } else {
          location.hash = '#' + section;
        }
      });
    }

    // ── Add button → bottom sheet ──
    function _openSheet() {
      if (!sheet || !overlay) return;
      overlay.style.display = 'block';
      // force reflow
      void overlay.offsetWidth;
      overlay.classList.add('open');
      sheet.classList.add('open');
    }
    function _closeSheet() {
      if (!sheet || !overlay) return;
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(function() {
        overlay.style.display = 'none';
      }, 250);
    }

    if (fab) {
      fab.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _openSheet();
      });
    }
    if (sheetClose) sheetClose.addEventListener('click', _closeSheet);
    if (overlay) overlay.addEventListener('click', _closeSheet);

    // Sheet item clicks
    var actionRoutes = {
      'daily-log': '#/daily-logs',
      'punch': '#/punchlist',
      'rfi': '#/rfis',
      'task': '#/tasks',
      'photo': '#/photos',
      'file': '#/files'
    };
    sheetItems.forEach(function(item) {
      item.addEventListener('click', function() {
        var action = this.getAttribute('data-bn-action');
        _closeSheet();
        if (actionRoutes[action]) {
          location.hash = actionRoutes[action];
        }
      });
    });
  })();

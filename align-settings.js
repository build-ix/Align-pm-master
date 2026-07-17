/* align-settings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Settings Dashboard module.
 *
 * App-wide preferences: theme, tile size, units, date/time format, currency.
 *
 * PUBLIC API  (window.AlignSettings)
 *   .render(container)   → mount the full Settings dashboard
 *   .CATEGORY            → 'settings'
 */

(function (global) {
  'use strict';

  function S() { return global.AlignStorage; }

  /* ── Settings keys ───────────────────────────────────────────────────────── */
  var THEME_KEY     = 'align.settings.theme';
  var TILESIZE_KEY  = 'align.settings.tileSize';
  var TEMPUNIT_KEY  = 'align.settings.tempUnit';
  var DATEFMT_KEY   = 'align.settings.dateFormat';
  var TIMEFMT_KEY   = 'align.settings.timeFormat';
  var UNITS_KEY     = 'align.settings.units';
  var CURRENCY_KEY  = 'align.settings.currency';

  /* ── Read / write helpers ────────────────────────────────────────────────── */
  function lsGet(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function lsSet(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function getTheme()      { return lsGet(THEME_KEY, 'system'); }
  function setTheme(v)     { lsSet(THEME_KEY, v); applyTheme(v); }
  function getTileSize()   { return lsGet(TILESIZE_KEY, 'default'); }
  function setTileSize(v)  { lsSet(TILESIZE_KEY, v); }
  function getTempUnit()   { return lsGet(TEMPUNIT_KEY, 'F'); }
  function setTempUnit(v)  { lsSet(TEMPUNIT_KEY, v); }
  function getDateFormat() { return lsGet(DATEFMT_KEY, 'MM/DD/YYYY'); }
  function setDateFormat(v){ lsSet(DATEFMT_KEY, v); }
  function getTimeFormat() { return lsGet(TIMEFMT_KEY, '12h'); }
  function setTimeFormat(v){ lsSet(TIMEFMT_KEY, v); }
  function getUnits()      { return lsGet(UNITS_KEY, 'imperial'); }
  function setUnits(v)     { lsSet(UNITS_KEY, v); }
  function getCurrency()   { return lsGet(CURRENCY_KEY, '$'); }
  function setCurrency(v)  { lsSet(CURRENCY_KEY, v); }

  /* ── Escaping ────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Theme application ──────────────────────────────────────────────────── */
  function applyTheme(theme) {
    var resolved = theme;
    if (theme === 'system') {
      try {
        resolved = global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) { resolved = 'light'; }
    }
    var el = document.documentElement;
    if (el) el.setAttribute('data-theme', resolved);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * CSS
   * ════════════════════════════════════════════════════════════════════════════ */
  var _cssInjected = false;

  function injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;

    var style = document.createElement('style');
    style.textContent = [
      '.st-settings { display:flex; flex-direction:column; gap:32px; padding-bottom:40px; }',

      /* Section */
      '.st-section { display:flex; flex-direction:column; gap:10px; }',
      '.st-section-header { display:flex; align-items:center; gap:10px; padding-left:12px; border-left:3px solid var(--brand); margin-bottom:4px; }',
      '.st-section-header.appearance { border-left-color:#f59e0b; }',
      '.st-section-header.data { border-left-color:#10b981; }',
      '.st-section-header.about { border-left-color:#6b7280; }',
      '.st-section-icon { width:18px; height:18px; color:var(--brand); flex-shrink:0; }',
      '.st-section-header.appearance .st-section-icon { color:#f59e0b; }',
      '.st-section-header.data .st-section-icon { color:#10b981; }',
      '.st-section-header.about .st-section-icon { color:#6b7280; }',
      '.st-section-title { font-size:0.72rem; font-weight:700; color:var(--ink); letter-spacing:0.08em; text-transform:uppercase; }',

      /* Profile card */
      '.st-profile-card { background:var(--card); border:1px solid var(--line); border-radius:var(--radius-lg,16px); padding:20px; display:flex; align-items:center; gap:16px; }',
      '.st-profile-avatar { width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg, var(--brand) 0%, var(--brand-light,#4f7ef7) 100%); color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.1rem; font-weight:800; flex-shrink:0; }',
      '.st-profile-info { flex:1; min-width:0; }',
      '.st-profile-name { font-size:1.05rem; font-weight:700; color:var(--ink); letter-spacing:-0.01em; }',
      '.st-profile-email { font-size:0.8rem; color:var(--muted); margin-top:2px; }',
      '.st-role-badge { display:inline-block; font-size:0.65rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; padding:2px 8px; border-radius:20px; margin-top:4px; }',
      '.st-role-badge.admin { background:var(--brand-bg,rgba(26,95,212,0.08)); color:var(--brand); }',
      '.st-role-badge.user { background:var(--bg-alt,#e6ebf0); color:var(--muted); }',
      '.st-profile-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; padding-top:14px; border-top:1px solid var(--line); }',

      /* Setting row */
      '.st-setting-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px; background:var(--card); border:1px solid var(--line); border-radius:var(--radius-md,12px); flex-wrap:wrap; }',
      '.st-setting-label { font-size:0.88rem; font-weight:600; color:var(--ink); }',
      '.st-setting-hint { font-size:0.74rem; color:var(--muted); margin-top:1px; }',

      /* Segmented control */
      '.st-segmented { display:flex; gap:0; border:1px solid var(--line); border-radius:var(--radius-sm,8px); overflow:hidden; flex-shrink:0; }',
      '.st-segmented button { padding:6px 14px; border:none; border-right:1px solid var(--line); background:var(--card); color:var(--muted); font-size:0.78rem; font-weight:600; cursor:pointer; font-family:var(--font); transition:all 0.15s ease; white-space:nowrap; }',
      '.st-segmented button:last-child { border-right:none; }',
      '.st-segmented button:hover { background:var(--bg-alt); color:var(--ink); }',
      '.st-segmented button.st-seg-active { background:var(--brand); color:#fff; }',

      /* About */
      '.st-about { text-align:center; padding:16px; color:var(--muted); font-size:0.8rem; }',
      '.st-about-version { font-size:0.9rem; font-weight:700; color:var(--ink); margin-bottom:2px; }',

      /* PIN dialog */
      '.st-pin-overlay { position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }',
      '.st-pin-dialog { background:var(--card); border-radius:var(--radius-xl,20px); padding:28px 24px; width:100%; max-width:360px; box-shadow:var(--shadow-xl); display:flex; flex-direction:column; gap:14px; }',
      '.st-pin-dialog h3 { margin:0; font-size:1.1rem; font-weight:700; color:var(--ink); letter-spacing:-0.01em; }',
      '.st-pin-input { padding:10px 14px; border:1px solid var(--line); border-radius:var(--radius-sm,8px); font-size:0.9rem; font-family:var(--font); letter-spacing:0.3em; max-width:160px; align-self:center; }',
      '.st-pin-input:focus { outline:none; border-color:var(--brand); box-shadow:0 0 0 3px rgba(26,95,212,0.10); }',
      '.st-pin-input::placeholder { letter-spacing:normal; }',
      '.st-pin-error { font-size:0.78rem; color:var(--danger); text-align:center; font-weight:600; }',
      '.st-pin-actions { display:flex; gap:8px; justify-content:flex-end; }',

      /* Danger zone */
      '.st-danger-zone { background:var(--danger-bg,#fef2f2); border:1px solid var(--danger); border-radius:var(--radius-md,12px); padding:16px 18px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }',
      '.st-danger-zone-label { font-size:0.85rem; font-weight:700; color:var(--danger); }',

      /* Responsive */
      '@media (max-width:480px) { .st-profile-card { flex-direction:column; text-align:center; } .st-profile-actions { justify-content:center; width:100%; } .st-setting-row { flex-direction:column; align-items:flex-start; } .st-danger-zone { flex-direction:column; align-items:flex-start; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * RENDER
   * ════════════════════════════════════════════════════════════════════════════ */
  var ui = { container:null, pinDialogOpen:false, pinError:'' };

  function render(container) {
    if (!container) return;
    ui.container = container;
    ui.pinDialogOpen = false;
    ui.pinError = '';
    injectCSS();
    _paint();
    _wire();
  }

  /* ── SVG icons ───────────────────────────────────────────────────────────── */
  var _ICONS = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
    data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  function _icon(name) {
    return '<span class="st-section-icon">' + (_ICONS[name] || '') + '</span>';
  }

  function _paint() {
    var c = ui.container;
    if (!c) return;

    var auth = global.AlignAuth;
    var user = auth ? auth.getActiveUser() : null;

    var parts = ['<div class="st-settings">'];
    parts.push(_userProfileHTML(user));
    parts.push(_appearanceHTML());
    parts.push(_dataHTML());
    parts.push(_aboutHTML());
    parts.push('</div>');

    c.innerHTML = parts.join('');
  }

  /* ── 1. User Profile ────────────────────────────────────────────────────── */
  function _userProfileHTML(user) {
    var html = ['<div class="st-section">'];
    html.push('<div class="st-section-header">', _icon('user'), '<span class="st-section-title">Your Profile</span></div>');

    if (!user) {
      html.push('<div class="pm-empty"><strong>Not signed in</strong>Sign in to see your profile.</div>');
    } else {
      var displayName = user.name || (user.firstName + ' ' + user.lastName);
      var initials = (displayName || '??').split(' ').map(function(p){ return (p||'')[0]||''; }).join('').toUpperCase().slice(0,2) || '?';
      html.push(
        '<div class="st-profile-card">',
          '<div class="st-profile-avatar">', esc(initials), '</div>',
          '<div class="st-profile-info">',
            '<div class="st-profile-name">', esc(displayName), '</div>',
            '<div class="st-profile-email">', esc(user.email || ''), '</div>',
            '<span class="st-role-badge ', user.role==='admin'?'admin':'user', '">', esc(user.role), '</span>',
          '</div>',
        '</div>',
        '<div class="st-profile-actions">',
          '<button class="pm-btn small" data-st-act="change-pin">Change Password</button>',
          '<button class="pm-btn small" data-st-act="refresh-cache">Refresh Cache</button>',
          '<button class="pm-btn small danger" data-st-act="sign-out">Sign Out</button>',
        '</div>'
      );
    }
    html.push('</div>');
    return html.join('');
  }

  /* ── 2. Appearance ──────────────────────────────────────────────────────── */
  function _appearanceHTML() {
    var theme    = getTheme();
    var tileSize = getTileSize();
    var tempUnit = getTempUnit();
    var dateFmt  = getDateFormat();
    var timeFmt  = getTimeFormat();
    var units    = getUnits();
    var currency = getCurrency();

    function seg(options, activeVal, act, valPrefix) {
      return options.map(function(o) {
        var active = o.val === activeVal ? ' st-seg-active' : '';
        return '<button data-st-act="' + act + '" data-st-val="' + o.val + '" class="' + active + '">' + esc(o.label) + '</button>';
      }).join('');
    }

    return [
      '<div class="st-section">',
        '<div class="st-section-header appearance">', _icon('palette'), '<span class="st-section-title">Appearance</span></div>',
        '<div class="st-setting-row"><div><div class="st-setting-label">Theme</div><div class="st-setting-hint">Light, dark, or follow system</div></div><div class="st-segmented">',
          seg([{val:'system',label:'System'},{val:'light',label:'Light'},{val:'dark',label:'Dark'}], theme, 'set-theme'),
        '</div></div>',
        '<div class="st-setting-row"><div><div class="st-setting-label">Tile Size</div><div class="st-setting-hint">Dashboard tile density</div></div><div class="st-segmented">',
          seg([{val:'compact',label:'Compact'},{val:'default',label:'Default'},{val:'large',label:'Large'}], tileSize, 'set-tile-size'),
        '</div></div>',
        '<div class="st-setting-row"><div><div class="st-setting-label">Temperature</div><div class="st-setting-hint">Weather display unit</div></div><div class="st-segmented">',
          seg([{val:'F',label:'°F'},{val:'C',label:'°C'}], tempUnit, 'set-tempunit'),
        '</div></div>',
        '<div class="st-setting-row"><div><div class="st-setting-label">Date Format</div><div class="st-setting-hint">How dates appear across the app</div></div><div class="st-segmented">',
          seg([{val:'MM/DD/YYYY',label:'MM/DD/YYYY'},{val:'DD/MM/YYYY',label:'DD/MM/YYYY'}], dateFmt, 'set-datefmt'),
        '</div></div>',
        '<div class="st-setting-row"><div><div class="st-setting-label">Time Format</div><div class="st-setting-hint">12-hour or 24-hour clock</div></div><div class="st-segmented">',
          seg([{val:'12h',label:'12h'},{val:'24h',label:'24h'}], timeFmt, 'set-timefmt'),
        '</div></div>',
        '<div class="st-setting-row"><div><div class="st-setting-label">Units</div><div class="st-setting-hint">Measurement system for specs and takeoffs</div></div><div class="st-segmented">',
          seg([{val:'imperial',label:'Imperial'},{val:'metric',label:'Metric'}], units, 'set-units'),
        '</div></div>',
        '<div class="st-setting-row"><div><div class="st-setting-label">Currency</div><div class="st-setting-hint">Budget and cost display symbol</div></div><div class="st-segmented">',
          seg([{val:'$',label:'$ USD'},{val:'€',label:'€ EUR'},{val:'£',label:'£ GBP'}], currency, 'set-currency'),
        '</div></div>',
      '</div>'
    ].join('');
  }

  /* ── 3. Data ────────────────────────────────────────────────────────────── */
  function _dataHTML() {
    var isOwner = _isOwner();
    return [
      '<div class="st-section">',
        '<div class="st-section-header data">', _icon('data'), '<span class="st-section-title">Data</span></div>',
        isOwner ?
          '<div class="st-setting-row"><div><div class="st-setting-label">Export Project Data</div><div class="st-setting-hint">Download all records as JSON</div></div><button class="pm-btn small" data-st-act="export-data">Export JSON</button></div>' +
          '<div class="st-danger-zone"><div><div class="st-danger-zone-label">Clear Project Data</div><div style="font-size:0.76rem;color:var(--muted);margin-top:2px;">Permanently delete all records for the current project</div></div><button class="pm-btn small danger" data-st-act="clear-data">Clear All</button></div>'
        :
          '<div class="st-setting-row"><div><div class="st-setting-label" style="color:var(--muted);">Data export and clearing</div><div class="st-setting-hint">Only the account owner can export or clear project data</div></div></div>',
      '</div>'
    ].join('');
  }

  /* ── 4. About ───────────────────────────────────────────────────────────── */
  function _aboutHTML() {
    return [
      '<div class="st-section">',
        '<div class="st-section-header about">', _icon('about'), '<span class="st-section-title">About</span></div>',
        '<div class="st-about"><div class="st-about-version">Align PM v1.0</div><div>Built for construction professionals</div></div>',
      '</div>'
    ].join('');
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * WIRING
   * ════════════════════════════════════════════════════════════════════════════ */
  function _wire() {
    var c = ui.container;
    if (!c) return;
    c.removeEventListener('click', _onClick);
    c.addEventListener('click', _onClick);
  }

  function _onClick(e) {
    var el = e.target.closest('[data-st-act]');
    if (!el) return;
    var act = el.getAttribute('data-st-act');
    var val = el.getAttribute('data-st-val');

    switch (act) {
      case 'sign-out':
        e.preventDefault();
        if (global.AlignAuth) { global.AlignAuth.signOut(); _paint(); _wire(); }
        break;

      case 'refresh-cache':
        e.preventDefault();
        if ('caches' in window) {
          caches.keys().then(function(names) { for (var i=0;i<names.length;i++) caches.delete(names[i]); })
            .then(function() {
              if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
                navigator.serviceWorker.getRegistrations().then(function(regs) { for (var r=0;r<regs.length;r++) regs[r].unregister(); window.location.reload(true); });
              } else { window.location.reload(true); }
            });
        } else { window.location.reload(true); }
        break;

      case 'sign-out-all':
        e.preventDefault();
        if (global.AlignAuth && global.AlignAuth.signOutAll) { global.AlignAuth.signOutAll(); _paint(); _wire(); }
        else if (global.AlignAuth) { global.AlignAuth.signOut(); _paint(); _wire(); }
        break;

      case 'change-pin':
        e.preventDefault(); _openPinDialog(); break;

      case 'set-theme':
        e.preventDefault(); if (val) { setTheme(val); window._invalidateTileCache('settings'); _paint(); _wire(); }
        break;

      case 'set-tile-size':
        e.preventDefault(); if (val) { setTileSize(val); _refreshTileGrid(val); window._invalidateTileCache('settings'); _paint(); _wire(); }
        break;

      case 'set-tempunit':
        e.preventDefault(); if (val) { setTempUnit(val); window._invalidateTileCache('settings'); try { localStorage.removeItem('align_weather_html_v2'); } catch(e) {} if (window.__weatherData) window._renderWeatherCards(window.__weatherData); _paint(); _wire(); }
        break;

      case 'set-datefmt':
        e.preventDefault(); if (val) { setDateFormat(val); window._invalidateTileCache('settings'); _paint(); _wire(); }
        break;

      case 'set-timefmt':
        e.preventDefault(); if (val) { setTimeFormat(val); window._invalidateTileCache('settings'); _paint(); _wire(); }
        break;

      case 'set-units':
        e.preventDefault(); if (val) { setUnits(val); window._invalidateTileCache('settings'); _paint(); _wire(); }
        break;

      case 'set-currency':
        e.preventDefault(); if (val) { setCurrency(val); window._invalidateTileCache('settings'); _paint(); _wire(); }
        break;

      case 'export-data':
        e.preventDefault(); if (!_isOwner()) { alert('Only the account owner can export project data.'); return; } _exportData(); break;

      case 'clear-data':
        e.preventDefault(); if (!_isOwner()) { alert('Only the account owner can clear project data.'); return; } _clearData(); break;
    }
  }

  /* ── Tile grid refresh ──────────────────────────────────────────────────── */
  function _refreshTileGrid(size) {
    var grid = document.querySelector('.tile-grid');
    if (!grid) return;
    grid.classList.remove('tile-grid--compact', 'tile-grid--large');
    if (size === 'compact') grid.classList.add('tile-grid--compact');
    else if (size === 'large') grid.classList.add('tile-grid--large');
  }

  /* ── Owner check ────────────────────────────────────────────────────────── */
  function _isOwner() {
    var auth = global.AlignAuth;
    if (!auth) return false;
    var user = auth.getActiveUser();
    if (!user) return false;
    return user.email === 'admin@align.local';
  }

  /* ── Sub-view helper ────────────────────────────────────────────────────── */
  function _showSubView(title, renderFn) {
    if (window._pushSettingsSubview) window._pushSettingsSubview(title, renderFn);
  }

  /* ── PIN Change Dialog ──────────────────────────────────────────────────── */
  function _openPinDialog() {
    var auth = global.AlignAuth;
    var user = auth ? auth.getActiveUser() : null;
    if (!user) return;

    var overlay = document.createElement('div');
    overlay.className = 'st-pin-overlay';
    overlay.id = 'st-pin-overlay';
    overlay.innerHTML = [
      '<div class="st-pin-dialog">',
        '<h3>Change Password</h3>',
        '<input class="st-pin-input" id="st-pin-current" type="password" placeholder="Current password" autocomplete="current-password">',
        '<input class="st-pin-input" id="st-pin-new" type="password" placeholder="New password (min 8 chars)" minlength="8" autocomplete="new-password">',
        '<input class="st-pin-input" id="st-pin-confirm" type="password" placeholder="Confirm new password" minlength="8" autocomplete="new-password">',
        '<div class="st-pin-error" id="st-pin-error" style="display:none;"></div>',
        '<div class="st-pin-actions">',
          '<button class="pm-btn" id="st-pin-cancel">Cancel</button>',
          '<button class="pm-btn primary" id="st-pin-save">Save</button>',
        '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);
    setTimeout(function() { var inp = document.getElementById('st-pin-current'); if (inp) inp.focus(); }, 100);

    overlay.addEventListener('click', function(ev) { if (ev.target === overlay) _closePinDialog(); });
    var cancelBtn = document.getElementById('st-pin-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', _closePinDialog);
    var saveBtn = document.getElementById('st-pin-save');
    if (saveBtn) saveBtn.addEventListener('click', _savePin);
    overlay.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') _closePinDialog();
      else if (ev.key === 'Enter') _savePin();
    });
  }

  function _closePinDialog() {
    var overlay = document.getElementById('st-pin-overlay');
    if (overlay) overlay.remove();
    ui.pinDialogOpen = false;
    ui.pinError = '';
  }

  function _savePin() {
    var auth = global.AlignAuth;
    var user = auth ? auth.getActiveUser() : null;
    if (!user) return;

    var curEl = document.getElementById('st-pin-current');
    var newEl = document.getElementById('st-pin-new');
    var confirmEl = document.getElementById('st-pin-confirm');

    var currentPin = (curEl ? curEl.value.trim() : '');
    var newPin = (newEl ? newEl.value.trim() : '');
    var confirmPin = (confirmEl ? confirmEl.value.trim() : '');

    if (!currentPin || !newPin) { _showPinError('Enter current and new password.'); return; }
    if (newPin.length < 8) { _showPinError('New password must be at least 8 characters.'); return; }
    if (newPin !== confirmPin) { _showPinError('Passwords do not match.'); return; }

    try {
      auth.updateUser(user.id, { password: newPin });
      _closePinDialog();
      _paint(); _wire();
    } catch (e) { _showPinError(e.message); }
  }

  function _showPinError(msg) {
    var errEl = document.getElementById('st-pin-error');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  }

  /* ── Export Data ────────────────────────────────────────────────────────── */
  function _exportData() {
    var storage = S();
    if (!storage) { alert('Storage is not available.'); return; }
    var active = storage.getActiveProject();
    if (!active) { alert('No active project selected.'); return; }

    var categories = storage.categories || ['drawings','daily-logs','specs','rfis','punchlist','schedule','budget','contacts','photos','tasks','procurement','files','settings'];
    var exportData = { project: { id:active.id, name:active.name, address:active.address||'', createdAt:active.createdAt, exportedAt:new Date().toISOString() }, records:{} };
    categories.forEach(function(cat) {
      try { var records = storage.listRecords(active.id, cat); if (records && records.length) exportData.records[cat] = records; }
      catch (e) {}
    });

    var json = JSON.stringify(exportData, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var safeName = (active.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = 'align-export-' + safeName + '-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── Clear Project Data ─────────────────────────────────────────────────── */
  function _clearData() {
    var storage = S();
    if (!storage) { alert('Storage is not available.'); return; }
    var active = storage.getActiveProject();
    if (!active) { alert('No active project selected.'); return; }

    if (!confirm('This will permanently delete ALL records for "' + active.name + '".\n\nThis includes drawings, daily logs, RFIs, punchlist, schedule, budget, contacts, photos, tasks, procurement, files, and specs.\n\nThe project itself will be kept. This cannot be undone.\n\nAre you sure?')) return;
    if (!confirm('Final confirmation: Delete all data for "' + active.name + '"?')) return;

    var categories = storage.categories || ['drawings','daily-logs','specs','rfis','punchlist','schedule','budget','contacts','photos','tasks','procurement','files','settings'];
    categories.forEach(function(cat) {
      try { storage.clearCategory(active.id, cat); } catch (e) {}
    });
    alert('All data for "' + active.name + '" has been cleared.');
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * INIT
   * ════════════════════════════════════════════════════════════════════════════ */
  applyTheme(getTheme());

  try {
    var savedTileSize = getTileSize();
    if (savedTileSize && savedTileSize !== 'default') {
      var grid = document.querySelector('.tile-grid');
      if (grid) {
        if (savedTileSize === 'compact') grid.classList.add('tile-grid--compact');
        else if (savedTileSize === 'large') grid.classList.add('tile-grid--large');
      }
    }
  } catch (e) {}

  try {
    var darkQuery = global.matchMedia('(prefers-color-scheme: dark)');
    if (darkQuery && darkQuery.addEventListener) {
      darkQuery.addEventListener('change', function() { if (getTheme() === 'system') applyTheme('system'); });
    }
  } catch (e) {}

  window.AlignSettings = { render: render };

})(window);

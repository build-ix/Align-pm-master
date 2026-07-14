/* align-settings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Settings Dashboard module.
 *
 * Renders the Settings panel (replaces the inline renderSettingsMenu() in
 * script.js) with five sections: User Profile, Appearance, Project
 * Management, Data, and About.
 *
 * STORAGE
 *   All settings are app-wide (not per-project). Keys live directly under
 *   localStorage:
 *     align.settings.theme      → 'system' | 'light' | 'dark'
 *     align.settings.tileSize   → 'compact' | 'default' | 'large'
 *
 * PUBLIC API  (window.AlignSettings)
 *   .render(container)   → mount the full Settings dashboard
 *   .CATEGORY            → 'settings' (for routing compatibility)
 */

(function (global) {
  'use strict';

  function S() { return global.AlignStorage; }

  /* ── Settings key ────────────────────────────────────────────────────────── */
  var THEME_KEY    = 'align.settings.theme';
  var TILESIZE_KEY = 'align.settings.tileSize';
  var TEMPUNIT_KEY = 'align.settings.tempUnit';

  /* ── Read / write helpers ────────────────────────────────────────────────── */
  function lsGet(key) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function lsSet(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function getTheme()       { return lsGet(THEME_KEY)    || 'system'; }
  function setTheme(v)      { lsSet(THEME_KEY, v); applyTheme(v); }
  function getTileSize()    { return lsGet(TILESIZE_KEY) || 'default'; }
  function setTileSize(v)   { lsSet(TILESIZE_KEY, v); }
  function getTempUnit()    { return lsGet(TEMPUNIT_KEY) || 'F'; }
  function setTempUnit(v)   { lsSet(TEMPUNIT_KEY, v); }

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
        resolved = global.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark' : 'light';
      } catch (e) { resolved = 'light'; }
    }
    var el = document.documentElement;
    if (el) el.setAttribute('data-theme', resolved);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * CSS — injected once as an inline <style> tag (st- namespace)
   * ════════════════════════════════════════════════════════════════════════════ */
  var _cssInjected = false;

  function injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;

    var style = document.createElement('style');
    style.textContent = [
      /* ── Dashboard container ──────────────────────────────────────────── */
      '.st-settings {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 28px;',
      '}',

      /* ── Section ──────────────────────────────────────────────────────── */
      '.st-section {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 12px;',
      '}',
      '.st-section-header {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  padding-bottom: 8px;',
      '  border-bottom: 1px solid var(--line);',
      '}',
      '.st-section-icon {',
      '  width: 32px;',
      '  height: 32px;',
      '  border-radius: var(--radius-sm, 8px);',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  font-size: 1rem;',
      '  flex-shrink: 0;',
      '}',
      '.st-section-title {',
      '  font-size: 0.95rem;',
      '  font-weight: 800;',
      '  color: var(--ink);',
      '  letter-spacing: -0.01em;',
      '  text-transform: uppercase;',
      '}',

      /* ── User profile card ────────────────────────────────────────────── */
      '.st-profile-card {',
      '  background: var(--card);',
      '  border: 1px solid var(--line);',
      '  border-radius: var(--radius-lg, 16px);',
      '  padding: 20px;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 16px;',
      '  flex-wrap: wrap;',
      '}',
      '.st-profile-avatar {',
      '  width: 52px;',
      '  height: 52px;',
      '  border-radius: 50%;',
      '  background: linear-gradient(135deg, var(--brand) 0%, var(--brand-light) 100%);',
      '  color: #fff;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  font-size: 1.15rem;',
      '  font-weight: 800;',
      '  flex-shrink: 0;',
      '  box-shadow: 0 2px 8px rgba(26,95,212,0.3);',
      '}',
      '.st-profile-info {',
      '  flex: 1;',
      '  min-width: 140px;',
      '}',
      '.st-profile-name {',
      '  font-size: 1.05rem;',
      '  font-weight: 800;',
      '  color: var(--ink);',
      '  letter-spacing: -0.01em;',
      '}',
      '.st-profile-email {',
      '  font-size: 0.82rem;',
      '  color: var(--muted);',
      '  margin-top: 2px;',
      '}',
      '.st-profile-actions {',
      '  display: flex;',
      '  gap: 8px;',
      '  align-items: center;',
      '  flex-wrap: wrap;',
      '}',

      /* ── Role badge ───────────────────────────────────────────────────── */
      '.st-role-badge {',
      '  display: inline-block;',
      '  font-size: 0.68rem;',
      '  font-weight: 700;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.5px;',
      '  padding: 2px 10px;',
      '  border-radius: 20px;',
      '  margin-top: 4px;',
      '}',
      '.st-role-badge.admin {',
      '  background: var(--brand-bg, rgba(26,95,212,0.06));',
      '  color: var(--brand);',
      '}',
      '.st-role-badge.user {',
      '  background: var(--bg-alt, #e6ebf0);',
      '  color: var(--muted);',
      '}',

      /* ── Setting row ──────────────────────────────────────────────────── */
      '.st-setting-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 12px;',
      '  padding: 14px 16px;',
      '  background: var(--card);',
      '  border: 1px solid var(--line);',
      '  border-radius: var(--radius-md, 12px);',
      '  flex-wrap: wrap;',
      '}',
      '.st-setting-label {',
      '  font-size: 0.9rem;',
      '  font-weight: 700;',
      '  color: var(--ink);',
      '  letter-spacing: -0.01em;',
      '}',
      '.st-setting-hint {',
      '  font-size: 0.74rem;',
      '  color: var(--muted);',
      '  margin-top: 1px;',
      '}',

      /* ── Segmented control (theme, tile size) ──────────────────────────── */
      '.st-segmented {',
      '  display: flex;',
      '  gap: 0;',
      '  border: 1px solid var(--line);',
      '  border-radius: var(--radius-sm, 8px);',
      '  overflow: hidden;',
      '  flex-shrink: 0;',
      '}',
      '.st-segmented button {',
      '  padding: 7px 14px;',
      '  border: none;',
      '  border-right: 1px solid var(--line);',
      '  background: var(--card);',
      '  color: var(--muted);',
      '  font-size: 0.78rem;',
      '  font-weight: 600;',
      '  cursor: pointer;',
      '  font-family: var(--font);',
      '  transition: all 0.15s ease;',
      '  white-space: nowrap;',
      '}',
      '.st-segmented button:last-child {',
      '  border-right: none;',
      '}',
      '.st-segmented button:hover {',
      '  background: var(--bg-alt);',
      '  color: var(--ink);',
      '}',
      '.st-segmented button.st-seg-active {',
      '  background: var(--brand);',
      '  color: #fff;',
      '  box-shadow: inset 0 0 0 1px var(--brand);',
      '}',

      /* ── About section ────────────────────────────────────────────────── */
      '.st-about {',
      '  text-align: center;',
      '  padding: 24px 16px;',
      '  color: var(--muted);',
      '  font-size: 0.82rem;',
      '}',
      '.st-about .st-about-version {',
      '  font-size: 0.95rem;',
      '  font-weight: 700;',
      '  color: var(--ink);',
      '  margin-bottom: 4px;',
      '}',

      /* ── PIN change dialog overlay ────────────────────────────────────── */
      '.st-pin-overlay {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 300;',
      '  background: rgba(0,0,0,0.35);',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  backdrop-filter: blur(4px);',
      '  -webkit-backdrop-filter: blur(4px);',
      '}',
      '.st-pin-dialog {',
      '  background: var(--card);',
      '  border-radius: var(--radius-xl, 20px);',
      '  padding: 28px 24px;',
      '  width: 100%;',
      '  max-width: 360px;',
      '  box-shadow: var(--shadow-xl);',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 14px;',
      '}',
      '.st-pin-dialog h3 {',
      '  margin: 0;',
      '  font-size: 1.1rem;',
      '  font-weight: 800;',
      '  color: var(--ink);',
      '  letter-spacing: -0.01em;',
      '}',
      '.st-pin-input {',
      '  padding: 10px 14px;',
      '  border: 1px solid var(--line);',
      '  border-radius: var(--radius-sm, 8px);',
      '  font-size: 0.9rem;',
      '  font-family: var(--font);',
      '  text-align: center;',
      '  letter-spacing: 0.3em;',
      '  max-width: 160px;',
      '  align-self: center;',
      '}',
      '.st-pin-input:focus {',
      '  outline: none;',
      '  border-color: var(--brand);',
      '  box-shadow: 0 0 0 3px rgba(26,95,212,0.10);',
      '}',
      '.st-pin-input::placeholder {',
      '  letter-spacing: normal;',
      '}',
      '.st-pin-error {',
      '  font-size: 0.78rem;',
      '  color: var(--danger);',
      '  text-align: center;',
      '  font-weight: 600;',
      '}',
      '.st-pin-actions {',
      '  display: flex;',
      '  gap: 8px;',
      '  justify-content: flex-end;',
      '}',

      /* ── Danger zone card ─────────────────────────────────────────────── */
      '.st-danger-zone {',
      '  background: var(--danger-bg, #fef2f2);',
      '  border: 1px solid var(--danger);',
      '  border-radius: var(--radius-md, 12px);',
      '  padding: 16px;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 12px;',
      '  flex-wrap: wrap;',
      '}',
      '.st-danger-zone-label {',
      '  font-size: 0.85rem;',
      '  font-weight: 700;',
      '  color: var(--danger);',
      '}',

      /* ── Responsive ───────────────────────────────────────────────────── */
      '@media (max-width: 480px) {',
      '  .st-profile-card { flex-direction: column; text-align: center; }',
      '  .st-profile-actions { justify-content: center; width: 100%; }',
      '  .st-setting-row { flex-direction: column; align-items: flex-start; }',
      '  .st-danger-zone { flex-direction: column; align-items: flex-start; }',
      '}',

      /* ── Project cards ────────────────────────────────────────────────── */
      '.st-project-list { display:flex; flex-direction:column; gap:8px; }',
      '.st-proj-card { display:flex; align-items:center; gap:12px; padding:12px 16px; background:var(--card); border:1px solid var(--line); border-radius:var(--radius-md,12px); }',
      '.st-proj-image { width:44px; height:44px; border-radius:8px; background:var(--bg-alt,#e6ebf0); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; position:relative; }',
      '.st-proj-image img { width:100%; height:100%; object-fit:cover; position:absolute; inset:0; }',
      '.st-proj-initial { font-size:1.1rem; font-weight:700; color:var(--brand); }',
      '.st-proj-info { flex:1; min-width:0; }',
      '.st-proj-name { font-weight:600; font-size:0.9rem; }',
      '.st-proj-meta { font-size:0.72rem; color:var(--ink-muted,var(--muted)); margin-top:2px; }',
      '.st-proj-desc { font-size:0.75rem; color:var(--ink-muted,var(--muted)); margin-top:4px; }',
      '.st-proj-actions { display:flex; gap:6px; flex-shrink:0; }',

      /* ── Project modal ───────────────────────────────────────────────── */
      '.st-modal-mask { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:999; display:flex; align-items:center; justify-content:center; }',
      '.st-modal { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:24px; max-width:440px; width:90vw; max-height:90vh; overflow-y:auto; }',
      '.st-modal-header { font-size:1rem; font-weight:700; margin-bottom:16px; }',
      '.st-modal-body { display:flex; flex-direction:column; gap:12px; }',
      '.st-modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:20px; }',
      '.st-field-label { font-size:0.75rem; font-weight:600; color:var(--ink-muted); margin-bottom:2px; }',
      '.st-input { width:100%; padding:8px 12px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); font-size:0.85rem; font-family:var(--font); box-sizing:border-box; }',
      '.st-input:focus { outline:none; border-color:var(--brand); box-shadow:0 0 0 2px rgba(99,102,241,0.15); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * RENDER
   * ════════════════════════════════════════════════════════════════════════════ */

  var ui = {
    container: null,
    /* PIN change state */
    pinDialogOpen: false,
    pinError: ''
  };

  function render(container) {
    if (!container) return;
    ui.container = container;
    ui.pinDialogOpen = false;
    ui.pinError = '';
    injectCSS();
    _paint();
    _wire();
  }

  function _paint() {
    var c = ui.container;
    if (!c) return;

    var auth  = global.AlignAuth;
    var user  = auth ? auth.getActiveUser() : null;

    // ── Build HTML ──────────────────────────────────────────────────────────
    var parts = ['<div class="st-settings">'];

    /* 1. USER PROFILE */
    parts.push(_userProfileHTML(user));

    /* 2. APPEARANCE */
    parts.push(_appearanceHTML());

    /* 2.5 PROJECTS (admin only) */
    if (_isOwner()) parts.push(_projectsHTML());

    /* 3. DATA */
    parts.push(_dataHTML());

    /* 4. ABOUT */
    parts.push(_aboutHTML());

    parts.push('</div>'); // .st-settings

    c.innerHTML = parts.join('');
  }

  /* ── 1. User Profile ──────────────────────────────────────────────────── */
  function _userProfileHTML(user) {
    var html = ['<div class="st-section">'];

    html.push(
      '<div class="st-section-header">',
        '<div class="st-section-icon" style="background:var(--brand-bg);color:var(--brand);">👤</div>',
        '<span class="st-section-title">Your Profile</span>',
      '</div>'
    );

    if (!user) {
      html.push(
        '<div class="pm-empty">',
          '<strong>Not signed in</strong>',
          'Sign in to see your profile.',
        '</div>'
      );
    } else {
      var displayName = user.name || (user.firstName + ' ' + user.lastName);
      var initials = (displayName || '??').split(' ').map(function(p) { return (p || '')[0] || ''; }).join('').toUpperCase().slice(0, 2) || '?';
      html.push(
        '<div class="st-profile-card">',
          '<div class="st-profile-avatar">', esc(initials), '</div>',
          '<div class="st-profile-info">',
            '<div class="st-profile-name">', esc(displayName), '</div>',
            '<div class="st-profile-email">', esc(user.email || ''), '</div>',
            '<span class="st-role-badge ', user.role === 'admin' ? 'admin' : 'user', '">', esc(user.role), '</span>',
          '</div>',
          '<div class="st-profile-actions">',
            '<button class="pm-btn small" data-st-act="change-pin">🔐 Change Password</button>',
            '<button class="pm-btn small" data-st-act="refresh-cache">🔄 Refresh Cache</button>',
            '<button class="pm-btn small danger" data-st-act="sign-out">Sign Out</button>',
          '</div>',
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

    var themeButtons = ['system', 'light', 'dark'].map(function (t) {
      var active = t === theme ? ' st-seg-active' : '';
      return '<button data-st-act="set-theme" data-st-val="' + t + '" class="' + active + '">' +
        t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
    }).join('');

    var tileButtons = ['compact', 'default', 'large'].map(function (t) {
      var active = t === tileSize ? ' st-seg-active' : '';
      return '<button data-st-act="set-tile-size" data-st-val="' + t + '" class="' + active + '">' +
        t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
    }).join('');

    var tempUnitButtons = ['F', 'C'].map(function (t) {
      var active = t === tempUnit ? ' st-seg-active' : '';
      return '<button data-st-act="set-tempunit" data-st-val="' + t + '" class="' + active + '">°' + t + '</button>';
    }).join('');

    return [
      '<div class="st-section">',
        '<div class="st-section-header">',
          '<div class="st-section-icon" style="background:rgba(245,158,11,0.1);color:#f59e0b;">🎨</div>',
          '<span class="st-section-title">Appearance</span>',
        '</div>',
        '<div class="st-setting-row">',
          '<div>',
            '<div class="st-setting-label">Theme</div>',
            '<div class="st-setting-hint">Choose light, dark, or follow your system</div>',
          '</div>',
          '<div class="st-segmented">', themeButtons, '</div>',
        '</div>',
        '<div class="st-setting-row">',
          '<div>',
            '<div class="st-setting-label">Tile Size</div>',
            '<div class="st-setting-hint">Adjust the dashboard tile size</div>',
          '</div>',
          '<div class="st-segmented">', tileButtons, '</div>',
        '</div>',
        '<div class="st-setting-row">',
          '<div>',
            '<div class="st-setting-label">Temperature</div>',
            '<div class="st-setting-hint">Fahrenheit or Celsius</div>',
          '</div>',
          '<div class="st-segmented">', tempUnitButtons, '</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  /* ── 2.5 Projects (admin only) ────────────────────────────────────────── */
  function _projectsHTML() {
    return [
      '<div class="st-section" id="st-projects">',
        '<div class="st-section-header">',
          '<div class="st-section-icon" style="background:rgba(16,185,129,0.1);color:#10b981;">📁</div>',
          '<span class="st-section-title">Projects</span>',
          '<button class="pm-btn small primary" data-st-act="proj-add" id="st-proj-add">+ Add Project</button>',
        '</div>',
        '<div class="st-project-list" id="st-proj-list">',
          '<div class="pm-empty">Loading projects…</div>',
        '</div>',
      '</div>',
    ].join('');
  }

  /* ── 3. Data ────────────────────────────────────────────────────────────── */
  function _dataHTML() {
    var isOwner = _isOwner();
    return [
      '<div class="st-section">',
        '<div class="st-section-header">',
          '<div class="st-section-icon" style="background:rgba(16,185,129,0.1);color:#10b981;">💾</div>',
          '<span class="st-section-title">Data</span>',
        '</div>',
        isOwner ? '<div class="st-setting-row">' +
          '<div>' +
            '<div class="st-setting-label">Export Project Data</div>' +
            '<div class="st-setting-hint">Download all records for the current project as JSON</div>' +
          '</div>' +
          '<button class="pm-btn small" data-st-act="export-data">Export JSON</button>' +
        '</div>' +
        '<div class="st-danger-zone">' +
          '<div>' +
            '<div class="st-danger-zone-label">Clear Project Data</div>' +
            '<div style="font-size:0.78rem;color:var(--muted);margin-top:2px;">Permanently delete all records for the current project</div>' +
          '</div>' +
          '<button class="pm-btn small danger" data-st-act="clear-data">Clear All Data</button>' +
        '</div>'
        : '<div class="st-setting-row">' +
          '<div class="st-setting-label" style="color:var(--muted);">Data export and clearing</div>' +
          '<div class="st-setting-hint">Only the account owner can export or clear project data</div>' +
        '</div>',
      '</div>'
    ].join('');
  }

  /* ── 4. About ───────────────────────────────────────────────────────────── */
  function _aboutHTML() {
    return [
      '<div class="st-section">',
        '<div class="st-section-header">',
          '<div class="st-section-icon" style="background:rgba(107,114,128,0.1);color:#6b7280;">ℹ️</div>',
          '<span class="st-section-title">About</span>',
        '</div>',
        '<div class="st-about">',
          '<div class="st-about-version">Align v1.0</div>',
          '<div>Build date: June 2025</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * WIRING — event delegation on the container
   * ════════════════════════════════════════════════════════════════════════════ */

  function _wire() {
    var c = ui.container;
    if (!c) return;

    // Remove old listener before adding — prevents stacking on re-renders
    c.removeEventListener('click', _onClick);
    c.addEventListener('click', _onClick);

    // Load projects list (admin only)
    if (_isOwner()) _loadProjects();
  }

  function _onClick(e) {
    var target = e.target;
    // Walk up to find the [data-st-act] button or link
    var el = target.closest('[data-st-act]');
    if (!el) return;

    var act = el.getAttribute('data-st-act');
    var val = el.getAttribute('data-st-val');

    switch (act) {

      /* ── Sign Out ─────────────────────────────────────────────────────── */
      case 'sign-out':
        e.preventDefault();
        if (global.AlignAuth) {
          global.AlignAuth.signOut();
          // Refresh to show sign-in screen
          _paint();
          _wire();
        }
        break;

      /* ── Refresh Cache ────────────────────────────────────────────────── */
      case 'refresh-cache':
        e.preventDefault();
        if ('caches' in window) {
          caches.keys().then(function(names) {
            for (var i = 0; i < names.length; i++) caches.delete(names[i]);
          }).then(function() {
            // Also unregister service workers
            if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
              navigator.serviceWorker.getRegistrations().then(function(regs) {
                for (var r = 0; r < regs.length; r++) regs[r].unregister();
                window.location.reload(true);
              });
            } else {
              window.location.reload(true);
            }
          });
        } else {
          window.location.reload(true);
        }
        break;

      /* ── Sign Out Everywhere ──────────────────────────────────────────── */
      case 'sign-out-all':
        e.preventDefault();
        if (global.AlignAuth && global.AlignAuth.signOutAll) {
          global.AlignAuth.signOutAll();
          // Refresh to show sign-in screen
          _paint();
          _wire();
        } else if (global.AlignAuth) {
          // Fallback: just sign out locally
          global.AlignAuth.signOut();
          _paint();
          _wire();
        }
        break;

      /* ── Change PIN ───────────────────────────────────────────────────── */
      case 'change-pin':
        e.preventDefault();
        _openPinDialog();
        break;

      /* ── Theme ────────────────────────────────────────────────────────── */
      case 'set-theme':
        e.preventDefault();
        if (val) {
          setTheme(val);
          window._invalidateTileCache('settings');
          _paint();
          _wire();
        }
        break;

      /* ── Tile Size ────────────────────────────────────────────────────── */
      case 'set-tile-size':
        e.preventDefault();
        if (val) {
          setTileSize(val);
          _refreshTileGrid(val);
          window._invalidateTileCache('settings');
          _paint();
          _wire();
        }
        break;

      /* ── Temperature Unit ──────────────────────────────────────────────── */
      case 'set-tempunit':
        e.preventDefault();
        if (val) {
          setTempUnit(val);
          window._invalidateTileCache('settings');
          // Re-render weather instantly from cached data with new unit
          try { localStorage.removeItem('align_weather_html_v2'); } catch(e) {}
          if (window.__weatherData) window._renderWeatherCards(window.__weatherData);
          _paint();
          _wire();
        }
        break;

      /* ── Export Data ──────────────────────────────────────────────────── */
      case 'export-data':
        e.preventDefault();
        if (!_isOwner()) { alert('Only the account owner can export project data.'); return; }
        _exportData();
        break;

      /* ── Clear Data ───────────────────────────────────────────────────── */
      case 'clear-data':
        e.preventDefault();
        if (!_isOwner()) { alert('Only the account owner can clear project data.'); return; }
        _clearData();
        break;

      /* ── Projects ──────────────────────────────────────────────────── */
      case 'proj-add':
        e.preventDefault();
        _showProjectModal();
        break;
      case 'proj-edit':
        e.preventDefault();
        _showProjectModal(el.getAttribute('data-proj-id'));
        break;
      case 'proj-delete':
        e.preventDefault();
        _deleteProject(el.getAttribute('data-proj-id'), el.getAttribute('data-proj-name'));
        break;
      case 'proj-invites':
        e.preventDefault();
        _showInvitesModal(el.getAttribute('data-proj-id'), el.getAttribute('data-proj-name'));
        break;
    }
  }

  /* ── Refresh tile grid when tile size changes ──────────────────────────── */
  function _refreshTileGrid(size) {
    var grid = document.querySelector('.tile-grid');
    if (!grid) return;

    // Remove all size classes
    grid.classList.remove('tile-grid--compact', 'tile-grid--large');

    if (size === 'compact') {
      grid.classList.add('tile-grid--compact');
    } else if (size === 'large') {
      grid.classList.add('tile-grid--large');
    }
    // 'default' — no extra class
  }

  /* ── Owner check (restrict destructive data operations) ────────────────── */
  function _isOwner() {
    var auth = global.AlignAuth;
    if (!auth) return false;
    var user = auth.getActiveUser();
    if (!user) return false;
    return user.email === 'admin@align.local';
  }

  /* ── Projects ──────────────────────────────────────────────────────────── */

  function _loadProjects() {
    var token = localStorage.getItem('align-token') || '';
    fetch('/api/projects', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.json(); })
      .then(function(d) { _renderProjectList(d.projects || []); })
      .catch(function() { _renderProjectList([]); });
  }

  function _renderProjectList(projects) {
    var list = document.getElementById('st-proj-list');
    if (!list) return;
    if (!projects.length) {
      list.innerHTML = '<div class="pm-empty">No projects yet. Click "+ Add Project" to create one.</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      h += '<div class="st-proj-card">';
      h += '<div class="st-proj-image">';
      if (p.image_file_id) {
        h += '<img src="/api/files/' + esc(p.image_file_id) + '" alt="" onerror="this.style.display=\'none\'">';
      }
      h += '<span class="st-proj-initial">' + esc((p.name || 'P')[0].toUpperCase()) + '</span>';
      h += '</div>';
      h += '<div class="st-proj-info">';
      h += '<div class="st-proj-name">' + esc(p.name) + '</div>';
      h += '<div class="st-proj-meta">' + (p.member_count || 0) + ' member' + (p.member_count !== 1 ? 's' : '') + (p.pending_count ? ', ' + p.pending_count + ' pending' : '') + '</div>';
      if (p.description) h += '<div class="st-proj-desc">' + esc(p.description) + '</div>';
      h += '</div>';
      h += '<div class="st-proj-actions">';
      h += '<button class="pm-btn small" data-st-act="proj-edit" data-proj-id="' + esc(p.id) + '">Edit</button>';
      if (p.pending_count) {
        h += '<button class="pm-btn small" data-st-act="proj-invites" data-proj-id="' + esc(p.id) + '" data-proj-name="' + esc(p.name) + '">Invites (' + p.pending_count + ')</button>';
      }
      h += '<button class="pm-btn small danger" data-st-act="proj-delete" data-proj-id="' + esc(p.id) + '" data-proj-name="' + esc(p.name) + '">Delete</button>';
      h += '</div>';
      h += '</div>';
    }
    list.innerHTML = h;
  }

  function _showProjectModal(projId) {
    var isEdit = !!projId;
    // Find existing project data if editing
    var proj = null;
    if (isEdit) {
      var token = localStorage.getItem('align-token') || '';
      fetch('/api/projects/' + encodeURIComponent(projId), { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(d) { proj = d.project; _renderModal(); })
        .catch(function() { _renderModal(); });
    } else {
      _renderModal();
    }

    function _renderModal() {
      var name = proj ? proj.name : '';
      var desc = proj ? (proj.description || '') : '';
      var addr = proj ? (proj.address || '') : '';
      var pnum = proj ? (proj.project_number || '') : '';
      var ptype = proj ? (proj.project_type || '') : '';
      var sqft = proj ? (proj.square_footage || '') : '';
      var sdate = proj ? (proj.start_date || '') : '';
      var tcomp = proj ? (proj.target_completion || '') : '';
      var html = '<div class="st-modal-mask" id="st-proj-modal-mask">';
      html += '<div class="st-modal">';
      html += '<div class="st-modal-header">' + (isEdit ? 'Edit' : 'New') + ' Project</div>';
      html += '<div class="st-modal-body">';
      html += '<label class="st-field-label">Project Name</label>';
      html += '<input class="st-input" id="st-proj-name" value="' + esc(name) + '" placeholder="e.g. 1527 York Ave">';
      html += '<label class="st-field-label">Project Number</label>';
      html += '<input class="st-input" id="st-proj-number" value="' + esc(pnum) + '" placeholder="e.g. 1527-YORK">';
      html += '<label class="st-field-label">Address</label>';
      html += '<input class="st-input" id="st-proj-address" value="' + esc(addr) + '" placeholder="Full project address">';
      html += '<label class="st-field-label">Project Type</label>';
      html += '<select class="st-input" id="st-proj-type">';
      var types = ['','New Construction','Renovation','Tenant Improvement','Addition','Design-Build','Infrastructure','Other'];
      for (var ti = 0; ti < types.length; ti++) {
        html += '<option value="' + esc(types[ti]) + '"' + (ptype === types[ti] ? ' selected' : '') + '>' + (types[ti] || '— Select —') + '</option>';
      }
      html += '</select>';
      html += '<div style="display:flex;gap:12px;">';
      html += '<div style="flex:1;"><label class="st-field-label">Square Footage</label>';
      html += '<input class="st-input" id="st-proj-sqft" type="number" value="' + esc(sqft) + '" placeholder="Total SF" min="0"></div>';
      html += '<div style="flex:1;"><label class="st-field-label">Start Date</label>';
      html += '<input class="st-input" id="st-proj-start" type="date" value="' + esc(sdate) + '"></div>';
      html += '</div>';
      html += '<label class="st-field-label">Target Completion</label>';
      html += '<input class="st-input" id="st-proj-target" type="date" value="' + esc(tcomp) + '">';
      html += '<label class="st-field-label">Description</label>';
      html += '<textarea class="st-input" id="st-proj-desc" rows="2" placeholder="Optional notes">' + esc(desc) + '</textarea>';
      html += '<label class="st-field-label">Project Image</label>';
      html += '<input type="file" id="st-proj-image" accept="image/*" style="display:block;margin-bottom:12px;">';
      if (proj && proj.image_file_id) {
        html += '<div style="margin-bottom:12px;"><img src="/api/files/' + esc(proj.image_file_id) + '" style="max-width:120px;max-height:80px;border-radius:6px;"></div>';
      }
      html += '</div>';
      html += '<div class="st-modal-actions">';
      html += '<button class="pm-btn" id="st-proj-cancel">Cancel</button>';
      html += '<button class="pm-btn primary" id="st-proj-save">' + (isEdit ? 'Save Changes' : 'Create Project') + '</button>';
      html += '</div>';
      html += '</div></div>';

      var existing = document.getElementById('st-proj-modal-mask');
      if (existing) existing.remove();
      var div = document.createElement('div');
      div.innerHTML = html;
      document.body.appendChild(div.firstElementChild);

      document.getElementById('st-proj-cancel').addEventListener('click', function() {
        var m = document.getElementById('st-proj-modal-mask');
        if (m) m.remove();
      });
      document.getElementById('st-proj-save').addEventListener('click', function() {
        _saveProject(projId);
      });
      // Close on mask click
      document.getElementById('st-proj-modal-mask').addEventListener('click', function(e) {
        if (e.target === this) this.remove();
      });
    }
  }

  function _saveProject(projId) {
    var name = (document.getElementById('st-proj-name') || {}).value || '';
    name = name.trim();
    if (!name) { alert('Project name is required.'); return; }
    var desc = (document.getElementById('st-proj-desc') || {}).value || '';
    var addr = (document.getElementById('st-proj-address') || {}).value || '';
    var pnum = (document.getElementById('st-proj-number') || {}).value || '';
    var ptype = (document.getElementById('st-proj-type') || {}).value || '';
    var sqft = (document.getElementById('st-proj-sqft') || {}).value || '';
    var sdate = (document.getElementById('st-proj-start') || {}).value || '';
    var tcomp = (document.getElementById('st-proj-target') || {}).value || '';
    var token = localStorage.getItem('align-token') || '';
    var imgInput = document.getElementById('st-proj-image');
    var hasImage = imgInput && imgInput.files && imgInput.files.length > 0;

    var body = {
      name: name, description: desc, address: addr,
      project_number: pnum, project_type: ptype,
      square_footage: sqft, start_date: sdate, target_completion: tcomp
    };

    var savePromise;
    if (projId) {
      savePromise = fetch('/api/projects/' + encodeURIComponent(projId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
    } else {
      savePromise = fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
    }

    savePromise.then(function(r) { return r.json(); }).then(function(d) {
      var pid = d.project ? d.project.id : projId;
      // Upload image if selected
      if (hasImage && pid) {
        var fd = new FormData();
        fd.append('image', imgInput.files[0]);
        return fetch('/api/projects/' + encodeURIComponent(pid) + '/image', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: fd
        }).then(function() { return pid; });
      }
      return pid;
    }).then(function() {
      var m = document.getElementById('st-proj-modal-mask');
      if (m) m.remove();
      _loadProjects(); // refresh list
    }).catch(function(err) {
      alert('Failed to save project: ' + (err && err.message || err));
    });
  }

  function _deleteProject(projId, name) {
    if (!confirm('Delete "' + (name || 'project') + '"? This removes all project data including files and records. This cannot be undone.')) return;
    var token = localStorage.getItem('align-token') || '';
    fetch('/api/projects/' + encodeURIComponent(projId), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) { return r.json(); })
      .then(function() { _loadProjects(); })
      .catch(function(err) { alert('Failed to delete: ' + (err && err.message || err)); });
  }

  /* ── Invites modal ──────────────────────────────────────────────────── */
  function _showInvitesModal(projId, projName) {
    var token = localStorage.getItem('align-token') || '';
    fetch('/api/projects/' + encodeURIComponent(projId) + '/invites', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var invites = d.invites || [];
        var html = '<div class="st-modal-mask" id="st-invites-modal-mask">';
        html += '<div class="st-modal">';
        html += '<div class="st-modal-header">Pending Invites — ' + esc(projName) + '</div>';
        html += '<div class="st-modal-body">';
        if (invites.length === 0) {
          html += '<p style="color:var(--muted);text-align:center;">No pending invites.</p>';
        } else {
          html += '<div class="st-invite-list">';
          invites.forEach(function(inv) {
            html += '<div class="st-invite-card">';
            html += '<div class="st-invite-info">';
            html += '<strong>' + esc(inv.name || inv.email) + '</strong>';
            html += '<span style="color:var(--muted);">' + esc(inv.email) + ' — ' + esc(inv.role) + '</span>';
            html += '<span style="font-size:0.75rem;color:var(--muted);">Code: ' + esc(inv.token) + ' · Expires ' + fmtDate(inv.expires_at) + '</span>';
            html += '</div>';
            html += '<div class="st-invite-actions">';
            html += '<button class="pm-btn small" data-inv-act="resend" data-inv-id="' + esc(inv.id) + '">Resend</button>';
            html += '<button class="pm-btn small danger" data-inv-act="cancel" data-inv-id="' + esc(inv.id) + '">Cancel</button>';
            html += '</div>';
            html += '</div>';
          });
          html += '</div>';
        }
        html += '</div>';
        html += '<div class="st-modal-footer"><button class="pm-btn" id="st-invites-close">Close</button></div>';
        html += '</div></div>';

        var overlay = document.createElement('div');
        overlay.id = 'st-invites-overlay';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        document.getElementById('st-invites-close').addEventListener('click', function() { overlay.remove(); });
        overlay.querySelector('.st-modal-mask').addEventListener('click', function(e) {
          if (e.target === this) overlay.remove();
        });

        overlay.querySelectorAll('[data-inv-act]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var act = this.getAttribute('data-inv-act');
            var invId = this.getAttribute('data-inv-id');
            if (act === 'cancel') {
              if (!confirm('Cancel this invite?')) return;
              fetch('/api/invites/' + encodeURIComponent(invId) + '/cancel', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
              }).then(function() { overlay.remove(); _loadProjects(); });
            } else if (act === 'resend') {
              fetch('/api/invites/' + encodeURIComponent(invId) + '/resend', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
              }).then(function(r) { return r.json(); })
                .then(function(d) { alert(d.ok ? 'Invite resent!' : (d.error || 'Failed')); });
            }
          });
        });
      });
  }

  /* ── Sub-view helper (uses navigation stack in script.js) ────────────── */
  function _showSubView(title, renderFn) {
    if (window._pushSettingsSubview) {
      window._pushSettingsSubview(title, renderFn);
    }
  }

  /* ── PIN Change Dialog ─────────────────────────────────────────────────── */
  function _openPinDialog() {
    var auth = global.AlignAuth;
    var user = auth ? auth.getActiveUser() : null;
    if (!user) return;

    // Build overlay
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

    // Focus the first input
    setTimeout(function () {
      var inp = document.getElementById('st-pin-current');
      if (inp) inp.focus();
    }, 100);

    // Close on backdrop click
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) _closePinDialog();
    });

    // Cancel button
    var cancelBtn = document.getElementById('st-pin-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', _closePinDialog);

    // Save button
    var saveBtn = document.getElementById('st-pin-save');
    if (saveBtn) saveBtn.addEventListener('click', _savePin);

    // Keyboard: Enter to save, Escape to cancel
    overlay.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        _closePinDialog();
      } else if (ev.key === 'Enter') {
        _savePin();
      }
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

    var curEl     = document.getElementById('st-pin-current');
    var newEl     = document.getElementById('st-pin-new');
    var confirmEl = document.getElementById('st-pin-confirm');
    var errEl     = document.getElementById('st-pin-error');

    var currentPin = (curEl ? curEl.value.trim() : '');
    var newPin     = (newEl ? newEl.value.trim() : '');
    var confirmPin = (confirmEl ? confirmEl.value.trim() : '');

    // Validate
    if (!currentPin || !newPin) {
      _showPinError('Enter current and new password.');
      return;
    }
    if (newPin.length < 8) {
      _showPinError('New password must be at least 8 characters.');
      return;
    }
    if (newPin !== confirmPin) {
      _showPinError('Passwords do not match.');
      return;
    }

    // Save
    try {
      auth.updateUser(user.id, { password: newPin });
      _closePinDialog();
      // Re-render to reflect any change
      _paint();
      _wire();
    } catch (e) {
      _showPinError(e.message);
    }
  }

  function _showPinError(msg) {
    var errEl = document.getElementById('st-pin-error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
  }

  /* ── Export Data ────────────────────────────────────────────────────────── */
  function _exportData() {
    var storage = S();
    if (!storage) {
      alert('Storage is not available.');
      return;
    }

    var active = storage.getActiveProject();
    if (!active) {
      alert('No active project selected. Please select a project first.');
      return;
    }

    // Gather all categories from storage
    var categories = storage.categories || [
      'drawings', 'daily-logs', 'specs', 'rfis',
      'punchlist', 'schedule', 'budget', 'contacts',
      'photos', 'tasks', 'procurement', 'files', 'settings'
    ];

    var exportData = {
      project: {
        id: active.id,
        name: active.name,
        address: active.address || '',
        createdAt: active.createdAt,
        exportedAt: new Date().toISOString()
      },
      records: {}
    };

    categories.forEach(function (cat) {
      try {
        var records = storage.listRecords(active.id, cat);
        if (records && records.length) {
          exportData.records[cat] = records;
        }
      } catch (e) {
        // Category may not exist — skip
      }
    });

    var json = JSON.stringify(exportData, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    // Sanitize filename
    var safeName = (active.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = 'align-export-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── Clear Project Data ─────────────────────────────────────────────────── */
  function _clearData() {
    var storage = S();
    if (!storage) {
      alert('Storage is not available.');
      return;
    }

    var active = storage.getActiveProject();
    if (!active) {
      alert('No active project selected.');
      return;
    }

    if (!confirm(
      '⚠️  This will permanently delete ALL records for "' + active.name + '".\n\n' +
      'This includes drawings, daily logs, RFIs, punchlist, schedule, budget,\n' +
      'contacts, photos, tasks, procurement, files, and specs.\n\n' +
      'The project itself will be kept. This action cannot be undone.\n\n' +
      'Are you sure?'
    )) {
      return;
    }

    if (!confirm('Final confirmation: Delete all data for "' + active.name + '"?')) {
      return;
    }

    var categories = storage.categories || [
      'drawings', 'daily-logs', 'specs', 'rfis',
      'punchlist', 'schedule', 'budget', 'contacts',
      'photos', 'tasks', 'procurement', 'files', 'settings'
    ];

    categories.forEach(function (cat) {
      try {
        storage.clearCategory(active.id, cat);
      } catch (e) {
        // Skip — category may not have a clear method or may not exist
      }
    });

    alert('All data for "' + active.name + '" has been cleared.');
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * INIT — apply saved theme on load
   * ════════════════════════════════════════════════════════════════════════════ */

  // Apply theme immediately on script load
  applyTheme(getTheme());

  // Apply tile size immediately on script load
  try {
    var savedTileSize = getTileSize();
    if (savedTileSize && savedTileSize !== 'default') {
      var grid = document.querySelector('.tile-grid');
      if (grid) {
        if (savedTileSize === 'compact') grid.classList.add('tile-grid--compact');
        else if (savedTileSize === 'large') grid.classList.add('tile-grid--large');
      }
    }
  } catch (e) { /* silent */ }

  // Re-apply theme when system preference changes (if set to 'system')
  try {
    var darkQuery = global.matchMedia('(prefers-color-scheme: dark)');
    if (darkQuery && darkQuery.addEventListener) {
      darkQuery.addEventListener('change', function () {
        if (getTheme() === 'system') applyTheme('system');
      });
    }
  } catch (e) { /* silent */ }

  /* ── Public API ───────────────────────────────────────────────── */
  window.AlignSettings = {
    render: render
  };

})(window);
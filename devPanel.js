/* devPanel.js — Align PM Dev Panel (super admin only)
 * Activated by 7-tap logo gesture or #/dev hash
 * Shows: role override, error log, DB stats, cache control
 */

(function () {
  'use strict';

  var _panel = null;
  var _visible = false;

  function enabled() {
    return window.Store && window.Store.get('user') && window.Store.get('user').role === 'admin';
  }

  function toggle() {
    if (!enabled()) return;
    if (_visible) { hide(); return; }
    show();
  }

  function show() {
    if (_panel) { _panel.style.display = ''; _visible = true; _refresh(); return; }
    _panel = document.createElement('div');
    _panel.className = 'dev-panel';
    _panel.innerHTML =
      '<div class="dev-head">' +
        '<strong>Dev Panel</strong>' +
        '<button class="dev-close" id="dev-close">×</button>' +
      '</div>' +
      '<div class="dev-body">' +
        '<div class="dev-section">' +
          '<label class="dev-label">Role Override</label>' +
          '<select id="dev-role-override" class="dev-select">' +
            '<option value="">(actual role)</option>' +
            '<option value="admin">Admin</option>' +
            '<option value="user">User</option>' +
          '</select>' +
        '</div>' +
        '<div class="dev-section">' +
          '<label class="dev-label">Session</label>' +
          '<pre id="dev-session" class="dev-pre"></pre>' +
        '</div>' +
        '<div class="dev-section">' +
          '<label class="dev-label">Error Log (recent)</label>' +
          '<pre id="dev-errors" class="dev-pre" style="max-height:200px;overflow:auto"></pre>' +
        '</div>' +
        '<div class="dev-actions">' +
          '<button class="dev-btn" id="dev-clear-cache">Clear Cache</button>' +
          '<button class="dev-btn" id="dev-reload">Reload App</button>' +
          '<button class="dev-btn dev-btn-danger" id="dev-signout">Sign Out</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(_panel);
    _visible = true;
    _wire();
    _refresh();
  }

  function hide() {
    if (_panel) _panel.style.display = 'none';
    _visible = false;
  }

  function _wire() {
    document.getElementById('dev-close').onclick = hide;
    document.getElementById('dev-role-override').onchange = function () {
      var val = this.value;
      if (val) localStorage.setItem('apm_dev_role', val);
      else localStorage.removeItem('apm_dev_role');
      alert('Role override applied. Reload to take effect.');
    };
    document.getElementById('dev-clear-cache').onclick = function () {
      var keys = Object.keys(localStorage).filter(function (k) {
        return k.indexOf('apm_') === 0 || k.indexOf('align') === 0;
      });
      keys.forEach(function (k) { localStorage.removeItem(k); });
      alert('Cleared ' + keys.length + ' cache entries.');
    };
    document.getElementById('dev-reload').onclick = function () { location.reload(); };
    document.getElementById('dev-signout').onclick = function () {
      if (window.Store) window.Store.clear();
      location.reload();
    };
    document.getElementById('dev-role-override').value = localStorage.getItem('apm_dev_role') || '';
  }

  function _refresh() {
    if (!_visible || !_panel) return;

    // Session info
    var user = window.Store && window.Store.get('user');
    var el = document.getElementById('dev-session');
    if (el && user) {
      el.textContent = JSON.stringify({ id: user.id, email: user.email, role: user.role, name: user.name }, null, 2);
    }

    // Fetch error log from server
    if (window.Api && window.Api.get) {
      window.Api.get('/api/client-errors?limit=20').then(function (data) {
        var errEl = document.getElementById('dev-errors');
        if (!errEl) return;
        var items = data && data.items ? data.items : (Array.isArray(data) ? data : []);
        errEl.textContent = items.map(function (e) {
          return (e.ts || '') + ' [' + (e.scope || '?') + '] ' + (e.message || '');
        }).join('\n') || '(none)';
      }).catch(function () {
        var errEl = document.getElementById('dev-errors');
        if (errEl) errEl.textContent = '(could not fetch)';
      });
    }
  }

  /* 7-tap logo gesture */
  (function () {
    var taps = 0, timer = null;
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#si-logo') && !e.target.closest('.ps-logo') && !e.target.closest('.auth-logo-light') && !e.target.closest('.auth-logo-dark')) return;
      taps++;
      clearTimeout(timer);
      timer = setTimeout(function () { taps = 0; }, 3000);
      if (taps >= 7) { taps = 0; toggle(); }
    });
  })();

  /* #/dev hash */
  if (location.hash === '#/dev' || location.hash === '#dev') {
    setTimeout(function () { if (enabled()) { show(); location.hash = '#/'; } }, 500);
  }

  window.DevPanel = {
    toggle: toggle,
    show: show,
    hide: hide,
    enabled: enabled
  };
})();

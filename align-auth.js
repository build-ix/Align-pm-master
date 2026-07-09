/* align-auth.js
 * ─────────────────────────────────────────────────────────────
 * Align — Authentication (localStorage fallback)
 *
 * This is the OFFLINE fallback. At boot, align-boot.js pings the
 * server; if the API is reachable it replaces window.AlignAuth
 * with the API-backed version from align-api.js.
 *
 * Storage: localStorage (align.users.v1, align.active-user)
 * API:     window.AlignAuth (see bottom for full surface)
 */

(function (global) {
  'use strict';

  // If the API engine already registered, skip — boot will handle it
  if (global.__AlignApiEngine) return;

  var USERS_KEY   = 'align.users.v1';
  var SESSION_KEY = 'align.active-user';

  /* ── Helpers ──────────────────────────────────────────────── */
  function uid() {
    return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lsGet(key) {
    try { var r = global.localStorage.getItem(key); return r ? JSON.parse(r) : null; }
    catch (e) { return null; }
  }

  function lsSet(key, val) {
    try { global.localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  function fireChange() {
    try { document.dispatchEvent(new CustomEvent('align-auth-change')); } catch (_) {}
  }

  function loadUsers() {
    var d = lsGet(USERS_KEY);
    return Array.isArray(d) ? d : [];
  }

  function saveUsers(arr) {
    lsSet(USERS_KEY, arr);
  }

  /* ── User CRUD ────────────────────────────────────────────── */
  function getUserById(id) {
    var users = loadUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) return users[i];
    }
    return null;
  }

  function hashPin(pin) {
    // djb2 — not cryptographic; acceptable for offline localStorage fallback
    var h = 5381;
    for (var i = 0; i < pin.length; i++) h = ((h << 5) + h) + pin.charCodeAt(i);
    return String(h & 0x7fffffff);
  }

  /* ── Public API ───────────────────────────────────────────── */
  var AlignAuth = {
    init: function () {
      var active = this.getActiveUser();
      if (active) return; // already signed in
      // First run: no users → create admin
      var users = loadUsers();
      if (users.length === 0) {
        var adminId = uid();
        var admin = {
          id: adminId, username: 'admin', email: 'admin@align.local',
          name: 'Admin', pin_hash: hashPin('0780'), role: 'admin',
          status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        saveUsers([admin]);
        lsSet(SESSION_KEY, adminId);
        fireChange();
        return;
      }
      // Show sign-in overlay
      this._showOverlay();
    },

    _showOverlay: function () {
      if (document.getElementById('auth-overlay')) return;
      var users = loadUsers();
      var opts = users.map(function (u) {
        return '<option value="' + u.id + '">' + esc(u.name) + ' (' + esc(u.role) + ')</option>';
      }).join('');

      var html =
        '<div id="auth-overlay" style="position:fixed;inset:0;z-index:1000;background:var(--bg,#f5f5f5);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;">' +
          '<div style="background:var(--card,#fff);padding:32px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12);min-width:320px;max-width:400px;">' +
            '<h2 style="margin:0 0 8px;font-size:1.25rem;">Sign In to Align</h2>' +
            '<p style="margin:0 0 20px;color:var(--muted,#777);font-size:0.85rem;">Select your name and enter your PIN.</p>' +
            '<select id="auth-user-select" style="width:100%;padding:10px;border:1px solid var(--line,#ddd);border-radius:6px;margin-bottom:12px;font-size:1rem;">' +
              '<option value="">— Choose account —</option>' + opts +
            '</select>' +
            '<input id="auth-pin-input" type="password" inputmode="numeric" maxlength="4" placeholder="4-digit PIN" style="width:100%;padding:10px;border:1px solid var(--line,#ddd);border-radius:6px;margin-bottom:8px;font-size:1rem;box-sizing:border-box;">' +
            '<p id="auth-msg" style="color:#c00;font-size:0.8rem;min-height:1.2em;margin:0 0 12px;"></p>' +
            '<button id="auth-signin-btn" style="width:100%;padding:12px;background:#111;color:#fff;border:none;border-radius:6px;font-size:1rem;cursor:pointer;">Sign In</button>' +
          '</div>' +
        '</div>';

      var overlay = document.createElement('div');
      overlay.innerHTML = html;
      document.body.appendChild(overlay.firstElementChild);

      var self = this;
      document.getElementById('auth-signin-btn').addEventListener('click', function () {
        var sel = document.getElementById('auth-user-select');
        var pin = document.getElementById('auth-pin-input');
        var msg = document.getElementById('auth-msg');
        var uid_ = sel.value;
        if (!uid_) { msg.textContent = 'Please select your account.'; return; }
        if (!pin.value || pin.value.length !== 4) { msg.textContent = 'Enter your 4-digit PIN.'; return; }
        var user = getUserById(uid_);
        if (!user || hashPin(pin.value) !== user.pin_hash) {
          msg.textContent = 'Invalid PIN.';
          return;
        }
        lsSet(SESSION_KEY, user.id);
        var el = document.getElementById('auth-overlay');
        if (el) el.remove();
        fireChange();
      });
      pinEl = document.getElementById('auth-pin-input');
      if (pinEl) {
        pinEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') document.getElementById('auth-signin-btn').click();
        });
      }
    },

    getActiveUser: function () {
      var uid_ = lsGet(SESSION_KEY);
      return uid_ ? getUserById(uid_) : null;
    },

    isAdmin: function () {
      var u = this.getActiveUser();
      return u && u.role === 'admin';
    },

    listUsers: function () {
      return loadUsers();
    },

    createUser: function (opts) {
      if (!this.isAdmin()) throw new Error('Admin only');
      var users = loadUsers();
      var id = uid(), ts = new Date().toISOString();
      var user = {
        id: id, username: opts.username || '', email: opts.email || '',
        name: opts.name || '', pin_hash: hashPin(opts.pin || '0000'),
        role: opts.role || 'user', status: 'active',
        created_at: ts, updated_at: ts
      };
      users.push(user);
      saveUsers(users);
      return user;
    },

    updateUser: function (id, patches) {
      var users = loadUsers();
      for (var i = 0; i < users.length; i++) {
        if (users[i].id === id) {
          Object.keys(patches).forEach(function (k) {
            if (k === 'pin') users[i].pin_hash = hashPin(patches[k]);
            else users[i][k] = patches[k];
          });
          users[i].updated_at = new Date().toISOString();
          saveUsers(users);
          return users[i];
        }
      }
      return null;
    },

    deleteUser: function (id) {
      if (!this.isAdmin()) return false;
      var users = loadUsers();
      var idx = -1;
      for (var i = 0; i < users.length; i++) { if (users[i].id === id) { idx = i; break; } }
      if (idx === -1) return false;
      users.splice(idx, 1);
      saveUsers(users);
      return true;
    },

    signIn: function (email, pin) {
      var users = loadUsers();
      var h = hashPin(pin);
      for (var i = 0; i < users.length; i++) {
        if (users[i].email === email && users[i].pin_hash === h) {
          lsSet(SESSION_KEY, users[i].id);
          fireChange();
          return users[i];
        }
      }
      throw new Error('Invalid email or PIN');
    },

    signOut: function () {
      global.localStorage.removeItem(SESSION_KEY);
      fireChange();
    },

    loadPermissions: function (_email) {
      // Offline fallback: all sections visible
      var perms = {};
      return perms;
    }
  };

  global.AlignAuth = AlignAuth;

})(window);

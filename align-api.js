/* align-api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — API Adapter (Bridge between frontend and backend)
 *
 * WHAT THIS DOES:
 *   When the backend server is running, this replaces localStorage with
 *   real API calls to your PC. Same API as AlignStorage + AlignAuth,
 *   so the rest of the app doesn't need to change.
 *
 * HOW IT WORKS:
 *   1. Checks if the backend is reachable at /api/ping
 *   2. If YES → defines AlignStorage + AlignAuth backed by fetch() calls
 *   3. If NO  → lets the original localStorage versions load instead
 *
 * The backend server (server.js) must be running for this to activate.
 */

(function (global) {
  'use strict';

  var API_BASE = '/api';
  var _token = null;       // true if authenticated (token is in httpOnly cookie)
  var _user = null;        // cached current user
  var _projectRole = null; // cached project membership role

  // Safe event listener — removes old before adding (prevents stacking)
  function _on(el, event, handler) {
    if (!el) return;
    el.removeEventListener(event, handler);
    el.addEventListener(event, handler);
  }

  /* ── Optimistic UI helper ────────────────────────────────────────────── */
  // apply() mutates DOM instantly. If request() fails, revert() restores it.
  function _optimistic(apply, revert, requestFn, successMsg) {
    var undo = apply ? apply() : null;
    try {
      return requestFn().then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().catch(function() { return {}; });
      }).then(function() {
        if (successMsg) _toast(successMsg);
      }).catch(function(err) {
        if (revert && undo !== undefined) revert(undo);
        _toast('Save failed — reverted', true);
        throw err;
      });
    } catch(e) {
      _toast('Save failed', true);
      return Promise.reject(e);
    }
  }

  function _toast(msg, isError) {
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' toast--error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('toast--show'); });
    setTimeout(function() { el.classList.remove('toast--show'); setTimeout(function() { el.remove(); }, 300); }, 3000);
  }
  var _ready = false;      // true once we confirmed backend is up

  /* ── Fetch helpers ────────────────────────────────────────────────────── */

  function authHeaders() {
    return { 'Content-Type': 'application/json' };
    // Auth token is now sent via httpOnly cookie — no JS access needed
  }

  function apiGet(url) {
    return fetch(API_BASE + url, { headers: authHeaders(), credentials: 'include' }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'API error ' + r.status); });
      return r.json();
    });
  }

  function apiPost(url, body) {
    // If offline, queue the write and return success
    if (typeof AlignSync !== 'undefined' && AlignSync.isOnline && !AlignSync.isOnline()) {
      _queueSyncOp('POST', url, body);
      return Promise.resolve({ ok: true, queued: true });
    }
    return fetch(API_BASE + url, {
      method: 'POST',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include'
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'API error ' + r.status); });
      return r.json();
    }).catch(function(e) {
      console.error('[Align API] POST failed for ' + url + ':', e.message || e);
      // AUDIT FIX #1: auth endpoints must fail loudly — never queue credentials
      // for replay or fake a success. Otherwise a wrong password "succeeds",
      // navigates forward, and stores the password in the sync queue.
      if (url.indexOf('/auth/') === 0) throw e;
      _queueSyncOp('POST', url, body);
      // Try to drain immediately
      if (typeof AlignSync !== 'undefined' && AlignSync.drain) AlignSync.drain();
      return { ok: true, queued: true };
    });
  }

  function apiPut(url, body) {
    if (typeof AlignSync !== 'undefined' && AlignSync.isOnline && !AlignSync.isOnline()) {
      _queueSyncOp('PUT', url, body);
      return Promise.resolve({ ok: true, queued: true });
    }
    return fetch(API_BASE + url, {
      method: 'PUT',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include'
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'API error ' + r.status); });
      return r.json();
    }).catch(function(e) {
      console.error('[Align API] PUT failed for ' + url + ':', e.message || e);
      _queueSyncOp('PUT', url, body);
      if (typeof AlignSync !== 'undefined' && AlignSync.drain) AlignSync.drain();
      return { ok: true, queued: true };
    });
  }

  function apiPatch(url, body) {
    if (typeof AlignSync !== 'undefined' && AlignSync.isOnline && !AlignSync.isOnline()) {
      _queueSyncOp('PATCH', url, body);
      return Promise.resolve({ ok: true, queued: true });
    }
    return fetch(API_BASE + url, {
      method: 'PATCH',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include'
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'API error ' + r.status); });
      return r.json();
    }).catch(function(e) {
      console.error('[Align API] PATCH failed for ' + url + ':', e.message || e);
      _queueSyncOp('PATCH', url, body);
      if (typeof AlignSync !== 'undefined' && AlignSync.drain) AlignSync.drain();
      return { ok: true, queued: true };
    });
  }

  function apiDelete(url) {
    if (typeof AlignSync !== 'undefined' && AlignSync.isOnline && !AlignSync.isOnline()) {
      _queueSyncOp('DELETE', url, null);
      return Promise.resolve({ ok: true, queued: true });
    }
    return fetch(API_BASE + url, {
      method: 'DELETE',
      headers: authHeaders(),
      credentials: 'include'
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'API error ' + r.status); });
      return r.json();
    }).catch(function(e) {
      console.error('[Align API] DELETE failed for ' + url + ':', e.message || e);
      _queueSyncOp('DELETE', url, null);
      if (typeof AlignSync !== 'undefined' && AlignSync.drain) AlignSync.drain();
      return { ok: true, queued: true };
    });
  }

  /* ── Sync Queue Helper — queues failed write-throughs for offline replay ── */
  function _queueSyncOp(method, url, body) {
    if (typeof AlignSync !== 'undefined' && AlignSync.enqueue) {
      AlignSync.enqueue({ method: method, url: '/api' + url, body: body });
    }
  }

  /* ── AlignStorage (API-backed) ────────────────────────────────────────── */

  /* ── Synchronous In-Memory Cache ────────────────────────────────────────────
   * Why: align-boot.js picks the engine once, then hydrates the cache with
   * ALL project + record data.  From that moment on, every read is synchronous
   * (same contract as localStorage), and writes are write-through: update the
   * cache synchronously, flush to the server asynchronously in the background.
   * This means all the existing call sites in script.js / align-projects.js /
   * align-drawings.js / align-files.js work unchanged — no Promise rewrite. */

  var _cache = {
    projects: [],                           // [{ project... }]
    records: {}                             // { "projectId|category": [record, ...] }
  };
  var _hydrated = false;
  var _projectChangeListeners = [];

  function _cacheRecKey(projectId, category) {
    return projectId + '|' + category;
  }

  /* ── AlignStorage (API-backed, sync-cache reads + write-through writes) ─ */

  var AlignStorage = {

    categories: [
      'drawings', 'daily-logs', 'specs', 'rfis', 'punchlist',
      'schedule', 'budget', 'contacts', 'photos', 'tasks',
      'procurement', 'files', 'settings'
    ],

    uid: function() {
      return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    },

    nowISO: function() {
      return new Date().toISOString();
    },

    /* ── Hydrate: called ONCE by align-boot.js before app renders ────── */
    hydrate: function() {
      var self = this;
      var projectId = _user ? _user.active_project_id : null;

      return apiGet('/projects').then(function(r) {
        _cache.projects = (r.projects || []).slice().sort(function(a, b) {
          return (b.created_at || '').localeCompare(a.created_at || '');
        });

        // If user has no active project, pick the first one
        if (!projectId && _cache.projects.length > 0) {
          projectId = _cache.projects[0].id;
        }
        if (!projectId) {
          _hydrated = true;
          return;
        }

        // Pre-load ALL records for the active project (every category)
        var proms = self.categories.map(function(cat) {
          return apiGet('/projects/' + projectId + '/' + cat).then(function(r2) {
            _cache.records[_cacheRecKey(projectId, cat)] = (r2.records || []).map(function(rec) {
              return rec.data;
            });
          }).catch(function() {
            _cache.records[_cacheRecKey(projectId, cat)] = [];
          });
        });

        return Promise.all(proms).then(function() {
          _hydrated = true;
        });
      }).catch(function(e) {
        console.warn('[Align API] hydrate failed:', e);
        _hydrated = true;  // let the app render with empty cache
      });
    },

    /* Switch active project at runtime — reload cache for new project */
    switchProject: function(newProjectId) {
      var self = this;
      _hydrated = false;
      _cache.records = {};
      return apiPut('/projects/' + newProjectId + '/active', {}).then(function() {
        if (_user) _user.active_project_id = newProjectId;
        // Re-hydrate records for the new project
        var proms = self.categories.map(function(cat) {
          return apiGet('/projects/' + newProjectId + '/' + cat).then(function(r2) {
            _cache.records[_cacheRecKey(newProjectId, cat)] = (r2.records || []).map(function(rec) {
              return rec.data;
            });
          }).catch(function() {
            _cache.records[_cacheRecKey(newProjectId, cat)] = [];
          });
        });
        return Promise.all(proms).then(function() {
          _hydrated = true;
          // Fire project change listeners
          var project = _cache.projects.find(function(p) { return p.id === newProjectId; }) || null;
          _projectChangeListeners.forEach(function(fn) { try { fn(project); } catch(e) {} });
        });
      });
    },

    onProjectChange: function(fn) {
      if (typeof fn === 'function') _projectChangeListeners.push(fn);
    },

    /* ── Projects (sync cache reads) ───────────────────────────────── */

    listProjects: function() {
      return _cache.projects.slice().sort(function(a, b) {
        return (b.created_at || b.createdAt || '').localeCompare(a.created_at || a.createdAt || '');
      });
    },

    getProject: function(id) {
      return _cache.projects.find(function(p) { return p.id === id; }) || null;
    },

    createProject: function(name, address) {
      name = (name || '').toString().trim();
      if (!name) throw new Error('Project name is required.');
      var project = {
        id: this.uid(),
        name: name,
        address: (address || '').toString().trim(),
        createdAt: this.nowISO(),
        updatedAt: this.nowISO(),
        created_at: this.nowISO(),
        updated_at: this.nowISO()
      };
      _cache.projects.push(project);

      // Write-through: tell the server (fire-and-forget; server generates its own ID)
      apiPost('/projects', { name: name, address: address || '' }).then(function(r) {
        // Fix up the ID from the server response
        if (r && r.project) {
          project.id = r.project.id;
          project.created_at = r.project.created_at || project.created_at;
          project.updated_at = r.project.updated_at || project.updated_at;
        }
      }).catch(function(e) { console.warn('[Align API] createProject write-through:', e); });

      return project;
    },

    updateProject: function(id, patches) {
      var project = _cache.projects.find(function(p) { return p.id === id; });
      if (!project) return null;
      Object.assign(project, patches, { id: id, updatedAt: this.nowISO(), updated_at: this.nowISO() });

      // Write-through
      apiPatch('/projects/' + id, patches).catch(function(e) { console.warn('[Align API] updateProject write-through:', e); });

      return project;
    },

    deleteProject: function(id) {
      var idx = _cache.projects.findIndex(function(p) { return p.id === id; });
      if (idx === -1) return false;
      _cache.projects.splice(idx, 1);

      // Purge cached records for this project
      Object.keys(_cache.records).forEach(function(key) {
        if (key.indexOf(id + '|') === 0) delete _cache.records[key];
      });

      // Write-through
      apiDelete('/projects/' + id).catch(function(e) { console.warn('[Align API] deleteProject write-through:', e); });

      return true;
    },

    getActiveProject: function() {
      if (!_user || !_user.active_project_id) {
        return _cache.projects.length > 0 ? _cache.projects[0] : null;
      }
      return _cache.projects.find(function(p) { return p.id === _user.active_project_id; }) || null;
    },

    setActiveProject: function(id) {
      // Fire-and-forget to server
      apiPut('/projects/' + id + '/active', {}).then(function() {
        if (_user) _user.active_project_id = id;
      }).catch(function(e) { console.warn('[Align API] setActiveProject write-through:', e); });

      // Also update local cache immediately
      if (_user) _user.active_project_id = id;

      // Fire project change listeners
      var project = _cache.projects.find(function(p) { return p.id === id; }) || null;
      _projectChangeListeners.forEach(function(fn) { try { fn(project); } catch(e) {} });
    },

    /* ── Records (sync cache reads + write-through writes) ──────────── */

    listRecords: function(projectId, category) {
      var recs = _cache.records[_cacheRecKey(projectId, category)];
      return Array.isArray(recs) ? recs.slice() : [];
    },

    getRecord: function(projectId, category, recordId) {
      var recs = _cache.records[_cacheRecKey(projectId, category)];
      if (!Array.isArray(recs)) return null;
      return recs.find(function(r) { return r.id === recordId; }) || null;
    },

    saveRecord: function(projectId, category, record) {
      var self = this;
      var key = _cacheRecKey(projectId, category);
      if (!_cache.records[key]) _cache.records[key] = [];

      var recs = _cache.records[key];
      var now = this.nowISO();
      var rec = Object.assign({}, record);

      if (rec.id) {
        var idx = recs.findIndex(function(r) { return r.id === rec.id; });
        if (idx !== -1) {
          recs[idx] = Object.assign({}, recs[idx], rec, { updatedAt: now });
          // Write-through: update on server, queue if offline
          var putUrl = '/projects/' + projectId + '/' + category + '/' + rec.id;
          apiPut(putUrl, { data: recs[idx] })
            .catch(function(e) {
              console.warn('[Align API] saveRecord write-through:', e);
              _queueSyncOp('PUT', putUrl, { data: recs[idx] });
            });
          return recs[idx];
        }
      } else {
        rec.id = this.uid();
      }

      // Insert new
      rec.createdAt = rec.createdAt || now;
      rec.updatedAt = now;
      recs.push(rec);

      // Write-through: create on server, queue if offline
      var postUrl = '/projects/' + projectId + '/' + category;
      apiPost(postUrl, { data: rec })
        .catch(function(e) {
          console.warn('[Align API] saveRecord write-through:', e);
          _queueSyncOp('POST', postUrl, { data: rec });
        });

      return rec;
    },

    deleteRecord: function(projectId, category, recordId) {
      var key = _cacheRecKey(projectId, category);
      var recs = _cache.records[key];
      if (!Array.isArray(recs)) return false;

      var idx = recs.findIndex(function(r) { return r.id === recordId; });
      if (idx === -1) return false;

      recs.splice(idx, 1);

      // Write-through, queue if offline
      var delUrl = '/projects/' + projectId + '/' + category + '/' + recordId;
      apiDelete(delUrl)
        .catch(function(e) {
          console.warn('[Align API] deleteRecord write-through:', e);
          _queueSyncOp('DELETE', delUrl, null);
        });

      return true;
    },

    sortRecords: function(projectId, category, compareFn) {
      var key = _cacheRecKey(projectId, category);
      var recs = _cache.records[key];
      if (!Array.isArray(recs)) return [];
      recs.sort(compareFn);
      return recs;
    },

    clearCategory: function(projectId, category) {
      var key = _cacheRecKey(projectId, category);
      _cache.records[key] = [];

      // Write-through: delete all records in this category one by one
      var self = this;
      // Get from server first, then delete
      apiGet('/projects/' + projectId + '/' + category).then(function(r) {
        var serverRecs = r.records || [];
        return Promise.all(serverRecs.map(function(rec) {
          return apiDelete('/projects/' + projectId + '/' + category + '/' + rec.id).catch(function(){});
        }));
      }).catch(function(){});
    },

    /* Re-fetch a single category from server (fixes stale cache) */
    hydrateCategory: function(projectId, category) {
      var self = this;
      var key = _cacheRecKey(projectId, category);
      return apiGet('/projects/' + projectId + '/' + category).then(function(r) {
        _cache.records[key] = (r.records || []).map(function(rec) {
          return rec.data;
        });
        return _cache.records[key];
      });
    },
  };

  /* ── AlignAuth (API-backed) ───────────────────────────────────────────── */

  var _changeListeners = [];

  function fireAuthChange() {
    var detail = { user: _user };
    _changeListeners.forEach(function(fn) {
      try { fn(detail); } catch(e) { /* silent */ }
    });
    // Also fire DOM event
    try {
      var ev = new CustomEvent('align-auth-change', { detail: detail });
      document.dispatchEvent(ev);
    } catch(e) {}
  }

  var AlignAuth = {
    _isApiAdapter: true,
    init: function() {
      // With httpOnly cookies, just check if we have a valid session
      var self = this;
      return apiGet('/auth/me').then(function(r) {
        _user = r.user;
        _token = true;  // authenticated
        _ready = true;
        fireAuthChange();
        return _user;
      }).catch(function() {
        _token = null;
        _user = null;
        _ready = true;
        return null;
      });
    },

    getActiveUser: function() {
      return _user;
    },

    isAdmin: function() {
      return _user && _user.role === 'admin';
    },

    listUsers: function() {
      // Try project-scoped first, fall back to admin full list
      return apiGet('/auth/user-list').then(function(r) { return r.users || []; })
        .catch(function() {
          return apiGet('/auth/users').then(function(r) { return r.users || []; }).catch(function() { return []; });
        });
    },

    createUser: function(opts) {
      return apiPost('/auth/users', {
        email: opts.email,
        name: opts.name,
        role: opts.role || 'user'
      }).then(function(r) {
        // Save invite info for the setup page
        try {
          localStorage.setItem('align-invite-info', JSON.stringify({
            token: r.inviteToken,
            name: opts.name,
            suggestedUsername: r.suggestedUsername
          }));
        } catch(e) {}
        return { user: r.user, inviteToken: r.inviteToken };
      });
    },

    acceptInvite: function(token, password) {
      var self = this;
      return apiPost('/auth/accept-invite', { token: token, password: password, pin: password }).then(function(r) {
        _user = r.user;
        _token = true;
        fireAuthChange();
        return _user;
      });
    },

    updateUser: function(id, patches) {
      return apiPatch('/auth/users/' + id, patches).then(function(r) { return r.user || null; });
    },

    deleteUser: function(id) {
      return apiDelete('/auth/users/' + id).then(function() { return true; }).catch(function() { return false; });
    },

    signIn: function(username, password) {
      var self = this;
      return apiPost('/auth/signin', { username: username, password: password || '' }).then(function(r) {
        // AUDIT FIX #1b: guard against queued/empty responses masquerading as success
        if (!r || !r.user) throw new Error('Sign-in failed. Please try again.');
        _user = r.user;
        _token = true;
        try { global.localStorage.setItem('align-last-user', username); } catch(e) {}
        return _user;
      });
    },

    signOut: function() {
      var self = this;
      if (_token) {
        apiPost('/auth/signout', {}).catch(function() { /* ignore */ });
      }
      _user = null;
      _token = null;
      try { global.localStorage.removeItem('align-token'); } catch(e) {}
      setTimeout(function() { self.showAuthOverlay(); }, 50);
    },

    signOutAll: function() {
      var self = this;
      if (_token) {
        apiPost('/auth/signout-all', {})
          .then(function() {
            // Now sign out current device too
            self.signOut();
          })
          .catch(function() { self.signOut(); });
      } else {
        self.signOut();
      }
    },

    loadPermissions: function(email) {
      // API-backed: permissions come from the server
      if (!_user) return Promise.resolve({});
      var projectId = _user.active_project_id;
      if (!projectId) return Promise.resolve({});
      var self = this;
      return apiGet('/projects/' + projectId + '/permissions').then(function(r) {
        // Cache the project role for isProjectAdmin()
        _projectRole = r.role || null;
        return r.permissions || {};
      }).catch(function() {
        return {};
      });
    },

    isProjectAdmin: function(projectId) {
      if (!_user) return false;
      if (_user.role === 'admin') return true; // server admin always passes
      return _projectRole === 'admin';
    },

    /* Event system (for align-auth-change listeners) */
    onAuthChange: function(fn) {
      _changeListeners.push(fn);
    },

    /* ── UI methods (same as localStorage version, but API-backed) ────── */

    showAuthOverlay: function() {
      var self = this;
      var old = document.getElementById('align-auth-overlay');
      if (old) old.remove();

      // Lock body scroll and hide dashboard behind overlay
      document.body.classList.add('auth-overlay-open');
      // Hide dashboard elements so they don't layout-shift behind overlay
      var tg = document.querySelector('.tile-grid');
      var hd = document.querySelector('.app-header');
      if (tg) tg.style.display = 'none';
      if (hd) hd.style.display = 'none';

      // Check for setup hash: #setup=INVITE_TOKEN
      var hash = window.location.hash;
      var setupMatch = hash.match(/^#setup=(.+)/);
      if (setupMatch) {
        var setupToken = setupMatch[1];
        _renderSetupPage(setupToken, self);
        return;
      }

      // Fetch users from server — use public endpoint (no auth needed for sign-in screen)
      apiGet('/auth/who').then(function(r) {
        var users = r.users || [];
        var overlay = document.createElement('div');
        overlay.id = 'align-auth-overlay';
        overlay.className = 'auth-overlay';

        if (users.length === 0) {
          overlay.innerHTML = _renderCreateAdminHTML();
        } else {
          overlay.innerHTML = _renderUserListHTML(users);
        }

        document.body.appendChild(overlay);
        _bindAuthEventsAPI(overlay, users, self);
      }).catch(function() {
        // Can't reach server — show a message
        var overlay = document.createElement('div');
        overlay.id = 'align-auth-overlay';
        overlay.className = 'auth-overlay';
        overlay.innerHTML = '<div class="auth-container">' +
          '<div class="auth-brand">' +
            '<div class="auth-logo-wrap"><img class="auth-logo auth-logo-light" src="assets/align-logo-light-v2.png" alt="Align" /><img class="auth-logo auth-logo-dark" src="assets/align-logo-dark-v2.png" alt="Align" /></div>' +
            '<p class="auth-subtitle">Cannot connect to server. Make sure the backend is running.</p>' +
          '</div>' +
        '</div>';
        document.body.appendChild(overlay);
      });
    },

    removeAuthOverlay: function() {
      var overlay = document.getElementById('align-auth-overlay');
      if (overlay) overlay.remove();
      // Unlock body scroll
      document.body.classList.remove('auth-overlay-open');
    },

    /* ── People Manager (unified Users + Invites) ────────────────────── */
    renderPeopleManager: function(container) {
      var self = this;
      container.innerHTML = '';
      var admin = this.isAdmin();
      if (!admin) { container.innerHTML = '<div class="dir-empty">Only admins can manage people.</div>'; return; }

      var html = '<div style="margin-bottom:12px;display:flex;gap:8px;">' +
        '<button class="pm-btn primary" id="people-add-btn">+ Add Person</button>' +
        '<select id="people-filter" style="padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:0.8rem;">' +
          '<option value="">All</option><option value="active">Active</option><option value="pending">Pending</option>' +
        '</select>' +
      '</div>' +
      // Add Person modal (hidden)
      '<div id="people-add-modal" style="display:none;margin-bottom:16px;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:8px;">' +
        '<div style="font-weight:600;margin-bottom:12px;">Add Person</div>' +
        '<input class="auth-input" id="people-email" placeholder="Email" style="margin-bottom:8px;">' +
        '<input class="auth-input" id="people-name" placeholder="Full name" style="margin-bottom:8px;">' +
        '<select class="auth-input" id="people-role" style="margin-bottom:8px;"><option value="user">Role: User</option><option value="admin">Role: Admin</option></select>' +
        '<div style="font-size:0.8rem;color:var(--muted);margin-bottom:4px;">Assign to projects (optional):</div>' +
        '<div id="people-projects-list" style="margin-bottom:12px;"></div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="pm-btn primary" id="people-save-btn">Send Invite</button>' +
          '<button class="pm-btn" id="people-cancel-btn">Cancel</button>' +
          '<p class="form-error" id="people-error"></p>' +
        '</div>' +
      '</div>' +
      // People list
      '<div id="people-list">' + (window.AlignSkeleton ? window.AlignSkeleton.html(4) : 'Loading…') + '</div>';

      container.innerHTML = html;

      // Load projects for the picker
      var projects = window.AlignStorage ? window.AlignStorage.listProjects() : [];
      var projHTML = '';
      projects.forEach(function(p) {
        projHTML += '<label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;padding:4px 0;">' +
          '<input type="checkbox" data-proj-id="' + p.id + '" checked>' + p.name +
          ' <select data-proj-role="' + p.id + '" style="font-size:0.7rem;padding:2px 4px;border-radius:4px;">' +
            '<option value="member">Member</option><option value="admin">Admin</option>' +
          '</select>' +
        '</label>';
      });
      document.getElementById('people-projects-list').innerHTML = projHTML || '<span style="color:var(--muted);font-size:0.8rem;">No projects yet</span>';

      // Load people list
      _loadPeopleList(self);

      // Bind events
      _on(document.getElementById('people-add-btn'), 'click', function() {
        document.getElementById('people-add-modal').style.display = '';
      });
      _on(document.getElementById('people-cancel-btn'), 'click', function() {
        document.getElementById('people-add-modal').style.display = 'none';
      });
      _on(document.getElementById('people-save-btn'), 'click', function() {
        clearInlineError('people-error');
        var email = document.getElementById('people-email').value.trim();
        var name = document.getElementById('people-name').value.trim();
        var role = document.getElementById('people-role').value;
        if (!email || !name) { showInlineError('people-error', 'Email and name required.'); return; }

        var selectedProjects = [];
        document.querySelectorAll('#people-projects-list input[type=checkbox]:checked').forEach(function(cb) {
          var pid = cb.getAttribute('data-proj-id');
          var sel = document.querySelector('[data-proj-role="' + pid + '"]');
          selectedProjects.push({ id: pid, role: sel ? sel.value : 'member', permissions: {} });
        });

        apiPost('/people', { email: email, name: name, role: role, projects: selectedProjects }).then(function() {
          document.getElementById('people-add-modal').style.display = 'none';
          _loadPeopleList(self);
        }).catch(function(e) {
          showInlineError('people-error', 'Failed: ' + (e.message || 'Unknown error'));
        });
      });
      document.getElementById('people-filter').addEventListener('change', function() {
        _loadPeopleList(self);
      });
    },

    /* ── Members Manager (Step 12) ────────────────────────────────────── */
    renderMembersManager: function(container) {
      var self = this;
      var project = global.AlignStorage ? global.AlignStorage.getActiveProject() : null;
      if (!project) {
        container.innerHTML = '<div class="dir-empty">No active project. Select a project first.</div>';
        return;
      }

      var isAdmin = this.isAdmin() || this.isProjectAdmin(project.id);
      if (!isAdmin) {
        container.innerHTML = '<div class="dir-empty">Only project admins can manage members.</div>';
        return;
      }

      container.innerHTML = '<p style="color:var(--muted);">Loading members…</p>';

      _loadMembersList(self, project);
    },

    SECTIONS: Object.freeze([
      { id: 'drawings',    icon: '📐', label: 'Drawings' },
      { id: 'daily-logs',  icon: '📋', label: 'Daily Logs' },
      { id: 'specs',       icon: '📄', label: 'Specs' },
      { id: 'rfis',        icon: '❓', label: 'RFIs' },
      { id: 'punchlist',   icon: '✅', label: 'Punchlist' },
      { id: 'schedule',    icon: '📅', label: 'Schedule' },
      { id: 'budget',      icon: '💰', label: 'Budget' },
      { id: 'contacts',    icon: '👥', label: 'Directory' },
      { id: 'photos',      icon: '📸', label: 'Photos' },
      { id: 'tasks',       icon: '🔨', label: 'Tasks' },
      { id: 'procurement', icon: '📦', label: 'Procurement' },
      { id: 'files',       icon: '📁', label: 'Files' },
      { id: 'settings',    icon: '⚙️', label: 'Settings' }
    ])
  };

  /* ── Auth overlay helpers ─────────────────────────────────────────── */

  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _randomPin() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function showInlineError(elId, msg) {
    var el = document.getElementById(elId);
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.classList.add('visible');
  }
  function clearInlineError(elId) {
    var el = document.getElementById(elId);
    if (el) { el.textContent = ''; el.classList.remove('visible'); }
  }

  // v2: generic password Show/Hide toggles (login, card view, create admin, setup)
  function _bindPasswordToggles(scope) {
    if (!scope || !scope.querySelectorAll) return;
    Array.prototype.forEach.call(scope.querySelectorAll('.auth-pw-toggle'), function (btn) {
      if (btn.__alignBound) return; // avoid double-binding
      btn.__alignBound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var wrap = btn.closest ? btn.closest('.auth-pw-wrap') : null;
        var inp = wrap ? wrap.querySelector('input') : null;
        if (!inp) return;
        var reveal = inp.type === 'password';
        inp.type = reveal ? 'text' : 'password';
        btn.textContent = reveal ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        inp.focus();
      });
    });
  }

  /* ── Setup page (invite accept) ─────────────────────────────────── */

  function _renderSetupPage(token, authInstance) {
    var overlay = document.createElement('div');
    overlay.id = 'align-auth-overlay';
    overlay.className = 'auth-overlay';
    overlay.innerHTML = '<div class="auth-container">' +
      '<div class="auth-card">' +
        '<div class="auth-brand">' +
          '<div class="auth-logo-wrap"><img class="auth-logo auth-logo-light" src="assets/align-logo-light-v2.png" alt="Align" /><img class="auth-logo auth-logo-dark" src="assets/align-logo-dark-v2.png" alt="Align" /></div>' +
          '<p class="auth-subtitle">Choose a username and create a password</p>' +
        '</div>' +
        '<div class="auth-create-form">' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="setup-username">Username</label>' +
            '<input class="auth-input" id="setup-username" type="text" placeholder="e.g. johnsmith" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" />' +
            '<p class="auth-input-hint" id="setup-username-hint"></p>' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="setup-pin">Create a password</label>' +
            '<div class="auth-pw-wrap">' +
              '<input class="auth-input" id="setup-pin" type="password" placeholder="Min 8 characters" minlength="8" autocomplete="new-password" />' +
              '<button type="button" class="auth-pw-toggle" tabindex="-1" aria-label="Show password">Show</button>' +
            '</div>' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="setup-pin-confirm">Confirm password</label>' +
            '<div class="auth-pw-wrap">' +
              '<input class="auth-input" id="setup-pin-confirm" type="password" placeholder="Min 8 characters" minlength="8" autocomplete="new-password" />' +
              '<button type="button" class="auth-pw-toggle" tabindex="-1" aria-label="Show password">Show</button>' +
            '</div>' +
          '</div>' +
          '<p class="auth-pin-error" id="setup-error"></p>' +
          '<button class="auth-signin-btn" id="setup-submit">Create Account</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    _bindPasswordToggles(overlay);

    // Pre-fill username suggestion from invite info
    var inviteUser = null;
    try { inviteUser = JSON.parse(localStorage.getItem('align-invite-info') || 'null'); } catch(e) {}
    if (inviteUser && inviteUser.token === token) {
      var uname = inviteUser.suggestedUsername || (inviteUser.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
      var inp = document.getElementById('setup-username');
      if (inp && uname) inp.value = uname;
      var hint = document.getElementById('setup-username-hint');
      if (hint && uname) hint.textContent = 'Suggested from your name. You can change it.';
    }

    var submitBtn = document.getElementById('setup-submit');
    var unameInput = document.getElementById('setup-username');
    var pinInput = document.getElementById('setup-pin');
    var pinConfirm = document.getElementById('setup-pin-confirm');
    var errorEl = document.getElementById('setup-error');

    submitBtn.addEventListener('click', function() {
      var uname = (unameInput?.value || '').trim();
      var pin = (pinInput?.value || '').trim();
      var confirm = (pinConfirm?.value || '').trim();
      if (!uname || uname.length < 3) { if (errorEl) { errorEl.textContent = 'Username must be at least 3 characters'; errorEl.classList.add('visible'); } return; }
      if (pin.length < 8) { if (errorEl) { errorEl.textContent = 'Password must be at least 8 characters'; errorEl.classList.add('visible'); } return; }
      if (pin !== confirm) { if (errorEl) { errorEl.textContent = 'Passwords do not match'; errorEl.classList.add('visible'); } return; }
      apiPost('/auth/setup-account', { token: token, username: uname, password: pin, pin: pin }).then(function(r) {
        _user = r.user; _token = true;
        try { localStorage.setItem('align-last-user', r.user.username); } catch(e) {}
        window.location.hash = ''; _afterSignIn(authInstance);
      }).catch(function(e) {
        if (errorEl) { errorEl.textContent = e.message; errorEl.classList.add('visible'); }
      });
    });
  }

  function _renderCreateAdminHTML() {
    return '<div class="auth-container">' +
      '<div class="auth-card">' +
        '<div class="auth-brand">' +
          '<div class="auth-logo-wrap"><img class="auth-logo auth-logo-light" src="assets/align-logo-light-v2.png" alt="Align" /><img class="auth-logo auth-logo-dark" src="assets/align-logo-dark-v2.png" alt="Align" /></div>' +
          '<p class="auth-subtitle">Create your admin account to get started</p>' +
        '</div>' +
        '<div class="auth-create-form" id="auth-create-form">' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-first">First name</label>' +
            '<input class="auth-input" id="auth-first" type="text" placeholder="First name" autocomplete="given-name" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-last">Last name</label>' +
            '<input class="auth-input" id="auth-last" type="text" placeholder="Last name" autocomplete="family-name" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-email">Email address</label>' +
            '<input class="auth-input" id="auth-email" type="email" placeholder="Email address" autocomplete="email" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-pin">Create a password</label>' +
            '<div class="auth-pw-wrap">' +
              '<input class="auth-input" id="auth-pin" type="password" placeholder="Min 8 characters" minlength="8" autocomplete="new-password" />' +
              '<button type="button" class="auth-pw-toggle" tabindex="-1" aria-label="Show password">Show</button>' +
            '</div>' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-pin-confirm">Confirm password</label>' +
            '<div class="auth-pw-wrap">' +
              '<input class="auth-input" id="auth-pin-confirm" type="password" placeholder="Min 8 characters" minlength="8" autocomplete="new-password" />' +
              '<button type="button" class="auth-pw-toggle" tabindex="-1" aria-label="Show password">Show</button>' +
            '</div>' +
          '</div>' +
          '<button class="auth-signin-btn" id="auth-create-submit">Create Admin Account</button>' +
          '<p class="auth-pin-error" id="auth-create-error"></p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _renderUserListHTML(users) {
    // ── Department 2: Identity Cards ──────────────────────────────────────
    // Check if a user logged in before on this device.
    var lastUsername = null;
    try { lastUsername = global.localStorage.getItem('align-last-user'); } catch(e) {}

    if (lastUsername) {
      // Find the matching user from the server list
      var lastUser = users.find(function(u) {
        return u.username === lastUsername || u.email === lastUsername;
      });
      if (lastUser) {
        // Show card view for the returning user
        return _renderCardViewHTML(lastUser);
      }
    }

    // No returning user — show clean login form
    return _renderLoginFormHTML();
  }

  function _renderCardViewHTML(u) {
    var initials = (u.name || '').split(' ').map(function(p) { return p[0] || ''; }).join('').toUpperCase() || '?';
    var cls = u.role === 'admin' ? ' admin' : '';
    var label = u.username || (u.email || '').split('@')[0];
    var displayName = u.name || (u.firstName + ' ' + (u.lastName || ''));

    return '<div class="auth-container">' +
      '<div class="auth-card">' +
        '<div class="auth-brand">' +
          '<div class="auth-logo-wrap"><img class="auth-logo auth-logo-light" src="assets/align-logo-light-v2.png" alt="Align" /><img class="auth-logo auth-logo-dark" src="assets/align-logo-dark-v2.png" alt="Align" /></div>' +
          '<p class="auth-subtitle">Welcome back</p>' +
        '</div>' +
        '<div class="auth-card-view" id="auth-card-view">' +
          '<div class="auth-user-card" id="auth-returning-card" data-uid="' + _esc(u.id) + '" data-username="' + _esc(u.username || u.email) + '" data-role="' + _esc(u.role) + '">' +
            '<div class="auth-user-avatar' + cls + '">' + _esc(initials) + '</div>' +
            '<div class="auth-user-info">' +
              '<div class="auth-user-name">' + _esc(displayName) + '</div>' +
              '<div class="auth-user-email">@' + _esc(label) + '</div>' +
              '<span class="auth-user-role ' + u.role + '">' + u.role + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="auth-card-pin" id="auth-card-pin" style="display:none;">' +
            '<p class="auth-pin-label">Enter password for <strong>' + _esc(displayName) + '</strong></p>' +
            '<div class="auth-pw-wrap" style="margin-bottom:0.75rem;">' +
              '<input class="auth-input" id="auth-card-password" type="password" placeholder="Password" autocomplete="current-password" />' +
              '<button type="button" class="auth-pw-toggle" tabindex="-1" aria-label="Show password">Show</button>' +
            '</div>' +
            '<p class="auth-pin-error" id="auth-card-pin-error"></p>' +
            '<button class="auth-signin-btn" id="auth-card-pin-submit">Sign in</button>' +
          '</div>' +
          '<button class="auth-manual-toggle" id="auth-not-you-btn">Not you?</button>' +
        '</div>' +
        // Hidden login form — shown when "Not you?" is clicked
        '<div class="auth-login-form" id="auth-login-form" style="display:none;">' +
          '<button class="auth-pin-back" id="auth-login-back">← Back</button>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-login-username">Username</label>' +
            '<input class="auth-input" id="auth-login-username" type="text" placeholder="Username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-login-password">Password</label>' +
            '<div class="auth-pw-wrap">' +
              '<input class="auth-input" id="auth-login-password" type="password" placeholder="Password" autocomplete="current-password" />' +
              '<button type="button" class="auth-pw-toggle" tabindex="-1" aria-label="Show password">Show</button>' +
            '</div>' +
          '</div>' +
          '<p class="auth-pin-error" id="auth-login-error"></p>' +
          '<button class="auth-signin-btn" id="auth-login-submit">Sign in</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _renderLoginFormHTML() {
    // Clean login form (no cards) — first visit or after "Not you?" from card view
    return '<div class="auth-container">' +
      '<div class="auth-card">' +
        '<div class="auth-brand">' +
          '<div class="auth-logo-wrap"><img class="auth-logo auth-logo-light" src="assets/align-logo-light-v2.png" alt="Align" /><img class="auth-logo auth-logo-dark" src="assets/align-logo-dark-v2.png" alt="Align" /></div>' +
          '<p class="auth-subtitle">Sign in to your project</p>' +
        '</div>' +
        '<div class="auth-login-form" id="auth-login-form">' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-login-username">Username</label>' +
            '<input class="auth-input" id="auth-login-username" type="text" placeholder="Username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" />' +
          '</div>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-login-password">Password</label>' +
            '<div class="auth-pw-wrap">' +
              '<input class="auth-input" id="auth-login-password" type="password" placeholder="Password" autocomplete="current-password" />' +
              '<button type="button" class="auth-pw-toggle" tabindex="-1" aria-label="Show password">Show</button>' +
            '</div>' +
          '</div>' +
          '<p class="auth-pin-error" id="auth-login-error"></p>' +
          '<button class="auth-signin-btn" id="auth-login-submit">Sign in</button>' +
        '</div>' +
        // Hidden invite code form
        '<div class="auth-invite-form" id="auth-invite-form" style="display:none;">' +
          '<button class="auth-pin-back" id="auth-invite-back">← Back to sign in</button>' +
          '<div class="auth-field">' +
            '<label class="auth-label" for="auth-invite-code">Invite code</label>' +
            '<input class="auth-input" id="auth-invite-code" type="text" placeholder="Invite code (e.g. ABCDEFGH)" maxlength="8" autocomplete="off" style="text-transform:uppercase;letter-spacing:3px;text-align:center;font-size:1.25rem;" />' +
          '</div>' +
          '<p class="auth-pin-error" id="auth-invite-error"></p>' +
          '<button class="auth-signin-btn" id="auth-invite-submit">Continue</button>' +
        '</div>' +
      '</div>' +
      '<p class="auth-footer" id="auth-footer">New to Align? <a href="#" id="auth-show-invite">Enter invite code</a></p>' +
    '</div>';
  }

  function _bindAuthEventsAPI(overlay, users, authInstance) {
    // v2: wire password Show/Hide toggles for any form rendered in this overlay
    _bindPasswordToggles(overlay);

    // ── Create admin form ──────────────────────────────────────────────
    var createForm = document.getElementById('auth-create-form');
    if (createForm) {
      document.getElementById('auth-create-submit').addEventListener('click', function() {
        var first   = (document.getElementById('auth-first')?.value || '').trim();
        var last    = (document.getElementById('auth-last')?.value || '').trim();
        var email   = (document.getElementById('auth-email')?.value || '').trim();
        var pin     = (document.getElementById('auth-pin')?.value || '').trim();
        var confirm = (document.getElementById('auth-pin-confirm')?.value || '').trim();
        var errorEl = document.getElementById('auth-create-error');

        if (!first || !last || !email) {
          if (errorEl) { errorEl.textContent = 'Please fill in all fields.'; errorEl.classList.add('visible'); }
          return;
        }
        if (!pin || pin.length < 8) {
          if (errorEl) { errorEl.textContent = 'Password must be at least 8 characters.'; errorEl.classList.add('visible'); }
          return;
        }
        if (pin !== confirm) {
          if (errorEl) { errorEl.textContent = 'Passwords do not match.'; errorEl.classList.add('visible'); }
          return;
        }
        if (errorEl) errorEl.classList.remove('visible');

        authInstance.createUser({
          email: email,
          name: first + ' ' + last,
          pin: pin,
          role: 'admin'
        }).then(function(user) {
          // Auto sign-in after creating first admin
          return authInstance.signIn(email, pin);
        }).then(function() {
          _afterSignIn(authInstance);
        }).catch(function(e) {
          if (errorEl) { errorEl.textContent = e.message; errorEl.classList.add('visible'); }
        });
      });
    }

    // ── Card view + "Not you?" toggle + login form ─────────────────────
    // Card click handler
    var returningCard = overlay.querySelector('#auth-returning-card');
    var cardPin = overlay.querySelector('#auth-card-pin');
    var cardPasswordInput = overlay.querySelector('#auth-card-password');
    var cardPinError = overlay.querySelector('#auth-card-pin-error');
    var cardPinSubmit = overlay.querySelector('#auth-card-pin-submit');
    var cardViewContainer = overlay.querySelector('#auth-card-view');

    if (returningCard) {
      returningCard.addEventListener('click', function() {
        var uid = returningCard.getAttribute('data-uid');
        var u = users.find(function(x) { return x.id === uid; });
        if (!u) return;
        _showCardPin();
      });

      function _showCardPin() {
        if (cardPin) cardPin.style.display = 'block';
        if (cardPasswordInput) { cardPasswordInput.value = ''; cardPasswordInput.focus(); }
      }
    }

    // Card password input
    if (cardPasswordInput) {
      cardPasswordInput.addEventListener('input', function() {
        if (cardPinSubmit) cardPinSubmit.disabled = !cardPasswordInput.value.trim();
        if (cardPinError) cardPinError.classList.remove('visible');
      });
      cardPasswordInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && cardPasswordInput.value.trim() && cardPinSubmit) {
          cardPinSubmit.click();
        }
      });
    }

    if (cardPinSubmit) {
      cardPinSubmit.addEventListener('click', function() {
        var u = users.find(function(x) { return x.id === (returningCard?.getAttribute('data-uid')); });
        if (!u) return;
        var pass = cardPasswordInput ? cardPasswordInput.value.trim() : '';
        if (!pass) return;
        authInstance.signIn(u.username || u.email, pass).then(function() {
          _afterSignIn(authInstance);
        }).catch(function(e) {
          if (cardPinError) { cardPinError.textContent = e.message || 'Invalid password'; cardPinError.classList.add('visible'); }
          if (cardPasswordInput) { cardPasswordInput.value = ''; cardPasswordInput.focus(); }
          if (cardPinSubmit) cardPinSubmit.disabled = true;
        });
      });
    }

    // "Not you?" → show login form, hide card view
    var notYouBtn = overlay.querySelector('#auth-not-you-btn');
    var loginForm = overlay.querySelector('#auth-login-form');
    var loginBackBtn = overlay.querySelector('#auth-login-back');

    if (notYouBtn && loginForm) {
      notYouBtn.addEventListener('click', function() {
        if (cardViewContainer) cardViewContainer.style.display = 'none';
        loginForm.style.display = 'flex';
        var loginUsername = overlay.querySelector('#auth-login-username');
        if (loginUsername) loginUsername.focus();
      });
    }

    // "← Back" → show card view, hide login form
    if (loginBackBtn && loginForm) {
      loginBackBtn.addEventListener('click', function() {
        loginForm.style.display = 'none';
        if (cardViewContainer) cardViewContainer.style.display = '';
      });
    }

    // ── Login form (shared: card-view fallback + standalone) ────────────
    var loginUsername = overlay.querySelector('#auth-login-username');
    var loginPassInput = overlay.querySelector('#auth-login-password');
    var loginError = overlay.querySelector('#auth-login-error');
    var loginSubmit = overlay.querySelector('#auth-login-submit');

    if (loginPassInput) {
      loginPassInput.addEventListener('input', function() {
        if (loginSubmit) loginSubmit.disabled = !loginPassInput.value.trim();
        if (loginError) loginError.classList.remove('visible');
      });
      loginPassInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && loginPassInput.value.trim() && loginSubmit) {
          loginSubmit.click();
        }
      });
    }

    if (loginSubmit) {
      loginSubmit.addEventListener('click', function() {
        var uname = (loginUsername?.value || '').trim();
        var pass = loginPassInput ? loginPassInput.value.trim() : '';
        if (!uname) {
          if (loginError) { loginError.textContent = 'Enter a username'; loginError.classList.add('visible'); }
          return;
        }
        if (!pass) {
          if (loginError) { loginError.textContent = 'Enter your password'; loginError.classList.add('visible'); }
          return;
        }

        authInstance.signIn(uname, pass).then(function() {
          _afterSignIn(authInstance);
        }).catch(function(e) {
          if (loginError) { loginError.textContent = e.message || 'Invalid username or password'; loginError.classList.add('visible'); }
          if (loginPassInput) { loginPassInput.value = ''; loginPassInput.focus(); }
          if (loginSubmit) loginSubmit.disabled = true;
        });
      });
    }

    // Auto-focus username on load
    if (loginUsername) loginUsername.focus();

    // ── Invite code flow ──────────────────────────────────────────────
    var inviteForm = overlay.querySelector('#auth-invite-form');
    var inviteCodeInput = overlay.querySelector('#auth-invite-code');
    var inviteError = overlay.querySelector('#auth-invite-error');
    var inviteSubmit = overlay.querySelector('#auth-invite-submit');
    var inviteBackBtn = overlay.querySelector('#auth-invite-back');
    var showInviteLink = overlay.querySelector('#auth-show-invite');

    if (showInviteLink && inviteForm && loginForm) {
      showInviteLink.addEventListener('click', function(e) {
        e.preventDefault();
        loginForm.style.display = 'none';
        inviteForm.style.display = 'block';
        var f = overlay.querySelector('#auth-footer'); if (f) f.style.display = 'none';
        if (inviteCodeInput) { inviteCodeInput.value = ''; inviteCodeInput.focus(); }
      });
    }

    if (inviteBackBtn && inviteForm && loginForm) {
      inviteBackBtn.addEventListener('click', function() {
        inviteForm.style.display = 'none';
        loginForm.style.display = 'flex';
        var f = overlay.querySelector('#auth-footer'); if (f) f.style.display = '';
        if (loginUsername) loginUsername.focus();
      });
    }

    if (inviteCodeInput) {
      inviteCodeInput.addEventListener('input', function() {
        if (inviteSubmit) inviteSubmit.disabled = !inviteCodeInput.value.trim();
        if (inviteError) inviteError.classList.remove('visible');
        // Auto-uppercase
        inviteCodeInput.value = inviteCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      });
      inviteCodeInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && inviteCodeInput.value.trim().length >= 4 && inviteSubmit) {
          inviteSubmit.click();
        }
      });
    }

    if (inviteSubmit) {
      inviteSubmit.addEventListener('click', function() {
        var code = inviteCodeInput ? inviteCodeInput.value.trim().toUpperCase() : '';
        if (!code || code.length < 4) {
          if (inviteError) { inviteError.textContent = 'Enter a valid invite code'; inviteError.classList.add('visible'); }
          return;
        }
        // Redirect to setup page with the code
        window.location.hash = '#setup=' + code;
        // Re-render as setup page
        authInstance.showAuthOverlay();
      });
    }
  }

  /* ── Department 3: Project Picker (after sign-in) ──────────────────── */

  function _afterSignIn(authInstance) {
    // Navigate to project selection page — set hash BEFORE firing auth change
    // to avoid flashing the dashboard between overlay removal and navigation.
    authInstance.removeAuthOverlay();
    var _go = function() {
      if (location.hash === '#project-select') {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } else {
        location.hash = '#project-select';
      }
      // Fire auth change AFTER navigation — dashboard stays hidden by section-open
      fireAuthChange();
    };
    AlignStorage.hydrate().then(_go).catch(_go);
  }





  function _loadMembersList(authInstance, project) {
    var pid = project.id;
    Promise.all([
      apiGet('/projects/' + pid + '/members'),
      apiGet('/auth/user-list')  // all available users for the add-member picker
    ]).then(function(results) {
      var members = results[0].members || [];
      var allUsers = results[1].users || [];
      var memberIds = {};
      members.forEach(function(m) { memberIds[m.user_id] = true; });

      var container = document.querySelector('#section-body');
      if (!container) return;

      // Build member list
      var html = '<div style="margin-bottom:16px;display:flex;gap:8px;">' +
        '<span style="font-weight:700;font-size:1rem;">' + _esc(project.name) + ' — Members</span>' +
        '<span style="color:var(--muted);font-size:0.85rem;">(' + members.length + ')</span>' +
        '<button class="dir-add-btn" id="members-add-btn" style="margin-left:auto;">+ Add Member</button>' +
      '</div>';

      // Add-member form (hidden)
      var nonMembers = allUsers.filter(function(u) { return !memberIds[u.id]; });
      html += '<div class="invite-form" id="members-add-form" style="display:none;">' +
        '<div class="invite-form-title">Add member to ' + _esc(project.name) + '</div>';
      if (nonMembers.length === 0) {
        html += '<p style="color:var(--muted);">All users are already members of this project.</p>';
      } else {
        html += '<select class="auth-input" id="members-user-select">' +
          '<option value="">— Select user —</option>';
        nonMembers.forEach(function(u) {
          html += '<option value="' + _esc(u.id) + '">' + _esc(u.name || u.email) + ' (' + _esc(u.email) + ')</option>';
        });
        html += '</select>' +
          '<select class="auth-input" id="members-role-select">' +
            '<option value="member">Role: Member</option>' +
            '<option value="admin">Role: Admin</option>' +
          '</select>' +
          '<div class="invite-form-actions">' +
            '<button class="auth-btn secondary" id="members-add-cancel">Cancel</button>' +
            '<button class="auth-btn primary" id="members-add-save">Add to Project</button>' +
          '</div>' +
          '<p class="form-error" id="members-error"></p>';
      }
      html += '</div>';

      // Member list
      if (members.length === 0) {
        html += '<div class="dir-empty">No members in this project.</div>';
      } else {
        members.forEach(function(m) {
          var initials = (m.name || '??').split(' ').map(function(p) { return (p || '')[0] || ''; }).join('').toUpperCase().slice(0, 2) || '?';
          var isSelf = authInstance.getActiveUser() && authInstance.getActiveUser().id === m.user_id;
          var canManage = !isSelf && m.project_role !== 'admin'; // can't demote self or other admins via simple toggle
          html += '<div class="user-row">' +
            '<div class="user-row-avatar">' + _esc(initials) + '</div>' +
            '<div class="user-row-info">' +
              '<div class="user-row-name">' + _esc(m.name) + (isSelf ? ' <span style="font-size:0.7rem;color:var(--brand);">(you)</span>' : '') + '</div>' +
              '<div class="user-row-email">' + _esc(m.email) + '</div>' +
            '</div>' +
            '<span style="padding:4px 10px;border-radius:6px;font-size:0.75rem;font-weight:600;' +
              (m.project_role === 'admin' ? 'background:rgba(245,158,11,0.15);color:#f59e0b;' : 'background:rgba(14,165,233,0.1);color:#0ea5e9;') + '">' +
              m.project_role +
            '</span>' +
            '<div class="user-row-actions" style="display:flex;gap:4px;">' +
              '<button class="user-action-btn" data-perms="' + _esc(m.user_id) + '" title="Room Permissions">🔒</button>' +
              (canManage && m.project_role === 'member' ?
                '<button class="user-action-btn" data-promote="' + _esc(m.user_id) + '" title="Promote to Admin">⬆</button>' : '') +
              (canManage && m.project_role === 'admin' ?
                '<button class="user-action-btn" data-demote="' + _esc(m.user_id) + '" title="Demote to Member">⬇</button>' : '') +
              (!isSelf ? '<button class="user-action-btn danger" data-remove="' + _esc(m.user_id) + '" title="Remove">✕</button>' : '') +
            '</div>' +
            // Permissions panel (hidden, toggled by 🔒 button)
            '<div class="perms-panel" id="perms-' + _esc(m.user_id) + '" style="display:none;margin:8px 0 8px 52px;padding:12px;background:var(--card);border:1px solid var(--line);border-radius:8px;">' +
              '<div style="font-size:0.8rem;font-weight:600;margin-bottom:8px;">Room Permissions</div>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.75rem;">' +
                ['drawings','daily-logs','specs','rfis','punchlist','schedule','budget','contacts','photos','tasks','procurement','files','settings'].map(function(room) {
                  var perm = (m.permissions && m.permissions[room]) || 'rw';
                  var sel = '<select data-room="' + room + '" data-user="' + _esc(m.user_id) + '" style="width:100%;padding:3px 6px;border-radius:4px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:0.7rem;">' +
                    '<option value="rw"' + (perm === 'rw' ? ' selected' : '') + '>rw</option>' +
                    '<option value="r"' + (perm === 'r' ? ' selected' : '') + '>r (read)</option>' +
                    '<option value="none"' + (perm === 'none' ? ' selected' : '') + '>none</option>' +
                  '</select>';
                  return '<div style="display:flex;align-items:center;gap:4px;"><span style="width:70px;text-align:right;color:var(--muted);">' + room + '</span>' + sel + '</div>';
                }).join('') +
              '</div>' +
              '<button data-save-perms="' + _esc(m.user_id) + '" style="margin-top:8px;padding:4px 12px;border-radius:4px;border:1px solid var(--brand);background:var(--brand);color:#fff;font-size:0.75rem;cursor:pointer;">Save Permissions</button>' +
            '</div>' +
          '</div>';
        });
      }

      container.innerHTML = html;
      _bindMembersEvents(container, authInstance, project);
    }).catch(function() {
      var container = document.querySelector('#section-body');
      if (container) container.innerHTML = '<div class="dir-empty">Failed to load members.</div>';
    });
  }

  function _bindMembersEvents(container, authInstance, project) {
    var pid = project.id;
    var addBtn = document.getElementById('members-add-btn');
    var form = document.getElementById('members-add-form');
    var cancelBtn = document.getElementById('members-add-cancel');
    var saveBtn = document.getElementById('members-add-save');

    if (addBtn && form) {
      addBtn.addEventListener('click', function() {
        form.style.display = 'block';
        addBtn.style.display = 'none';
      });
    }
    if (cancelBtn && form && addBtn) {
      cancelBtn.addEventListener('click', function() {
        form.style.display = 'none';
        addBtn.style.display = '';
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        clearInlineError('members-error');
        var userId = document.getElementById('members-user-select')?.value;
        var role = document.getElementById('members-role-select')?.value || 'member';
        if (!userId) { showInlineError('members-error', 'Select a user.'); return; }
        saveBtn.disabled = true;
        apiPost('/projects/' + pid + '/members', { user_id: userId, role: role }).then(function() {
          _loadMembersList(authInstance, project);
        }).catch(function(e) {
          showInlineError('members-error', 'Failed: ' + (e.message || 'Unknown error'));
          saveBtn.disabled = false;
        });
      });
    }

    // Promote
    container.querySelectorAll('[data-promote]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uid = this.getAttribute('data-promote');
        apiPatch('/projects/' + pid + '/members/' + uid + '/role', { role: 'admin' }).then(function() {
          _loadMembersList(authInstance, project);
        }).catch(function(e) {
          showInlineError('members-error', 'Failed: ' + (e.message || 'Unknown error'));
        });
      });
    });

    // Demote
    container.querySelectorAll('[data-demote]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uid = this.getAttribute('data-demote');
        apiPatch('/projects/' + pid + '/members/' + uid + '/role', { role: 'member' }).then(function() {
          _loadMembersList(authInstance, project);
        }).catch(function(e) {
          showInlineError('members-error', 'Failed: ' + (e.message || 'Unknown error'));
        });
      });
    });

    // Remove
    container.querySelectorAll('[data-remove]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uid = this.getAttribute('data-remove');
        if (!confirm('Remove this member from the project?')) return;
        apiDelete('/projects/' + pid + '/members/' + uid).then(function() {
          _loadMembersList(authInstance, project);
        }).catch(function(e) {
          showInlineError('members-error', 'Failed: ' + (e.message || 'Unknown error'));
        });
      });
    });

    // Permissions panel toggle
    container.querySelectorAll('[data-perms]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uid = this.getAttribute('data-perms');
        var panel = document.getElementById('perms-' + uid);
        if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
      });
    });

    // Save permissions
    container.querySelectorAll('[data-save-perms]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uid = this.getAttribute('data-save-perms');
        var perms = {};
        document.querySelectorAll('[data-user="' + uid + '"][data-room]').forEach(function(sel) {
          perms[sel.getAttribute('data-room')] = sel.value;
        });
        apiPut('/projects/' + pid + '/permissions/' + uid, { permissions: perms }).then(function() {
          var panel = document.getElementById('perms-' + uid);
          if (panel) panel.style.display = 'none';
          _loadMembersList(authInstance, project);
        }).catch(function(e) {
          showInlineError('members-error', 'Failed to save: ' + (e.message || 'Unknown'));
        });
      });
    });
  }

  /* ── People Manager helpers ─────────────────────────────────────── */

  function _loadPeopleList(authInstance) {
    var filter = document.getElementById('people-filter');
    var status = filter ? filter.value : '';
    var url = '/people' + (status ? '?status=' + status : '');
    apiGet(url).then(function(r) {
      var people = r.people || [];
      var html = '';
      if (people.length === 0) {
        html = '<div class="dir-empty">No people yet. Click "+ Add Person" to invite someone.</div>';
      } else {
        people.forEach(function(p) {
          var statusColor = p.status === 'active' ? '#22c55e' : '#f59e0b';
          var statusLabel = p.status === 'active' ? 'Active' : 'Pending';
          var code = p.invite_code || '';
          html += '<div class="user-row">' +
            '<div class="user-row-avatar">' + (p.name || '??')[0].toUpperCase() + '</div>' +
            '<div class="user-row-info">' +
              '<div class="user-row-name">' + p.name + '</div>' +
              '<div class="user-row-email">' + p.email + '</div>' +
            '</div>' +
            '<span style="padding:4px 10px;border-radius:6px;font-size:0.75rem;font-weight:600;' +
              'background:' + statusColor + '15;color:' + statusColor + ';">' + statusLabel + '</span>' +
            (code ? '<code style="font-size:0.75rem;margin-left:8px;padding:2px 6px;background:var(--bg);border-radius:4px;">' + code + '</code>' : '') +
            '<div class="user-row-actions" style="display:flex;gap:4px;">' +
              (p.status === 'pending' ? '<button class="user-action-btn" data-resend="' + p.id + '" title="Resend">📧</button>' : '') +
              (p.role !== 'admin' ? '<button class="user-action-btn danger" data-revoke="' + p.id + '" title="Remove">✕</button>' : '') +
            '</div>' +
          '</div>';
        });
      }
      document.getElementById('people-list').innerHTML = html;

      // Bind actions
      document.querySelectorAll('[data-resend]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = this.getAttribute('data-resend');
          apiPost('/people/' + id + '/resend', {}).then(function() {
            _loadPeopleList(authInstance);
          });
        });
      });
      document.querySelectorAll('[data-revoke]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = this.getAttribute('data-revoke');
          if (!confirm('Remove this person?')) return;
          apiDelete('/people/' + id).then(function() {
            _loadPeopleList(authInstance);
          }).catch(function(e) {
            showInlineError('members-error', 'Failed: ' + (e.message || 'Unknown'));
          });
        });
      });
    });
  }

  function checkBackend() {
    return fetch(API_BASE + '/ping').then(function(r) {
      return r.ok;
    }).catch(function() {
      return false;
    });
  }

  // Periodic health check — reports real server reachability to AlignSync
  // (navigator.onLine can show "online" when server is actually unreachable)
  var _offlineFails = 0;
  var _serverOnline = true;
  function _pingLoop() {
    checkBackend().then(function(ok) {
      if (ok) {
        _offlineFails = 0;
        if (!_serverOnline) {
          _serverOnline = true;
          if (window.AlignSync) window.AlignSync.reportConnectivity(true);
        }
      } else {
        _offlineFails++;
        if (_offlineFails >= 2 && _serverOnline) {
          _serverOnline = false;
          if (window.AlignSync) window.AlignSync.reportConnectivity(false);
        }
      }
    });
  }
  setInterval(_pingLoop, 30000);
  _pingLoop();

  /* ── Initialize ───────────────────────────────────────────────────────── */
  /* Register engine for align-boot.js */
  global.__AlignApiEngine = { storage: AlignStorage, auth: AlignAuth };

})(window);
/* align-tasks.js — Align Tasks module v2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-paginated task manager with search, sort, status flow, activity log.
 * Depends on: align-storage.js (window.AlignStorage), align-auth.js (window.AlignAuth)
 */
(function (global) {
  'use strict';

  /* ── Dependencies ──────────────────────────────────────────────────── */
  function S() { return window.AlignStorage; }
  function A() { return window.AlignAuth; }

  /* ── Constants ──────────────────────────────────────────────────────── */
  var CAT = 'tasks';
  var PAGE_SIZE = 50;

  /* ── State ──────────────────────────────────────────────────────────── */
  var st = {
    container: null,
    projectId: null,
    filter: 'all',            // 'all' | 'pending' | 'in_progress' | 'done'
    searchQuery: '',
    sortBy: 'priority',       // 'priority' | 'newest' | 'oldest' | 'dueDate'
    editing: null,            // task being edited, or null
    mode: 'list',             // 'list' | 'form'
    records: [],
    page: 1,
    totalPages: 1,
    total: 0,
    counts: { all: 0, pending: 0, in_progress: 0, done: 0 },
    _photoCache: {}
  };

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function uid()  { return 'tk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowISO() { return new Date().toISOString(); }

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return isNaN(d) ? '' : d.toLocaleDateString(void 0, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }

  function statusLabel(s) {
    var m = { pending: 'Pending', in_progress: 'In Progress', done: 'Done' };
    return m[s] || s;
  }

  function statusColor(s) {
    var m = { pending: 'var(--muted-light)', in_progress: 'var(--warning)', done: 'var(--success)' };
    return m[s] || 'var(--muted)';
  }

  function priorityLabel(p) {
    var m = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
    return m[p] || p;
  }

  function priorityColor(p) {
    var m = { low: 'var(--muted-light)', medium: 'var(--warning)', high: 'var(--danger)', urgent: 'var(--danger)' };
    return m[p] || 'var(--muted)';
  }

  function getItems() {
    return st.projectId ? S().listRecords(st.projectId, CAT) : [];
  }

  function getUser() {
    try {
      var u = A() && A().getUser ? A().getUser() : null;
      return u ? (u.name || u.username || 'Unknown') : 'Unknown';
    } catch (e) { return 'Unknown'; }
  }

  function isOverdue(t) {
    return t.dueDate && t.status !== 'done' && new Date(t.dueDate + 'T00:00:00') < new Date();
  }

  function _addActivity(item, action, detail) {
    if (!item.activity) item.activity = [];
    item.activity.push({
      action: action,
      detail: detail || '',
      author: getUser(),
      timestamp: nowISO()
    });
  }

  /* ── API Helpers ────────────────────────────────────────────────────── */
  function _authHeaders() {
    try {
      var t = localStorage.getItem('align-token');
      return t
        ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json' };
    } catch (e) { return { 'Content-Type': 'application/json' }; }
  }

  /* ── Data Fetching ──────────────────────────────────────────────────── */
  function _fetchPage() {
    // AUDIT FIX #4: paint the empty-state instead of leaving a blank page
    if (!st.projectId) { _paint(); return; }

    var params = [];
    if (st.searchQuery) params.push('search=' + encodeURIComponent(st.searchQuery));
    if (st.filter !== 'all') params.push('status=' + encodeURIComponent(st.filter));
    params.push('sort=' + encodeURIComponent(st.sortBy));
    params.push('page=' + st.page);
    params.push('limit=' + PAGE_SIZE);

    var url = '/api/projects/' + encodeURIComponent(st.projectId) + '/' + CAT + '?' + params.join('&');

    fetch(url, { headers: _authHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error('API error ' + r.status);
        return r.json();
      })
      .then(function (d) {
        st.records = (d.records || []).map(function (r) { return r.data || r; });
        st.total = d.total || 0;
        st.page = d.page || 1;
        st.totalPages = d.pages || 1;
        st.counts = d.counts || { all: st.total, pending: 0, in_progress: 0, done: 0 };
        _paint();
      })
      .catch(function () {
        // Fallback: load all locally (offline / API down)
        var all = getItems();
        st.records = all;
        st.total = all.length;
        st.totalPages = 1;
        st.page = 1;
        st.counts = {
          all: all.length,
          pending: all.filter(function (i) { return i.status === 'pending'; }).length,
          in_progress: all.filter(function (i) { return i.status === 'in_progress'; }).length,
          done: all.filter(function (i) { return i.status === 'done'; }).length
        };
        _paint();
      });
  }

  /* ── Entry Point ────────────────────────────────────────────────────── */
  function render(container) {
    if (!container) return;
    st.container = container;
    st.projectId = null;
    st.filter = 'all';
    st.searchQuery = '';
    st.sortBy = 'priority';
    st.mode = 'list';
    st.editing = null;
    st.records = [];
    st.page = 1;
    st.totalPages = 1;
    st.total = 0;
    st.counts = { all: 0, pending: 0, in_progress: 0, done: 0 };
    st._photoCache = {};
    _resolveProjectId();
    _fetchPage();
  }

  function _resolveProjectId() {
    var s = S();
    st.projectId = s && s.getActiveProject() ? s.getActiveProject().id : null;
  }

  /* ── Render Controller ──────────────────────────────────────────────── */
  function _paint() {
    var c = st.container;
    if (!c) return;
    _resolveProjectId();

    if (!st.projectId) {
      c.innerHTML = '<div class="tk-empty"><strong>No active project</strong><p>Select a project.</p></div>';
      return;
    }

    if (st.mode === 'form' && st.editing) {
      c.innerHTML = _renderForm();
      _bindForm();
      return;
    }

    c.innerHTML = _renderList();
    _bindList();
  }

  /* ── List View ──────────────────────────────────────────────────────── */
  function _renderList() {
    var h = [], co = st.counts;

    h.push('<div class="tk-wrap"><div class="tk-stats">');
    ['all', 'pending', 'in_progress', 'done'].forEach(function (s) {
      var activeClass = st.filter === s ? ' active' : '';
      var cnt = co[s] || 0;
      var col = s === 'pending' ? '#f59e0b' : s === 'in_progress' ? '#3b82f6' : s === 'done' ? '#16a34a' : '';
      h.push('<button class="tk-stat-btn' + activeClass + '" data-tk-f="' + s + '">');
      h.push('<span class="tk-stat-n">' + cnt + '</span>');
      h.push('<span class="tk-stat-l" style="color:' + col + '">' + statusLabel(s) + '</span>');
      h.push('</button>');
    });
    h.push('</div>');

    h.push('<div class="tk-header"><h3 class="tk-title">Tasks</h3><button class="pm-btn primary" id="tk-new-btn">+ New Task</button></div>');

    // Search + Sort toolbar
    h.push('<div class="tk-toolbar"><div class="tk-search-wrap">');
    h.push('<input type="search" class="tk-search" id="tk-search" placeholder="Search tasks…" value="' + esc(st.searchQuery) + '">');
    if (st.searchQuery) h.push('<button class="tk-search-clear" id="tk-search-clear">✕</button>');
    h.push('</div><select class="tk-sort" id="tk-sort">');
    var sortOptions = [['priority', 'Priority'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['dueDate', 'Due date']];
    sortOptions.forEach(function (o) {
      h.push('<option value="' + o[0] + '"' + (st.sortBy === o[0] ? ' selected' : '') + '>' + o[1] + '</option>');
    });
    h.push('</select></div>');

    // Task cards
    var items = st.records;
    if (!items.length) {
      h.push('<div class="tk-empty"><strong>' + (st.searchQuery ? 'No matches' : 'No tasks') + '</strong>');
      h.push('<p>' + (st.searchQuery ? 'No tasks match "' + esc(st.searchQuery) + '".' : (st.total ? 'All clear!' : 'Add your first task.')) + '</p></div>');
    } else {
      h.push('<div class="tk-list">');
      items.forEach(function (t) {
        var due = t.dueDate ? new Date(t.dueDate + 'T00:00:00') : null;
        var overdue = isOverdue(t);
        h.push('<div class="tk-card' + (overdue ? ' tk-overdue' : '') + '">');
        h.push('<div class="tk-card-left">');
        if (t.status === 'done') {
          h.push('<div class="tk-check done" data-tk-act="undo" data-tk-id="' + esc(t.id) + '">✓</div>');
        } else {
          h.push('<div class="tk-check" data-tk-act="complete" data-tk-id="' + esc(t.id) + '">○</div>');
        }
        h.push('<div class="tk-body"><div class="tk-card-title' + (t.status === 'done' ? ' tk-done-text' : '') + '">' + esc(t.title || 'Untitled') + '</div>');
        h.push('<div class="tk-meta">');
        h.push('<span class="tk-prio" style="color:' + priorityColor(t.priority) + '">' + priorityLabel(t.priority).toUpperCase() + '</span>');
        if (t.assignedTo) h.push('<span>👤 ' + esc(t.assignedTo) + '</span>');
        if (due) h.push('<span class="' + (overdue ? 'tk-due-over' : '') + '">📅 ' + (overdue ? 'OVERDUE: ' : '') + fmtDate(t.dueDate) + '</span>');
        h.push('</div></div></div>');
        h.push('<div class="tk-card-actions"><button class="pm-btn small" data-tk-act="edit" data-tk-id="' + esc(t.id) + '">Edit</button><button class="pm-btn small danger" data-tk-act="delete" data-tk-id="' + esc(t.id) + '">✕</button></div>');
        h.push('</div>');
      });
      h.push('</div>');
    }

    // Pagination
    if (st.totalPages > 1) {
      h.push('<div class="tk-pager">');
      h.push('<button class="tk-page-btn" id="tk-page-prev" ' + (st.page <= 1 ? 'disabled' : '') + '>← Prev</button>');
      h.push('<span class="tk-page-info">Page ' + st.page + ' of ' + st.totalPages + ' (' + st.total + ' tasks)</span>');
      h.push('<button class="tk-page-btn" id="tk-page-next" ' + (st.page >= st.totalPages ? 'disabled' : '') + '>Next →</button>');
      h.push('</div>');
    }

    h.push('<div class="tk-footer">Showing ' + items.length + ' of ' + st.total + ' task' + (st.total !== 1 ? 's' : '') + '</div>');
    h.push('</div>');
    return h.join('');
  }

  function _bindList() {
    // Filter buttons
    document.querySelectorAll('.tk-stat-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        st.filter = b.getAttribute('data-tk-f');
        st.page = 1;
        _fetchPage();
      });
    });

    // New task button
    var newBtn = document.getElementById('tk-new-btn');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        st.editing = {
          id: '', title: '', description: '', assignedTo: '', priority: 'medium',
          status: 'pending', dueDate: '', createdBy: getUser(), activity: []
        };
        st.mode = 'form';
        _paint();
      });
    }

    // Search (debounced 300ms)
    var searchInput = document.getElementById('tk-search');
    if (searchInput) {
      var debounceTimer;
      searchInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        var self = this;
        debounceTimer = setTimeout(function () {
          st.searchQuery = self.value.trim();
          st.page = 1;
          _fetchPage();
        }, 300);
      });
    }

    var searchClear = document.getElementById('tk-search-clear');
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        st.searchQuery = '';
        st.page = 1;
        _fetchPage();
      });
    }

    // Sort
    var sortSelect = document.getElementById('tk-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        st.sortBy = this.value;
        st.page = 1;
        _fetchPage();
      });
    }

    // Pagination
    var prevBtn = document.getElementById('tk-page-prev');
    var nextBtn = document.getElementById('tk-page-next');
    if (prevBtn) prevBtn.addEventListener('click', function () { if (st.page > 1) { st.page--; _fetchPage(); } });
    if (nextBtn) nextBtn.addEventListener('click', function () { if (st.page < st.totalPages) { st.page++; _fetchPage(); } });

    // Delegated card actions (edit, delete, complete, undo)
    var wrap = document.querySelector('.tk-wrap');
    if (wrap) {
      wrap.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tk-act]');
        if (!btn) return;
        var action = btn.getAttribute('data-tk-act');
        var id = btn.getAttribute('data-tk-id');

        if (action === 'edit') {
          var task = getItems().find(function (i) { return i.id === id; });
          if (task) { st.editing = JSON.parse(JSON.stringify(task)); st.mode = 'form'; _paint(); }
        }

        if (action === 'delete') {
          if (confirm('Delete task?')) { S().deleteRecord(st.projectId, CAT, id); _fetchPage(); }
        }

        if (action === 'complete') {
          var t = getItems().find(function (i) { return i.id === id; });
          if (t) {
            var oldStatus = t.status;
            t.status = 'done';
            t.doneAt = nowISO();
            t.updatedAt = nowISO();
            _addActivity(t, 'status_change', oldStatus + ' → done');
            S().saveRecord(st.projectId, CAT, t);
            _fetchPage();
          }
        }

        if (action === 'undo') {
          var t2 = getItems().find(function (i) { return i.id === id; });
          if (t2) {
            t2.status = 'pending';
            t2.doneAt = null;
            t2.updatedAt = nowISO();
            _addActivity(t2, 'status_change', 'done → pending');
            S().saveRecord(st.projectId, CAT, t2);
            _fetchPage();
          }
        }
      });
    }
  }

  /* ── Form View ───────────────────────────────────────────────────────── */
  function _renderForm() {
    var t = st.editing || {};
    var h = [];

    h.push('<div class="tk-form-wrap">');
    h.push('<div class="tk-form-header">');
    h.push('<button class="pm-btn" id="tk-form-back">← Back</button>');
    h.push('<h3 class="tk-form-title">' + (t.id ? 'Edit Task' : 'New Task') + '</h3>');
    h.push('<button class="pm-btn primary" id="tk-form-save">💾 Save</button>');
    h.push('</div>');

    h.push('<div class="tk-form-s"><label class="tk-fl">Title</label><input class="tk-inp" id="tk-title" value="' + esc(t.title || '') + '" placeholder="What needs to be done?"></div>');
    h.push('<div class="tk-form-s"><label class="tk-fl">Description</label><textarea class="tk-txa" id="tk-desc" rows="3" placeholder="Details…">' + esc(t.description || '') + '</textarea></div>');

    h.push('<div class="tk-form-r">');
    h.push('<div class="tk-form-f"><label class="tk-fl">Assigned To</label><select class="tk-inp" id="tk-assign"><option value="">— Unassigned —</option></select></div>');
    h.push('<div class="tk-form-f"><label class="tk-fl">Due Date</label><input type="date" class="tk-inp" id="tk-due" value="' + esc(t.dueDate || '') + '"></div>');
    h.push('</div>');

    h.push('<div class="tk-form-r">');
    h.push('<div class="tk-form-f"><label class="tk-fl">Priority</label><select class="tk-inp" id="tk-prio"><option value="low"' + (t.priority === 'low' ? ' selected' : '') + '>Low</option><option value="medium"' + (t.priority === 'medium' ? ' selected' : '') + '>Medium</option><option value="high"' + (t.priority === 'high' ? ' selected' : '') + '>High</option><option value="urgent"' + (t.priority === 'urgent' ? ' selected' : '') + '>Urgent</option></select></div>');
    h.push('<div class="tk-form-f"><label class="tk-fl">Status</label><select class="tk-inp" id="tk-status"><option value="pending"' + (t.status === 'pending' ? ' selected' : '') + '>Pending</option><option value="in_progress"' + (t.status === 'in_progress' ? ' selected' : '') + '>In Progress</option><option value="done"' + (t.status === 'done' ? ' selected' : '') + '>Done</option></select></div>');
    h.push('</div>');

    // Activity log
    if (t.activity && t.activity.length) {
      h.push('<div class="tk-form-s"><label class="tk-fl">Activity</label><div class="tk-activity">');
      t.activity.forEach(function (a) {
        h.push('<div class="tk-activity-item"><span class="tk-activity-action">' + esc(a.action) + '</span>' + esc(a.detail || '') + ' <span class="tk-activity-meta">' + esc(a.author) + ' · ' + fmtDate(a.timestamp) + '</span></div>');
      });
      h.push('</div></div>');
    }

    if (t.createdBy) {
      h.push('<div class="tk-form-s"><p style="font-size:0.75rem;color:var(--muted)">Created by ' + esc(t.createdBy) + ' on ' + fmtDate(t.createdAt) + '</p></div>');
    }

    h.push('</div>');
    return h.join('');
  }

  function _bindForm() {
    document.getElementById('tk-form-back').addEventListener('click', function () {
      st.mode = 'list';
      st.editing = null;
      _fetchPage();
    });

    // Populate assigned-to dropdown with project members
    var assignSel = document.getElementById('tk-assign');
    if (assignSel && st.projectId) {
      fetch('/api/projects/' + st.projectId + '/members', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          var members = d.members || [];
          var html = '<option value="">— Unassigned —</option>';
          members.forEach(function(m) {
            var name = m.name || m.username || m.email || m.user_id;
            var sel = st.editing && st.editing.assignedTo === name ? ' selected' : '';
            html += '<option value="' + esc(name) + '"' + sel + '>' + esc(name) + '</option>';
          });
          assignSel.innerHTML = html;
        })
        .catch(function() {});
    }

    document.getElementById('tk-form-save').addEventListener('click', function () {
      var t = st.editing;
      var oldStatus = t.status;

      t.title = (document.getElementById('tk-title')?.value || '').trim();
      if (!t.title) { alert('Title is required.'); return; }

      t.description = (document.getElementById('tk-desc')?.value || '').trim();
      var oldAssigned = t.assignedTo || '';
      t.assignedTo = (document.getElementById('tk-assign')?.value || '').trim();
      // Send push notification if this is a new assignment
      if (t.assignedTo && oldAssigned !== t.assignedTo) {
        try {
          fetch('https://ntfy.sh/alfr-hermes-tasks', {
            method: 'POST',
            body: t.assignedTo + ' assigned: ' + t.title,
            headers: { 'Title': 'Task Assigned', 'Priority': 'default' }
          }).catch(function(){});
        } catch(e) {}
      }
      t.dueDate = document.getElementById('tk-due')?.value || '';
      t.priority = document.getElementById('tk-prio')?.value || 'medium';
      t.status = document.getElementById('tk-status')?.value || 'pending';
      t.updatedAt = nowISO();

      if (!t.createdAt) {
        t.createdAt = nowISO();
        _addActivity(t, 'created', 'Task opened');
      }
      if (oldStatus && oldStatus !== t.status) {
        _addActivity(t, 'status_change', oldStatus + ' → ' + t.status);
      }
      if (!t.id) t.id = uid();
      if (!t.createdBy) t.createdBy = getUser();

      S().saveRecord(st.projectId, CAT, t);
      st.mode = 'list';
      st.editing = null;
      _fetchPage();
    });
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  global.AlignTasks = Object.freeze({ render: render, CATEGORY: CAT });
  if (window.TileRegistry) window.TileRegistry.register({ id: 'tasks', title: 'Tasks', icon: '[]', route: 'tasks', roles: ['user','admin'], order: 6 });
})(window);

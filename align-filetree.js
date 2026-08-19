/* align-filetree.js — the auto-filing tree (Phase 4).
 * Mounted by AlignFiles into #af-tree-pane. Consumes the FLAT path-map from
 * GET /api/projects/:pid/files/tree and builds the drawer/drill-down client-side.
 */
(function (global) {
  'use strict';

  var TILES = [
    { key: 'daily-logs', label: 'Daily Logs', icon: '📅', accent: '#2f6fed' },
    { key: 'drawing',    label: 'Drawings',   icon: '📐', accent: '#7c3aed' },
    { key: 'punchlist',  label: 'Punch List', icon: '🔧', accent: '#dc2626' },
    { key: 'rfis',       label: 'RFIs',       icon: '❓', accent: '#0891b2' },
    { key: 'submittals', label: 'Submittals', icon: '📋', accent: '#059669' },
    { key: 'tasks',      label: 'Tasks',      icon: '✅', accent: '#d97706' },
    { key: 'contracts',  label: 'Contracts',  icon: '📝', accent: '#475569' },
    { key: 'specs',      label: 'Specifications', icon: '📑', accent: '#b45309' }
  ];
  function tileDef(k) { for (var i = 0; i < TILES.length; i++) if (TILES[i].key === k) return TILES[i]; return null; }

  var DATE_TILES = ['daily-logs'];
  var SPEC_TILES = ['submittals', 'specs'];

  var _pid = null, _container = null, _opts = null;
  var _data = null, _error = null, _loading = false;
  var _path = [], _nfOpen = false, _nfDraft = {};
  var _wiredFor = null, _specCache = null, _specPromise = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(n) { if (n == null) return ''; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function fmtDate(v) { if (!v) return ''; var d = new Date(v); if (isNaN(d)) return ''; return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function token() { try { return localStorage.getItem('align-token') || ''; } catch (e) { return ''; } }
  function authHdr(json) { var h = { 'Authorization': 'Bearer ' + token() }; if (json) h['Content-Type'] = 'application/json'; return h; }

  function mount(container, projectId, opts) {
    _pid = projectId; _container = container; _opts = opts || {};
    _resetState();
    _injectCss();
    _wire(container);
    _paint();
    _fetch(projectId);
  }
  function refresh() { if (_pid) { _loading = true; _paint(); _fetch(_pid); } }

  function _resetState() {
    _data = null; _error = null; _loading = true;
    _path = []; _nfOpen = false; _nfDraft = {};
  }

  function _fetch(pid) {
    fetch('/api/projects/' + encodeURIComponent(pid) + '/files/tree', { headers: authHdr() })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        if (pid !== _pid) return;
        _data = { files: (json && json.files) || [], needsFiling: (json && json.needsFiling) || [], tileCounts: (json && json.tileCounts) || {}, legacyCount: (json && json.legacyCount) || 0 };
        _error = null;
        if (_path.length && !_levelExists()) _path = [];
      })
      .catch(function (e) {
        if (pid !== _pid) return;
        _error = (e && e.message) || 'Could not load files';
        _data = null;
      })
      .then(function () {
        if (pid !== _pid) return;
        _loading = false;
        _paint();
      });
  }

  /* ── tree helpers (client-side grouping of the flat path-map) ── */
  function _matches(f, tileKey, segs) {
    if (f.source_tile !== tileKey) return false;
    for (var i = 0; i < segs.length; i++) {
      if (!f.path[i] || f.path[i].key !== segs[i]) return false;
    }
    return true;
  }
  function _children(tileKey, segs) {
    var folders = {}, files = [];
    (_data.files || []).forEach(function (f) {
      if (!_matches(f, tileKey, segs)) return;
      var next = f.path[segs.length];
      if (next) {
        if (!folders[next.key]) folders[next.key] = { key: next.key, label: next.label, count: 0 };
        folders[next.key].count++;
      } else {
        files.push(f);
      }
    });
    return { folders: folders, files: files };
  }
  function _levelExists() {
    if (!_path.length) return true;
    var tileKey = _path[0], segs = _path.slice(1);
    var c = _children(tileKey, segs);
    return Object.keys(c.folders).length > 0 || c.files.length > 0;
  }

  /* ── delegated wiring (one listener per mount node — iOS-safe) ── */
  function _wire(container) {
    if (_wiredFor === container) return;
    _wiredFor = container;

    container.addEventListener('click', function (ev) {
      var t;
      if ((t = ev.target.closest('[data-ft-crumb]'))) { _path = _path.slice(0, parseInt(t.getAttribute('data-ft-crumb'), 10) || 0); _render(); return; }
      if ((t = ev.target.closest('[data-ft-tile]'))) { _path = [t.getAttribute('data-ft-tile')]; _render(); return; }
      if ((t = ev.target.closest('[data-ft-legacy]'))) { if (_opts && typeof _opts.onOpenLegacy === 'function') _opts.onOpenLegacy(_pid); return; }
      if ((t = ev.target.closest('[data-ft-seg]'))) { _path = _path.concat([t.getAttribute('data-ft-seg')]); _render(); return; }
      if ((t = ev.target.closest('[data-ft-nf-toggle]'))) { _nfOpen = !_nfOpen; _render(); return; }
      if ((t = ev.target.closest('[data-ft-file-btn]'))) { _submitClassify(t); return; }
      if ((t = ev.target.closest('[data-ft-nf-delete]'))) { _confirmDelete(t.getAttribute('data-ft-nf-delete')); return; }
      if ((t = ev.target.closest('[data-ft-delete]'))) { _confirmDelete(t.getAttribute('data-ft-delete')); return; }
      if ((t = ev.target.closest('[data-ft-retry]'))) { refresh(); return; }
      if ((t = ev.target.closest('[data-ft-file]'))) {
        if (_opts && typeof _opts.onOpenFile === 'function') _opts.onOpenFile(t.getAttribute('data-ft-file'));
        return;
      }
    });

    container.addEventListener('change', function (ev) {
      var sel = ev.target.closest('[data-ft-nf-tile]');
      if (sel) { _syncNfRow(sel); return; }
      var row = ev.target.closest('[data-ft-nf-row]');
      if (row) _validateNfRow(row);
    });

    container.addEventListener('input', function (ev) {
      var row = ev.target.closest('[data-ft-nf-row]');
      if (row) _validateNfRow(row);
    });

    container.addEventListener('focusout', function (ev) {
      var row = ev.target.closest('[data-ft-nf-row]');
      if (row) _validateNfRow(row);
    });
  }

  /* ── Needs Filing row logic ── */
  function _syncNfRow(sel) {
    var row = sel.closest('[data-ft-nf-row]');
    if (!row) return;
    var tile = sel.value;
    var dateEl = row.querySelector('[data-ft-nf-date]');
    var specEl = row.querySelector('[data-ft-nf-spec]');
    dateEl.hidden = DATE_TILES.indexOf(tile) === -1;
    specEl.hidden = SPEC_TILES.indexOf(tile) === -1;
    if (!specEl.hidden && !specEl.getAttribute('data-filled')) {
      _loadSpecSections().then(function (sections) {
        if (!row.isConnected) return;
        _fillSpecSelect(specEl, sections, (_nfDraft[row.getAttribute('data-id')] || {}).spec);
        _validateNfRow(row);
      });
    }
    _validateNfRow(row);
  }
  function _validateNfRow(row) {
    var id = row.getAttribute('data-id');
    var tile = row.querySelector('[data-ft-nf-tile]').value;
    var dateEl = row.querySelector('[data-ft-nf-date]');
    var specEl = row.querySelector('[data-ft-nf-spec]');
    var btn = row.querySelector('[data-ft-file-btn]');
    _nfDraft[id] = { tile: tile, date: dateEl.value, spec: specEl.value };
    var ok = !!tile;
    if (ok && DATE_TILES.indexOf(tile) !== -1 && !dateEl.value) ok = false;
    if (ok && SPEC_TILES.indexOf(tile) !== -1 && !specEl.value) ok = false;
    btn.disabled = !ok;
  }
  function _loadSpecSections() {
    if (_specCache) return Promise.resolve(_specCache);
    if (!_specPromise) {
      _specPromise = fetch('/api/spec-sections', { headers: authHdr() })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (j) { _specCache = (j && j.sections) || []; return _specCache; })
        .catch(function () { _specPromise = null; return []; });
    }
    return _specPromise;
  }
  function _fillSpecSelect(specEl, sections, selected) {
    var html = '<option value="">Spec section…</option>';
    sections.forEach(function (s) {
      var code = s.code || s.section || '';
      var title = s.title || '';
      html += '<option value="' + esc(code) + '"' + (selected === code ? ' selected' : '') + '>' + esc(code + (title ? ' — ' + title : '')) + '</option>';
    });
    specEl.innerHTML = html;
    specEl.setAttribute('data-filled', '1');
  }
  function _submitClassify(btn) {
    var row = btn.closest('[data-ft-nf-row]');
    if (!row || btn.disabled) return;
    var id = row.getAttribute('data-id');
    var draft = _nfDraft[id] || {};
    var errEl = row.querySelector('.ft-nf-err');
    var pidAtSubmit = _pid;

    var payload = { source_tile: draft.tile };
    if (DATE_TILES.indexOf(draft.tile) !== -1) payload.doc_date = draft.date;
    if (SPEC_TILES.indexOf(draft.tile) !== -1) payload.spec_section = draft.spec;

    btn.disabled = true;
    btn.textContent = 'Filing…';
    if (errEl) errEl.textContent = '';

    fetch('/api/files/' + encodeURIComponent(id) + '/classify', { method: 'PATCH', headers: authHdr(true), body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function () {
        if (pidAtSubmit !== _pid) return;
        delete _nfDraft[id];
        if (_data) {
          _data.needsFiling = _data.needsFiling.filter(function (f) { return String(f.id) !== String(id); });
          if (!_data.needsFiling.length) _nfOpen = false;
        }
        _render();
        refresh();
      })
      .catch(function (e) {
        if (pidAtSubmit !== _pid) return;
        btn.disabled = false;
        btn.textContent = 'File it';
        if (errEl) errEl.textContent = "Couldn't file this — try again.";
      });
  }

  function _confirmDelete(fileId) {
    fetch('/api/files/' + encodeURIComponent(fileId) + '/references', { headers: authHdr() })
      .then(function (r) { return r.ok ? r.json() : { count: 0, surfaces: [] }; })
      .then(function (refs) {
        var msg = 'Delete this file?\n\n';
        if (refs.count > 0) {
          msg += 'It appears in ' + refs.count + ' record(s) and will show as "deleted" there — it won\'t silently disappear.\n';
        } else {
          msg += "It isn't referenced anywhere.\n";
        }
        msg += 'The file moves to Trash and can be restored.';
        if (!confirm(msg)) return;
        fetch('/api/files/' + encodeURIComponent(fileId), { method: 'DELETE', headers: authHdr() })
          .then(function (r) {
            if (r.ok) { refresh(); }
            else return r.json().then(function (e) { alert(e.error || 'Delete failed'); });
          });
      });
  }

  /* ── paint + render ── */
  function _paint() {
    if (!_container) return;
    _injectCss();
    _wire(_container);
    if (_loading) { _container.innerHTML = '<div class="ft-skel"><div class="ft-skel__card"></div><div class="ft-skel__card"></div><div class="ft-skel__card"></div><div class="ft-skel__card"></div></div>'; return; }
    if (_error) { _container.innerHTML = '<div class="ft-error"><p>Couldn\'t load files. ' + esc(_error) + '</p><button type="button" class="ft-btn" data-ft-retry>Try again</button></div>'; return; }
    if (!_data) { _container.innerHTML = '<div class="ft-empty">No files yet.</div>'; return; }
    _render();
  }
  function _render() {
    if (!_container || !_data) return;
    _container.innerHTML = _path.length ? _htmlLevel() : (_htmlNeedsFiling() + _htmlRoot());
  }

  function _htmlRoot() {
    var cards = '';
    TILES.forEach(function (t) {
      var count = _data.tileCounts[t.key] || 0;
      if (!count) return;
      cards += '<button type="button" class="ft-card" data-ft-tile="' + esc(t.key) + '" style="--ft-accent:' + esc(t.accent) + '">' +
        '<span class="ft-card__icon">' + t.icon + '</span>' +
        '<span class="ft-card__label">' + esc(t.label) + '</span>' +
        '<span class="ft-card__count">' + count + ' ' + (count === 1 ? 'file' : 'files') + '</span></button>';
    });
    if (_data.legacyCount > 0) {
      cards += '<button type="button" class="ft-card ft-card--legacy" data-ft-legacy>' +
        '<span class="ft-card__icon">🗄️</span>' +
        '<span class="ft-card__label">Legacy folders</span>' +
        '<span class="ft-card__count">' + _data.legacyCount + ' unmigrated</span></button>';
    }
    if (!cards) return '<div class="ft-empty">No files yet — anything you upload will show up here.</div>';
    return '<div class="ft-root">' + cards + '</div>';
  }

  function _htmlLevel() {
    var tileKey = _path[0], segs = _path.slice(1);
    var tile = tileDef(tileKey);
    var c = _children(tileKey, segs);
    if (!Object.keys(c.folders).length && !c.files.length) { _path = []; return _htmlNeedsFiling() + _htmlRoot(); }

    var crumbs = '<button type="button" class="ft-crumb" data-ft-crumb="0">All files</button>';
    for (var i = 0; i < _path.length; i++) {
      var label = (i === 0 && tile) ? tile.label : _path[i];
      crumbs += '<span class="ft-crumb__sep">/</span>';
      crumbs += (i === _path.length - 1)
        ? '<span class="ft-crumb ft-crumb--here">' + esc(label) + '</span>'
        : '<button type="button" class="ft-crumb" data-ft-crumb="' + (i + 1) + '">' + esc(label) + '</button>';
    }

    var folderKeys = Object.keys(c.folders).sort();
    var rows = '';
    folderKeys.forEach(function (k) {
      var f = c.folders[k];
      rows += '<button type="button" class="ft-row ft-row--folder" data-ft-seg="' + esc(k) + '">' +
        '<span class="ft-row__icon">📂</span>' +
        '<span class="ft-row__name">' + esc(f.label) + '</span>' +
        '<span class="ft-row__meta">' + f.count + '</span>' +
        '<span class="ft-chev">›</span></button>';
    });
    c.files.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); }).forEach(function (f) {
      rows += '<div class="ft-row ft-row--file" data-ft-file="' + esc(f.id) + '" role="button" tabindex="0">' +
        _htmlThumb(f) +
        '<span class="ft-row__name">' + esc(f.name) + '</span>' +
        '<span class="ft-row__meta">' + esc(fmtSize(f.size)) + '</span>' +
        '<button type="button" class="ft-del-btn" data-ft-delete="' + esc(f.id) + '" title="Delete">🗑</button>' +
        '</div>';
    });
    if (!rows) rows = '<div class="ft-empty">Nothing in here yet.</div>';

    return '<nav class="ft-crumbs">' + crumbs + '</nav><div class="ft-level">' + rows + '</div>';
  }

  function _htmlThumb(f) {
    if (f.thumbUrl) return '<img class="ft-thumb" src="' + esc(f.thumbUrl) + '" alt="" loading="lazy">';
    var m = /\.([a-z0-9]{1,5})$/i.exec(f.name || '');
    var ext = m ? m[1].toUpperCase() : 'FILE';
    return '<span class="ft-ext">' + esc(ext) + '</span>';
  }

  function _htmlNeedsFiling() {
    var list = _data.needsFiling || [];
    if (!list.length) return '';
    var head = '<button type="button" class="ft-nf__head" data-ft-nf-toggle aria-expanded="' + _nfOpen + '">' +
      '<span class="ft-nf__badge">' + list.length + '</span>' +
      '<span class="ft-nf__title">Needs filing</span>' +
      '<span class="ft-chev' + (_nfOpen ? ' ft-chev--open' : '') + '">›</span></button>';
    var body = '';
    if (_nfOpen) body = '<ul class="ft-nf-list">' + list.map(_htmlNfRow).join('') + '</ul>';
    return '<section class="ft-nf">' + head + body + '</section>';
  }

  function _htmlNfRow(f) {
    var d = _nfDraft[f.id] || {};
    var tileOpts = '<option value="">Choose a tile…</option>';
    TILES.forEach(function (t) {
      tileOpts += '<option value="' + esc(t.key) + '"' + (d.tile === t.key ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    });
    var needDate = DATE_TILES.indexOf(d.tile) !== -1;
    var needSpec = SPEC_TILES.indexOf(d.tile) !== -1;

    var specOpts = '<option value="">Spec section…</option>';
    (_specCache || []).forEach(function (s) {
      var code = s.code || s.section || '';
      specOpts += '<option value="' + esc(code) + '"' + (d.spec === code ? ' selected' : '') + '>' + esc(code + (s.title ? ' — ' + s.title : '')) + '</option>';
    });

    return '<li class="ft-nf-row" data-ft-nf-row data-id="' + esc(f.id) + '">' +
      '<div class="ft-nf-meta">' + _htmlThumb(f) +
        '<div class="ft-nf-meta__txt">' +
          '<span class="ft-row__name">' + esc(f.name) + '</span>' +
          '<span class="ft-row__meta">' + esc(fmtSize(f.size)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="ft-nf-form">' +
        '<select class="ft-input" data-ft-nf-tile>' + tileOpts + '</select>' +
        '<input type="date" class="ft-input" data-ft-nf-date value="' + esc(d.date || '') + '"' + (needDate ? '' : ' hidden') + '>' +
        '<select class="ft-input" data-ft-nf-spec' + (_specCache ? ' data-filled="1"' : '') + (needSpec ? '' : ' hidden') + '>' + specOpts + '</select>' +
        '<button type="button" class="ft-file-btn" data-ft-file-btn disabled>File it</button>' +
        '<button type="button" class="ft-del-btn" data-ft-nf-delete="' + esc(f.id) + '" title="Delete">🗑</button>' +
        '<span class="ft-nf-err"></span>' +
      '</div></li>';
  }

  /* ── CSS ── */
  var _cssDone = false;
  function _injectCss() {
    if (_cssDone || document.getElementById('align-filetree-css')) { _cssDone = true; return; }
    _cssDone = true;
    var st = document.createElement('style');
    st.id = 'align-filetree-css';
    st.textContent =
'.ft-root{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:4px 0}' +
'@media(min-width:720px){.ft-root{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}}' +
'.ft-card{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:16px;border:1px solid var(--align-line);border-radius:16px;background:var(--align-surface);cursor:pointer;text-align:left;box-shadow:var(--align-shadow-card)}' +
'.ft-card:active{background:var(--align-line)}' +
'.ft-card__icon{font-size:22px;line-height:1}' +
'.ft-card__label{font-size:14px;font-weight:700;color:var(--align-navy)}' +
'.ft-card__count{font-size:12px;color:var(--align-muted)}' +
'.ft-card--legacy{opacity:.7;border-style:dashed}' +
'.ft-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:4px 0 12px;font-size:13px}' +
'.ft-crumb{border:0;background:none;color:var(--align-orange);font-weight:600;font-size:13px;cursor:pointer;padding:2px 4px}' +
'.ft-crumb--here{color:var(--align-navy);font-weight:700}' +
'.ft-crumb__sep{color:var(--align-muted)}' +
'.ft-level{display:flex;flex-direction:column}' +
'.ft-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--align-line);background:none;border-left:0;border-right:0;border-top:0;cursor:pointer;text-align:left;font-size:14px}' +
'.ft-row__icon{font-size:18px}' +
'.ft-row__name{flex:1;min-width:0;color:var(--align-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
'.ft-row__meta{flex:none;font-size:12px;color:var(--align-muted)}' +
'.ft-chev{flex:none;color:var(--align-muted);font-size:18px}' +
'.ft-chev--open{transform:rotate(90deg)}' +
'.ft-thumb{flex:0 0 40px;width:40px;height:40px;border-radius:8px;object-fit:cover;background:var(--align-line)}' +
'.ft-ext{flex:0 0 40px;width:40px;height:40px;border-radius:8px;background:var(--align-line);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:var(--align-muted);letter-spacing:.03em}' +
'.ft-empty{padding:36px 16px;text-align:center;color:var(--align-muted);font-size:14px}' +
'.ft-error{padding:36px 16px;text-align:center}' +
'.ft-error p{color:var(--align-muted);margin:0 0 12px}' +
'.ft-btn{border:1px solid var(--align-line);background:var(--align-surface);color:var(--align-navy);border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}' +
'.ft-skel{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}' +
'.ft-skel__card{height:90px;border-radius:16px;background:var(--align-line);opacity:.5}' +
'.ft-nf{margin:0 0 12px;border:1px solid #e8d48a;border-radius:14px;overflow:hidden}' +
'.ft-nf__head{display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;border:0;background:#fdf6dd;cursor:pointer;text-align:left}' +
'.ft-nf__badge{min-width:22px;height:22px;border-radius:11px;background:#b45309;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 6px}' +
'.ft-nf__title{flex:1;font-size:14px;font-weight:700;color:#6b5500}' +
'.ft-nf-list{list-style:none;margin:0;padding:0;background:var(--align-surface);border-top:1px solid var(--align-line)}' +
'.ft-nf-row{padding:12px 14px;border-bottom:1px solid var(--align-line)}' +
'.ft-nf-meta{display:flex;align-items:center;gap:10px}' +
'.ft-nf-meta__txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
'.ft-nf-form{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}' +
'.ft-input{border:1px solid var(--align-line);border-radius:8px;padding:7px 9px;font-size:13px;background:var(--align-surface);color:var(--align-text);min-width:0;flex:1 1 120px}' +
'.ft-file-btn{border:0;background:var(--align-orange);color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;flex:0 0 auto}' +
'.ft-file-btn:disabled{opacity:.4}' +
'.ft-nf-err{flex-basis:100%;font-size:12px;color:#b3261e}' +
'.ft-del-btn{border:0;background:none;color:var(--align-muted);font-size:16px;cursor:pointer;padding:4px;flex:none;opacity:.7}' +
'.ft-del-btn:active{opacity:1;color:#b3261e}';
    document.head.appendChild(st);
  }

  global.AlignFileTree = { mount: mount, refresh: refresh };
})(window);

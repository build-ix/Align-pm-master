/* align-documents.js
 * Document register — the "Documents" redesign of the Files tile.
 * Register (ledger of controlled documents) + promote sheet + detail screen.
 * Backed by /api/projects/:pid/documents (Phase B).
 */
(function (global) {
  'use strict';

  var CATEGORIES = [
    { key: 'drawings',   label: 'Drawings' },
    { key: 'specs',      label: 'Specs' },
    { key: 'submittals', label: 'Submittals' },
    { key: 'contracts',  label: 'Contracts & COs' },
    { key: 'permits',    label: 'Permits & approvals' },
    { key: 'reports',    label: 'Reports & inspections' },
    { key: 'closeout',   label: 'Closeout' },
    { key: 'other',      label: 'Other' }
  ];
  var STATUSES = [
    { key: 'needs-review',        label: 'Needs review', cls: 'ad-st-review' },
    { key: 'approved',            label: 'Approved',     cls: 'ad-st-ok' },
    { key: 'approved-as-noted',   label: 'As noted',     cls: 'ad-st-noted' },
    { key: 'revise-and-resubmit', label: 'Revise',       cls: 'ad-st-revise' },
    { key: 'rejected',            label: 'Rejected',     cls: 'ad-st-reject' }
  ];

  var state = { pid: null, root: null, docs: [], expected: [], counts: {}, filter: null, attnFilter: null, q: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function catLabel(k) { for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === k) return CATEGORIES[i].label; return k; }
  function statusMeta(k) { for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].key === k) return STATUSES[i]; return STATUSES[0]; }
  function fmtDate(iso) { if (!iso) return ''; try { var d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } }
  function fmtBytes(n) { if (!n) return '—'; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function token() { try { return localStorage.getItem('align-token') || ''; } catch (e) { return ''; } }
  function authHeaders(json) {
    var h = { 'Authorization': 'Bearer ' + token() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: authHeaders(!!body), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { if (!x.ok) throw new Error(x.j.error || 'http error'); return x.j; });
  }

  /* ── Register mount / paint ─────────────────────────────────────── */

  function mount(rootEl, projectId) {
    state.root = rootEl; state.pid = projectId;
    injectCss();
    rootEl.innerHTML = _html();
    _bind();
    refresh();
  }

  function refresh() {
    if (!state.root) return;
    api('GET', '/api/projects/' + state.pid + '/documents').then(function (data) {
      state.docs = data.documents || [];
      state.expected = data.expected || [];
      state.counts = data.counts || {};
      _paint();
    }).catch(function (e) {
      if (state.root) state.root.querySelector('#ad-list').innerHTML = '<div class="ad-empty"><div class="ad-empty-big">Couldn\u2019t load the register</div><div class="ad-empty-sub">' + esc(e.message) + '</div></div>';
    });
  }

  function _html() {
    return '' +
      '<div class="ad-head"><div class="ad-title">Document register</div>' +
        '<button type="button" class="ad-btn-ghost" id="ad-add">+ Add</button>' +
        '<button type="button" class="ad-btn-ghost" id="ad-export">Export</button></div>' +
      '<div id="ad-attn"></div>' +
      '<div class="ad-chips" id="ad-chips"></div>' +
      '<div id="ad-meter"></div>' +
      '<div class="ad-list" id="ad-list"></div>';
  }

  function _bind() {
    var root = state.root;
    root.querySelector('#ad-add').onclick = function () { openPromoteSheet(null, {}); };
    root.querySelector('#ad-export').onclick = function () {
      fetch('/api/projects/' + state.pid + '/documents/export.html', { headers: authHeaders() })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var blob = new Blob([html], { type: 'text/html' });
          window.open(URL.createObjectURL(blob), '_blank');
        })
        .catch(function () { alert('Could not generate export'); });
    };
    root.onclick = function (ev) {
      var t = ev.target;
      var chip = t.closest ? t.closest('[data-cat]') : null;
      if (chip) { var k = chip.getAttribute('data-cat'); state.filter = (state.filter === k) ? null : k; _paint(); return; }
      var attn = t.closest ? t.closest('[data-attn]') : null;
      if (attn) { var a = attn.getAttribute('data-attn'); state.attnFilter = (state.attnFilter === a) ? null : a; _paint(); return; }
      var row = t.closest ? t.closest('[data-doc-id]') : null;
      if (row) { openDetail(row.getAttribute('data-doc-id')); return; }
      var ghost = t.closest ? t.closest('[data-expected-id]') : null;
      if (ghost) { openPromoteSheet(null, { expectedId: ghost.getAttribute('data-expected-id'), expectedTitle: ghost.getAttribute('data-expected-title') }); return; }
    };
  }

  function _paint() { paintAttention(); paintChips(); paintMeter(); paintList(); }

  function paintAttention() {
    var c = state.counts || {};
    var items = [];
    if (c.needs_review)   items.push('<button type="button" class="ad-attn ad-attn-review' + (state.attnFilter === 'needs-review' ? ' ad-attn-on' : '') + '" data-attn="needs-review"><b>' + c.needs_review + '</b> need review</button>');
    if (c.revise_resubmit) items.push('<button type="button" class="ad-attn ad-attn-revise' + (state.attnFilter === 'revise-and-resubmit' ? ' ad-attn-on' : '') + '" data-attn="revise-and-resubmit"><b>' + c.revise_resubmit + '</b> revise &amp; resubmit</button>');
    if (c.missing)        items.push('<button type="button" class="ad-attn ad-attn-missing' + (state.attnFilter === 'missing' ? ' ad-attn-on' : '') + '" data-attn="missing"><b>' + c.missing + '</b> missing</button>');
    state.root.querySelector('#ad-attn').innerHTML = items.length ? '<div class="ad-attn-strip">' + items.join('') + '</div>' : '';
  }

  function paintChips() {
    var counts = {};
    state.docs.forEach(function (d) { counts[d.category] = (counts[d.category] || 0) + 1; });
    var html = CATEGORIES.map(function (c) {
      var n = counts[c.key] || 0;
      return '<button type="button" class="ad-chip' + (state.filter === c.key ? ' ad-chip-on' : '') + '" data-cat="' + c.key + '">' +
             esc(c.label) + (n ? ' <span class="ad-chip-n">' + n + '</span>' : '') + '</button>';
    }).join('');
    state.root.querySelector('#ad-chips').innerHTML = html;
  }

  function paintMeter() {
    var closeout = state.expected.filter(function (e) { return e.category === 'closeout'; });
    var el = state.root.querySelector('#ad-meter');
    if (!closeout.length) { el.innerHTML = ''; return; }
    var done = closeout.filter(function (e) { return e.fulfilled_by_document_id; }).length;
    var pct = Math.round(done / closeout.length * 100);
    el.innerHTML = '<div class="ad-meter"><div class="ad-meter-label">Closeout ' + done + '/' + closeout.length + ' complete</div>' +
      '<div class="ad-meter-track"><div class="ad-meter-fill" style="width:' + pct + '%"></div></div></div>';
  }

  function visibleDocs() {
    var docs = state.docs;
    if (state.filter) docs = docs.filter(function (d) { return d.category === state.filter; });
    if (state.attnFilter && state.attnFilter !== 'missing') docs = docs.filter(function (d) { return d.status === state.attnFilter; });
    return docs;
  }

  function paintList() {
    var docs = visibleDocs();
    var ghosts = state.expected.filter(function (e) {
      if (e.fulfilled_by_document_id) return false;
      if (state.filter && e.category !== state.filter) return false;
      return true;
    });
    if (state.attnFilter === 'missing') docs = [];

    var list = state.root.querySelector('#ad-list');
    if (!docs.length && !ghosts.length) {
      list.innerHTML = '<div class="ad-empty"><div class="ad-empty-big">No documents in the register yet</div>' +
        '<div class="ad-empty-sub">Upload files in the Folders tab and tap \u201cAdd to Register\u201d, or tap \u201c+ Add\u201d here.</div></div>';
      return;
    }

    var byCat = {};
    docs.forEach(function (d) { (byCat[d.category] = byCat[d.category] || { docs: [], ghosts: [] }).docs.push(d); });
    ghosts.forEach(function (e) { (byCat[e.category] = byCat[e.category] || { docs: [], ghosts: [] }).ghosts.push(e); });

    var out = [];
    CATEGORIES.forEach(function (c) {
      var g = byCat[c.key];
      if (!g) return;
      out.push('<div class="ad-group-head">' + esc(c.label) + '</div>');
      g.docs.forEach(function (d) { out.push(rowHtml(d)); });
      g.ghosts.forEach(function (e) { out.push(ghostRowHtml(e)); });
    });
    list.innerHTML = out.join('');
  }

  function rowHtml(d) {
    var cur = d.current_revision;
    var st = statusMeta(d.status);
    var thumb = cur
      ? '<div class="ad-thumb"><img src="/api/files/' + esc(cur.id) + '?thumb=1" alt="" loading="lazy" onerror="this.style.display=\'none\'"></div>'
      : '<div class="ad-thumb ad-thumb-x">DOC</div>';
    return '' +
      '<div class="ad-row" data-doc-id="' + esc(d.id) + '">' +
        thumb +
        '<div class="ad-row-main">' +
          '<div class="ad-row-l1">' +
            (d.number ? '<span class="ad-num">' + esc(d.number) + '</span>' : '') +
            '<span class="ad-doc-title">' + esc(d.title) + '</span>' +
          '</div>' +
          '<div class="ad-row-l2">' +
            (cur && cur.revision ? '<span class="ad-pill ad-pill-rev">Rev ' + esc(cur.revision) + '</span>' : '') +
            '<span class="ad-pill ' + st.cls + '">' + st.label + '</span>' +
            (d.discipline ? '<span class="ad-pill ad-pill-disc">' + esc(d.discipline) + '</span>' : '') +
            (d.link_count ? '<span class="ad-links">🔗 ' + d.link_count + '</span>' : '') +
            '<span class="ad-date">' + fmtDate(cur ? cur.created_at : d.created_at) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ad-chev">›</div>' +
      '</div>';
  }

  function ghostRowHtml(e) {
    return '' +
      '<div class="ad-row ad-row-ghost" data-expected-id="' + esc(e.id) + '" data-expected-title="' + esc(e.title) + '">' +
        '<div class="ad-thumb ad-thumb-ghost">?</div>' +
        '<div class="ad-row-main">' +
          '<div class="ad-row-l1"><span class="ad-doc-title ad-ghost-title">' + esc(e.title) + '</span></div>' +
          '<div class="ad-row-l2"><span class="ad-pill ad-pill-missing">Missing</span><span class="ad-ghost-hint">Tap to add</span></div>' +
        '</div>' +
      '</div>';
  }

  /* ── Phase D: promote sheet (Add to Register) ───────────────────── */

  var DISC_MAP = { A: 'Architectural', S: 'Structural', E: 'Electrical', M: 'Mechanical', P: 'Plumbing', C: 'Civil', FP: 'Fire Protection', ID: 'Interiors', L: 'Landscape' };
  var RX_DRAWING   = /^(A|S|E|M|P|C|FP|ID|L)[-_ ]?(\d{2,3})(?:[.\-](\d{1,2}))?/i;
  var RX_REV       = /(?:^|[_ -])(?:R|REV|Rev|rev)[\s.\-]?(\d{1,2}|[A-Z])(?:[)\s._\-]|$)/;
  var RX_SUBMITTAL = /^(?:SUB|SUBMITTAL)[-_ ]?(\d{2,4})/i;
  var RX_SPECSEC   = /^(\d{2})[\s.\-]?(\d{2})[\s.\-]?(\d{2})\b/;

  function classifyFilename(name) {
    var base = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '');
    var rev = (base.match(RX_REV) || [])[1] || '';
    var m;
    if ((m = base.match(RX_DRAWING))) {
      var disc = m[1].toUpperCase();
      var number = disc + '-' + m[2] + (m[3] ? '.' + m[3] : '');
      var title = base.replace(RX_DRAWING, '').replace(RX_REV, ' ').replace(/[_\-]+/g, ' ').trim();
      return { category: 'drawings', discipline: DISC_MAP[disc] || disc, number: number, revision: rev, title: title };
    }
    if ((m = base.match(RX_SUBMITTAL)))
      return { category: 'submittals', discipline: '', number: 'SUB-' + m[1], revision: rev,
               title: base.replace(RX_SUBMITTAL, '').replace(RX_REV, ' ').replace(/[_\-]+/g, ' ').trim() };
    if ((m = base.match(RX_SPECSEC)))
      return { category: 'specs', discipline: '', number: m[1] + ' ' + m[2] + ' ' + m[3], revision: rev,
               title: base.replace(RX_SPECSEC, '').replace(/[_\-]+/g, ' ').trim() };
    var lower = base.toLowerCase();
    var category = /contract|agreement|change[_ -]?order|\bco\d/.test(lower) ? 'contracts'
                 : /report|inspection|test/.test(lower) ? 'reports'
                 : 'other';
    return { category: category, discipline: '', number: '', revision: rev, title: base.replace(/[_\-]+/g, ' ').trim() };
  }

  // Increment a revision label: 1→2, A→B, Z→AA, C02→C03 (padding preserved).
  function nextRevision(rev) {
    rev = String(rev == null ? '' : rev).trim().toUpperCase();
    if (!rev) return 'A';
    if (/^\d+$/.test(rev)) return String(parseInt(rev, 10) + 1);
    if (/^[A-Z]+$/.test(rev)) {
      var c = rev.split(''), i = c.length - 1;
      while (i >= 0) {
        if (c[i] === 'Z') { c[i] = 'A'; i--; }
        else { c[i] = String.fromCharCode(c[i].charCodeAt(0) + 1); return c.join(''); }
      }
      return 'A' + c.join('');
    }
    var m = rev.match(/^(.*?)(\d+)$/);
    if (m) {
      var n = String(parseInt(m[2], 10) + 1);
      while (n.length < m[2].length) n = '0' + n;
      return m[1] + n;
    }
    return rev + '.1';
  }

  function openSheet(innerHtml) {
    var bg = document.createElement('div');
    bg.className = 'ad-sheet-bg';
    bg.innerHTML = '<div class="ad-sheet"><div class="ad-sheet-grab"></div>' + innerHtml + '</div>';
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('ad-sheet-in'); });
    var close = function () { bg.classList.remove('ad-sheet-in'); setTimeout(function () { bg.remove(); }, 220); };
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    return { root: bg.firstElementChild, close: close };
  }

  function openPromoteSheet(fileIdOrNull, opts) {
    opts = opts || {};
    var pid = opts.projectId || state.pid;
    var guess = classifyFilename(opts.filename || opts.expectedTitle || '');
    if (opts.expectedTitle && !guess.title) guess.title = opts.expectedTitle;

    // Fetch the register to find a number match.
    api('GET', '/api/projects/' + pid + '/documents').then(function (data) {
      var docs = data.documents || [];
      var match = null;
      if (opts.forceDocId) match = docs.find(function (d) { return d.id === opts.forceDocId; });
      else if (guess.number) match = docs.find(function (d) { return d.number && d.number.toUpperCase() === guess.number.toUpperCase(); });

      var nextRev = match ? nextRevision(match.current_revision ? match.current_revision.revision : '') : (guess.revision || 'A');

      var matchHtml = match ? '' +
        '<div class="ad-match">' +
          '<div class="ad-match-head">Matches ' + esc(match.number) + ' · ' + esc(match.title || 'Untitled') + '</div>' +
          '<label class="ad-radio"><input type="radio" name="ad-mode" value="revision" checked>' +
            '<span>Add as Rev ' + esc(nextRev) + '<small>Supersedes Rev ' + esc(match.current_revision ? match.current_revision.revision : '0') + ' · history is kept</small></span></label>' +
          '<label class="ad-radio"><input type="radio" name="ad-mode" value="new">' +
            '<span>File as a new document<small>Creates a separate register entry</small></span></label>' +
        '</div>' : '';

      var catOpts = CATEGORIES.map(function (c) {
        return '<option value="' + c.key + '"' + (c.key === guess.category ? ' selected' : '') + '>' + c.label + '</option>';
      }).join('');

      var sheet = openSheet(
        '<div class="ad-sheet-head"><h3>Add to Register</h3><span class="ad-sheet-cancel" id="adCancel">Cancel</span></div>' +
        (opts.filename ? '<div class="ad-links" style="margin:-6px 0 12px">' + esc(opts.filename) + '</div>' : '') +
        matchHtml +
        '<div id="adNewFields"' + (match ? ' style="display:none"' : '') + '>' +
          '<div class="ad-field-row">' +
            '<div class="ad-field"><label>Category</label><select id="adfCat">' + catOpts + '</select></div>' +
            '<div class="ad-field"><label>Discipline</label><input id="adfDisc" value="' + esc(guess.discipline) + '" placeholder="Architectural"></div>' +
          '</div>' +
          '<div class="ad-field-row">' +
            '<div class="ad-field"><label>Number</label><input id="adfNum" value="' + esc(guess.number) + '" placeholder="A-201"></div>' +
            '<div class="ad-field"><label>Revision</label><input id="adfRev" value="' + esc(guess.revision || 'A') + '"></div>' +
          '</div>' +
          '<div class="ad-field"><label>Title</label><input id="adfTitle" value="' + esc(guess.title) + '" placeholder="Second Floor Plan"></div>' +
        '</div>' +
        '<div id="adRevFields"' + (match ? '' : ' style="display:none"') + '>' +
          '<div class="ad-field-row">' +
            '<div class="ad-field"><label>Revision</label><input id="adfRev2" value="' + esc(nextRev) + '"></div>' +
            '<div class="ad-field"><label>Note (optional)</label><input id="adfNote" placeholder="Issued for construction"></div>' +
          '</div>' +
        '</div>' +
        '<button class="ad-btn-primary" id="adfGo">' + (match ? 'Add revision' : 'Add to register') + '</button>');

      var q = function (sel) { return sheet.root.querySelector(sel); };
      q('#adCancel').onclick = sheet.close;
      sheet.root.querySelectorAll('[name=ad-mode]').forEach(function (r) {
        r.addEventListener('change', function () {
          var rev = q('[name=ad-mode]:checked').value === 'revision';
          q('#adNewFields').style.display = rev ? 'none' : '';
          q('#adRevFields').style.display = rev ? '' : 'none';
          q('#adfGo').textContent = rev ? 'Add revision' : 'Add to register';
        });
      });

      q('#adfGo').addEventListener('click', function () {
        var btn = q('#adfGo'); btn.disabled = true;
        var asRevision = match && q('[name=ad-mode]:checked').value === 'revision';
        var doSubmit = function (fileId, justUploaded) {
          var p;
          if (asRevision) {
            p = api('POST', '/api/documents/' + match.id + '/revisions', { file_id: fileId, revision: q('#adfRev2').value.trim() })
                .then(function () { return match.id; });
          } else {
            var title = q('#adfTitle').value.trim() || opts.expectedTitle || q('#adfNum').value.trim() || 'Untitled';
            p = api('POST', '/api/projects/' + pid + '/documents', {
              file_id: fileId, category: q('#adfCat').value,
              discipline: q('#adfDisc').value.trim() || null,
              number: q('#adfNum').value.trim() || null,
              revision: q('#adfRev').value.trim() || 'A',
              title: title, expected_document_id: opts.expectedId || null
            }).then(function (r) { return r.document.id; });
          }
          p.then(function (docId) {
            sheet.close();
            state.docs = null;
            refresh();
            if (opts.onDone) opts.onDone(docId); else openDetail(docId);
          }).catch(function (e) {
            btn.disabled = false;
            if (justUploaded && fileId) { fetch('/api/files/' + fileId, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token() } }).catch(function () {}); }
            alert('Could not file document: ' + e.message);
          });
        };

        if (!fileIdOrNull) {
          // Need to pick + upload a file first.
          var input = document.createElement('input');
          input.type = 'file';
          input.onchange = function () {
            var f = input.files && input.files[0];
            if (!f) { btn.disabled = false; return; }
            var fd = new FormData();
            fd.append('file', f);
            fd.append('project_id', pid);
            fetch('/api/files/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: fd })
              .then(function (r) { return r.json(); })
              .then(function (up) { doSubmit(up.file.id, true); })
              .catch(function (e) { btn.disabled = false; alert('Upload failed: ' + e.message); });
          };
          input.click();
        } else {
          doSubmit(fileIdOrNull);
        }
      });
    }).catch(function (e) { alert('Could not load register: ' + e.message); });
  }

  /* ── Phase E: document detail screen ────────────────────────────── */

  function pushScreen() {
    var el = document.createElement('div');
    el.className = 'ad-screen';
    document.body.appendChild(el);
    return { el: el, pop: function () { el.remove(); } };
  }

  function openDetail(docId) {
    var screen = pushScreen();
    var el = screen.el;
    el.innerHTML = '<div class="ad-screen-head"><button class="ad-back">‹</button><span class="ad-screen-title">Loading…</span></div>';
    el.querySelector('.ad-back').onclick = screen.pop;

    api('GET', '/api/documents/' + docId).then(function (data) {
      var d = data.document;
      var revisions = data.revisions || [];
      var history = data.status_history || [];
      var cur = revisions[0];
      var st = statusMeta(d.status);
      var lastHist = history[0];

      var thumb = cur
        ? '<div class="ad-thumb"><img src="/api/files/' + esc(cur.id) + '?thumb=1" alt="" onerror="this.style.display=\'none\'"></div>'
        : '<div class="ad-thumb ad-thumb-x">DOC</div>';

      el.innerHTML =
        '<div class="ad-screen-head"><button class="ad-back">‹</button>' +
          '<span class="ad-screen-title">' + esc(d.number || d.title || 'Document') + '</span></div>' +

        '<div class="ad-card"><div class="ad-preview">' + thumb +
          '<div class="ad-row-main">' +
            '<div class="ad-doc-title" style="white-space:normal">' + esc(d.title || cur.original_name || '') + '</div>' +
            (cur ? '<div class="ad-preview-link" id="adOpenFile">Preview ›</div>' : '') +
          '</div></div>' +
          '<div class="ad-row-l2" style="margin-top:12px;flex-wrap:wrap">' +
            '<span class="ad-pill ad-pill-disc">' + esc(catLabel(d.category)) + '</span>' +
            (d.discipline ? '<span class="ad-pill ad-pill-disc">' + esc(d.discipline) + '</span>' : '') +
            (d.number ? '<span class="ad-pill ad-pill-disc">' + esc(d.number) + '</span>' : '') +
            (cur && cur.revision ? '<span class="ad-pill ad-pill-rev">Rev ' + esc(cur.revision) + '</span>' : '') +
            '<span class="ad-pill ' + st.cls + '">' + st.label + '</span>' +
          '</div></div>' +

        '<div class="ad-card"><h4>Status</h4>' +
          '<div class="ad-seg" id="adSeg">' + STATUSES.map(function (s) {
            return '<button data-st="' + s.key + '" class="' + (s.key === d.status ? 'on' : '') + '">' + s.label + '</button>';
          }).join('') + '</div>' +
          '<div class="ad-status-by" id="adStBy">' + (lastHist
            ? 'Marked ' + statusMeta(lastHist.status).label + ' by ' + esc(lastHist.changed_by || '') + ' · ' + fmtDate(lastHist.changed_at)
            : '') + '</div></div>' +

        '<div class="ad-card"><h4>Revisions</h4><div id="adRevs">' + revisions.map(function (r, i) {
          return '<div class="ad-revrow"><span class="ad-pill ad-pill-rev">R' + esc(r.revision) + '</span>' +
            '<span class="ad-doc-title">' + esc(r.original_name || '') + '</span>' +
            (i === 0 ? '<span class="ad-rev-cur">CURRENT</span>' : '') +
            '<span class="ad-date" style="margin-left:auto">' + fmtDate(r.created_at) + '</span></div>';
        }).join('') + '</div>' +
          '<button class="ad-btn-ghost" id="adAddRev" style="margin-top:10px;width:100%">Add revision</button></div>' +

        '<div class="ad-card"><h4>Details</h4>' +
          '<div class="ad-detail-kv"><span>Filename</span><span>' + esc(cur ? cur.original_name : '—') + '</span></div>' +
          '<div class="ad-detail-kv"><span>Size</span><span>' + fmtBytes(cur ? cur.size_bytes : 0) + '</span></div>' +
          '<div class="ad-detail-kv"><span>Uploaded</span><span>' + esc(cur ? cur.uploaded_by || '' : '') + ' · ' + fmtDate(cur ? cur.created_at : '') + '</span></div></div>' +

        '<div class="ad-foot">' +
          '<button class="ad-btn-ghost" id="adDl">Download</button>' +
          '<button class="ad-btn-ghost" id="adRn">Rename</button>' +
          '<button class="ad-btn-ghost ad-danger" id="adTr">Remove</button></div>';

      var q = function (s) { return el.querySelector(s); };
      q('.ad-back').onclick = screen.pop;
      if (q('#adOpenFile')) q('#adOpenFile').onclick = function () { window.open('/api/files/' + cur.id + '?token=' + encodeURIComponent(token()), '_blank'); };

      q('#adSeg').addEventListener('click', function (e) {
        var b = e.target.closest('[data-st]'); if (!b) return;
        api('POST', '/api/documents/' + docId + '/status', { status: b.dataset.st }).then(function (r) {
          el.querySelectorAll('#adSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
          q('#adStBy').textContent = 'Marked ' + statusMeta(b.dataset.st).label + ' by you · ' + fmtDate(new Date().toISOString());
        }).catch(function (err) { alert('Could not set status: ' + err.message); });
      });

      q('#adAddRev').onclick = function () {
        var input = document.createElement('input');
        input.type = 'file';
        input.onchange = function () {
          var f = input.files && input.files[0]; if (!f) return;
          openPromoteSheet(null, { filename: f.name, forceDocId: docId, onDone: function (id) { screen.pop(); openDetail(id); } });
        };
        input.click();
      };

      q('#adDl').onclick = function () { window.open('/api/files/' + cur.id + '?token=' + encodeURIComponent(token()), '_blank'); };
      q('#adRn').onclick = function () {
        var t = prompt('Document title', d.title || ''); if (t == null) return;
        api('PATCH', '/api/documents/' + docId, { title: t.trim() }).then(function () { screen.pop(); openDetail(docId); refresh(); });
      };
      q('#adTr').onclick = function () {
        if (!confirm('Remove this document from the register? Its file stays in Folders.')) return;
        api('DELETE', '/api/documents/' + docId).then(function () { screen.pop(); refresh(); });
      };
    }).catch(function (e) {
      el.innerHTML = '<div class="ad-screen-head"><button class="ad-back">‹</button><span class="ad-screen-title">Error</span></div>' +
        '<div class="ad-empty"><div class="ad-empty-big">Couldn\u2019t load document</div><div class="ad-empty-sub">' + esc(e.message) + '</div></div>';
      el.querySelector('.ad-back').onclick = screen.pop;
    });
  }

  /* ── CSS ────────────────────────────────────────────────────────── */

  var cssDone = false;
  function injectCss() {
    if (cssDone || document.getElementById('ad-css')) { cssDone = true; return; }
    cssDone = true;
    var s = document.createElement('style');
    s.id = 'ad-css';
    s.textContent =
'.ad-head{display:flex;align-items:center;gap:8px;padding:14px 16px 6px}' +
'.ad-title{font-size:18px;font-weight:700;color:var(--align-text);flex:1}' +
'.ad-btn-ghost{appearance:none;border:1px solid var(--align-line);background:var(--align-surface);color:var(--align-text);border-radius:10px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer}' +
'.ad-btn-ghost:active{background:var(--align-line)}' +
'.ad-attn-strip{display:flex;gap:8px;overflow-x:auto;padding:6px 16px 2px;scrollbar-width:none}' +
'.ad-attn-strip::-webkit-scrollbar{display:none}' +
'.ad-attn{flex:0 0 auto;display:flex;align-items:center;gap:6px;border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:600;border:1px solid var(--align-line);background:var(--align-surface);color:var(--align-text);cursor:pointer;white-space:nowrap}' +
'.ad-attn b{font-weight:800}' +
'.ad-attn-review{color:#8a6d00;border-color:#e8d48a;background:#fdf6dd}' +
'.ad-attn-revise{color:#a03d00;border-color:#f0c4a8;background:#fdeee2}' +
'.ad-attn-missing{color:var(--align-muted);border-style:dashed}' +
'.ad-attn-on{outline:2px solid var(--align-orange);outline-offset:-1px}' +
'.ad-chips{display:flex;gap:8px;overflow-x:auto;padding:8px 16px;scrollbar-width:none}' +
'.ad-chips::-webkit-scrollbar{display:none}' +
'.ad-chip{flex:0 0 auto;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;border:1px solid var(--align-line);background:var(--align-surface);color:var(--align-text);cursor:pointer;white-space:nowrap}' +
'.ad-chip-on{background:var(--align-navy);border-color:var(--align-navy);color:#fff}' +
'.ad-chip-n{opacity:.65;font-weight:500;margin-left:4px;font-size:12px}' +
'.ad-meter{padding:4px 16px 10px}' +
'.ad-meter-label{font-size:12px;color:var(--align-muted);margin-bottom:4px}' +
'.ad-meter-track{height:6px;border-radius:3px;background:var(--align-line);overflow:hidden}' +
'.ad-meter-fill{height:100%;border-radius:3px;background:var(--align-orange);transition:width .3s ease}' +
'.ad-group-head{padding:14px 16px 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--align-muted)}' +
'.ad-row{display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--align-surface);border-bottom:1px solid var(--align-line);cursor:pointer}' +
'.ad-row:active{background:var(--align-line)}' +
'.ad-row-ghost{opacity:.72;background:transparent}' +
'.ad-thumb{flex:0 0 44px;width:44px;height:44px;border-radius:10px;background:var(--align-line);display:flex;align-items:center;justify-content:center;overflow:hidden}' +
'.ad-thumb img{width:100%;height:100%;object-fit:cover}' +
'.ad-thumb-x{font-size:10px;font-weight:800;color:var(--align-muted);letter-spacing:.04em}' +
'.ad-thumb-ghost{background:transparent;border:1.5px dashed var(--align-line)}' +
'.ad-row-main{flex:1;min-width:0}' +
'.ad-row-l1{display:flex;align-items:center;gap:8px;min-width:0}' +
'.ad-row-l2{display:flex;align-items:center;gap:8px;margin-top:3px;min-width:0;flex-wrap:wrap}' +
'.ad-num{font-size:14px;font-weight:800;color:var(--align-text);flex:none}' +
'.ad-doc-title{font-size:14px;color:var(--align-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
'.ad-pill{flex:none;font-size:11px;font-weight:700;border-radius:6px;padding:2px 7px;line-height:1.5}' +
'.ad-pill-rev{background:var(--align-navy);color:#fff}' +
'.ad-pill-disc{background:var(--align-line);color:var(--align-muted)}' +
'.ad-pill-missing{border:1px dashed var(--align-line);color:var(--align-muted);background:transparent}' +
'.ad-st-review{background:#fdf6dd;color:#8a6d00}' +
'.ad-st-ok{background:#e3f4e6;color:#1b7a34}' +
'.ad-st-noted{background:#e6eefb;color:#2456a8}' +
'.ad-st-revise{background:#fdeee2;color:#a03d00}' +
'.ad-st-reject{background:#fbe4e4;color:#b3261e}' +
'.ad-links{font-size:12px;color:var(--align-muted)}' +
'.ad-date{flex:none;font-size:12px;color:var(--align-muted)}' +
'.ad-chev{flex:none;color:var(--align-muted);font-size:18px;line-height:1}' +
'.ad-ghost-title{font-size:14px;color:var(--align-muted);font-weight:600}' +
'.ad-ghost-hint{font-size:12px;color:var(--align-orange);font-weight:600;margin-top:2px}' +
'.ad-empty{padding:48px 24px;text-align:center}' +
'.ad-empty-big{font-size:16px;font-weight:700;color:var(--align-text);margin-bottom:6px}' +
'.ad-empty-sub{font-size:13.5px;color:var(--align-muted);line-height:1.45;max-width:280px;margin:0 auto}' +
'.ad-sheet-bg{position:fixed;inset:0;background:rgba(15,26,44,.45);z-index:70;opacity:0;transition:opacity .18s}' +
'.ad-sheet{position:fixed;left:0;right:0;bottom:0;z-index:71;background:var(--align-surface);border-radius:16px 16px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom));max-height:88vh;overflow-y:auto;transform:translateY(100%);transition:transform .22s cubic-bezier(.3,.9,.4,1)}' +
'.ad-sheet-in .ad-sheet{transform:none}.ad-sheet-in.ad-sheet-bg{opacity:1}' +
'.ad-sheet-grab{width:36px;height:4px;border-radius:2px;background:var(--align-line);margin:4px auto 12px}' +
'.ad-sheet h3{margin:0 0 12px;font-size:16px;color:var(--align-text)}' +
'.ad-sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
'.ad-sheet-head h3{margin:0;font-size:16px;color:var(--align-text)}' +
'.ad-sheet-cancel{color:var(--align-orange-ink);font-size:14px;font-weight:600;cursor:pointer}' +
'.ad-match{border:1px solid var(--align-line);border-left:3px solid var(--align-orange);border-radius:12px;padding:12px;margin-bottom:14px}' +
'.ad-match-head{font-size:13px;font-weight:700;color:var(--align-text);margin-bottom:10px}' +
'.ad-radio{display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer;font-size:14px;color:var(--align-text)}' +
'.ad-radio input{margin-top:2px;accent-color:var(--align-orange)}' +
'.ad-radio small{display:block;color:var(--align-muted);font-size:12px;margin-top:2px}' +
'.ad-field-row{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}' +
'.ad-field{flex:1 1 40%;min-width:120px}' +
'.ad-field label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--align-muted);margin-bottom:4px}' +
'.ad-field input,.ad-field select{width:100%;box-sizing:border-box;border:1px solid var(--align-line);border-radius:10px;padding:9px 10px;font-size:14px;background:var(--align-surface);color:var(--align-text)}' +
'.ad-btn-primary{appearance:none;width:100%;border:0;background:var(--align-orange);color:#fff;border-radius:12px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px}' +
'.ad-btn-primary:disabled{opacity:.5}' +
'.ad-screen{position:fixed;inset:0;z-index:60;background:var(--align-surface);overflow-y:auto;padding-bottom:88px}' +
'.ad-screen-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--align-surface);border-bottom:1px solid var(--align-line)}' +
'.ad-back{appearance:none;border:0;background:none;font-size:22px;color:var(--align-text);cursor:pointer;padding:2px 6px}' +
'.ad-screen-title{font-size:17px;font-weight:800;color:var(--align-text)}' +
'.ad-card{margin:12px 16px;border:1px solid var(--align-line);border-radius:16px;padding:14px;background:var(--align-surface)}' +
'.ad-card h4{margin:0 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--align-muted)}' +
'.ad-preview{display:flex;align-items:center;gap:12px}' +
'.ad-preview .ad-thumb{width:64px;height:64px;flex-basis:64px;border-radius:12px}' +
'.ad-preview-link{font-size:13px;font-weight:700;color:var(--align-orange);cursor:pointer;margin-top:4px}' +
'.ad-seg{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;background:var(--align-line);border-radius:12px;padding:4px}' +
'.ad-seg button{appearance:none;border:0;background:transparent;border-radius:9px;padding:8px 2px;font-size:11px;font-weight:700;color:var(--align-muted);cursor:pointer}' +
'.ad-seg button.on{background:var(--align-surface);color:var(--align-text);box-shadow:0 1px 3px rgba(15,26,44,.15)}' +
'.ad-status-by{font-size:12px;color:var(--align-muted);margin-top:8px}' +
'.ad-revrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--align-line);font-size:14px}' +
'.ad-revrow:last-of-type{border-bottom:0}' +
'.ad-rev-cur{font-size:10px;font-weight:800;color:var(--align-orange)}' +
'.ad-detail-kv{display:flex;justify-content:space-between;font-size:13.5px;padding:5px 0;color:var(--align-text)}' +
'.ad-detail-kv span:first-child{color:var(--align-muted)}' +
'.ad-foot{position:fixed;left:0;right:0;bottom:0;z-index:61;display:flex;gap:8px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--align-surface);border-top:1px solid var(--align-line)}' +
'.ad-foot .ad-btn-ghost{flex:1;padding:11px}' +
'.ad-foot .ad-danger{color:#b3261e;border-color:#f0c4c4}' +
'@media (min-width:1024px){.ad-sheet{left:50%;right:auto;width:480px;transform:translate(-50%,100%);border-radius:16px 16px 0 0}.ad-sheet-in .ad-sheet{transform:translate(-50%,0)}}';
    document.head.appendChild(s);
  }

  global.AlignDocuments = {
    mount: mount,
    refresh: refresh,
    openDetail: openDetail,
    openPromoteSheet: openPromoteSheet,
    classifyFilename: classifyFilename,
    isDrawingName: function (name) { return classifyFilename(name).category === 'drawings'; }
  };
})(window);

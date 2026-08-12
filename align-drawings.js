/* align-drawings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Drawings section with drag-and-drop + file upload.
 * Depends on: align-storage.js (window.AlignStorage)
 *             align-files.js   (window.AlignFiles, for per-project storage)
 *
 * Public API  (window.AlignDrawings)
 * ─────────────────────────────────
 *   .render(container)  → mount the drawings UI inside the section modal
 */

(function (global) {
  'use strict';

  /* ── Live references (re-resolved on every call via window directly) ── */
  function Storage() { return window.AlignStorage; }
  function Files()   { return window.AlignFiles; }

  /* ── Constants ──────────────────────────────────────────────────────────── */
  var DRAWINGS_FOLDER_NAME = 'Drawings';
  var MAX_FILE_SIZE = Infinity; // no size limit — IndexedDB handles any size
  var ALLOWED_TYPES = [
    'application/pdf'
  ];
  // Canvas size limits (iOS Safari ~16MP, iPad ~32MP — use 12MP for safety margin)
  var MAX_CANVAS_PIXELS = 12000000;
  var MAX_CANVAS_DIM    = 4096;  // iOS single-dimension cap
  // Zoom limits
  var MV_ZOOM_MIN = 0.25;
  var MV_ZOOM_MAX = 10;
  var _mvWheelTimer = 0;  // debounce wheel re-renders

  // Sheet number → category mapping for auto-classification
  var SHEET_CATEGORIES = {
    A:  'Architectural',
    S:  'Structural',
    E:  'Electrical',
    M:  'Mechanical',
    P:  'Plumbing',
    C:  'Civil',
    FP: 'Fire Protection',
    L:  'Landscape',
    T:  'Telecommunications'
  };

  // Metadata record shape per scanned page:
  // { pageIndex, sheetNumber, basePrefix, baseNumber, revision, title, category, status, reviewReason, labeledManually }
  function _blankPageMeta(pageIndex) {
    return {
      pageIndex: pageIndex,
      sheetNumber: null,
      basePrefix: null,
      baseNumber: null,
      revision: 0,
      title: null,
      category: null,
      status: 'needs_review',
      reviewReason: null,
      labeledManually: false
    };
  }

  /* ── Internal state ─────────────────────────────────────────────────────── */
  var state = {
    container: null,
    projectId: null,
    drawingsFolderId: null,
    showAddModal: false,
    dragOver: false,
    pendingFiles: [],       // array of { name, type, size, dataUrl }
    uploadName: '',
    uploadError: null,
    uploading: false,
    pdfSplitInfo: null,     // { pageCount, pages } when splitting a PDF
    selectMode: false,      // true when checkboxes are visible for bulk actions
    selectedIds: {},        // set-like object: { drawingId: true }
    drawingType: ''         // selected drawing type (plan, section, elevation, detail, 3d)
  };

  /** Always-fresh project-id lookup — never stale. Tries multiple paths. */
  function _resolveProjectId() {
    var s = Storage();
    if (!s) { state.projectId = null; return null; }

    // Path 1: getActiveProject (reads align.active-project → looks up in align.projects.v1)
    var active = s.getActiveProject();
    if (active && active.id) {
      state.projectId = active.id;
      return state.projectId;
    }

    // Path 2: the active-project key might point to a stale project — check if ANY project exists
    var all = s.listProjects();
    if (all.length === 1) {
      // Exactly one project exists — auto-activate it
      s.setActiveProject(all[0].id);
      state.projectId = all[0].id;
      return state.projectId;
    }

    // Path 3: read the raw localStorage key directly (might be set but project deleted)
    try {
      var rawId = window.localStorage.getItem('align.active-project');
      if (rawId) {
        // The key exists but getProject didn't find it — the project was likely deleted
        // Clear the stale reference so we don't keep trying
        window.localStorage.removeItem('align.active-project');
      }
    } catch(e) { /* silent */ }

    state.projectId = null;
    return null;
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtSize(b) { if (b==null) return ''; if (b<1024) return b+' B'; if (b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(2)+' MB'; }
  function fmtDate(iso) { try { var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric'}); } catch(e){return '';} }

  // Clamp render scale to stay within device canvas limits (iOS Safari ~16MP)
  function _clampRenderScale(scale, pageW, pageH, dpr) {
    var pixW = Math.ceil(pageW * scale * dpr);
    var pixH = Math.ceil(pageH * scale * dpr);
    var pixels = pixW * pixH;
    if (pixels <= MAX_CANVAS_PIXELS && pixW <= MAX_CANVAS_DIM && pixH <= MAX_CANVAS_DIM) return scale;
    var areaFactor = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    var dimFactor  = Math.min(MAX_CANVAS_DIM / pixW, MAX_CANVAS_DIM / pixH);
    return scale * Math.min(areaFactor, dimFactor, 1);
  }

  function mimeIcon(mime) {
    if (!mime) return '📄';
    if (mime.indexOf('pdf') !== -1) return '📕';
    if (mime.indexOf('image/') === 0) return '🖼️';
    return '📄';
  }

  function ensureDrawingsFolder() {
    if (!state.projectId || !Files()) return null;
    var tree = Files().getTree(state.projectId);
    if (!tree || !tree.children) return null;

    // Check if Drawings folder already exists
    var existing = tree.children[DRAWINGS_FOLDER_NAME];
    if (existing && existing.type === 'folder') {
      state.drawingsFolderId = existing.id;
      return existing.id;
    }

    // Create it
    try {
      var folder = Files().createFolder(state.projectId, 'root', DRAWINGS_FOLDER_NAME);
      state.drawingsFolderId = folder.id;
      return folder.id;
    } catch (e) {
      console.warn('[AlignDrawings] Could not create drawings folder:', e);
      return null;
    }
  }

  /**
   * Get the full drawings list from our standalone IndexedDB-backed store.
   * Falls back to the Files module tree-walk ONLY if our index is empty
   * (migration path for drawings saved before this update).
   */
  function getDrawingsList() {
    if (!state.projectId) return Promise.resolve([]);

    // 1) Fetch from server (source of truth) via centralized API
    return (window.Api ? window.Api.get('/api/projects/' + encodeURIComponent(state.projectId) + '/files') :
      fetch('/api/projects/' + encodeURIComponent(state.projectId) + '/files', {
        headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('align-token') || '') }
      }).then(function (r) {
        if (!r.ok) throw new Error('Server returned ' + r.status);
        return r.json();
      })
    ).then(function (data) {
      var files = (data.files || []).filter(function (f) { return f.type === 'file' && f.trashed === 0; });
      // Mirror to localStorage cache for fast re-render
      var index = files.map(function (f) {
        return { id: f.id, name: f.original_name, mimeType: f.mime_type, size: f.size_bytes, createdAt: f.created_at, updatedAt: f.created_at };
      });
      if (index.length > 0) _saveDrawingsIndex(state.projectId, index);
      return index;
    }).catch(function () {
      // Fallback: localStorage cache
      return _loadDrawingsIndex(state.projectId);
    });
  }

  function _walkForDrawings(node) {
    var results = [];
    if (!node) return results;
    if (node.type === 'file' && node.category === 'drawings') {
      results.push(node);
    }
    if (node.children) {
      var keys = Object.keys(node.children);
      for (var i = 0; i < keys.length; i++) {
        results = results.concat(_walkForDrawings(node.children[keys[i]]));
      }
    }
    return results;
  }

  /* ── PDF.js bootstrap ──────────────────────────────────────────────────── */
  var pdfjsLib = null;
  function _ensurePdfJs() {
    if (pdfjsLib) return pdfjsLib;
    if (typeof global.pdfjsLib !== 'undefined') {
      pdfjsLib = global.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return pdfjsLib;
    }
    return null;
  }

  /* ── File reading ───────────────────────────────────────────────────────── */
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Failed to read file.')); };
      reader.readAsDataURL(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Failed to read file.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function validateFile(file) {
    if (!file) return 'No file selected.';
    // Only PDFs are supported
    if (file.type && file.type !== 'application/pdf') {
      // Also check by extension for browsers that don't set MIME correctly
      var name = (file.name || '').toLowerCase();
      if (!name.endsWith('.pdf')) {
        return 'Only PDF files are supported.';
      }
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File is too large. Maximum size is ' + fmtSize(MAX_FILE_SIZE) + '.';
    }
    return null;
  }

  /* ── PDF page splitting & bottom-right text extraction ─────────────────── */

  /* ── PDF page splitting & bottom-right text extraction ─────────────────── */
  /**
   * Detects if file is a multi-page PDF and splits it into individual pages.
   * Returns an array of { name, dataUrl, pageNum } for each page.
   * Tries to name pages from bottom-right text (title block convention).
   **/

  /* ── Sheet number scanner — text extraction + pattern matching ──────────── */

  // Extract metadata from a pdf.js page object (async, returns Promise<meta>)
  function _extractSheetMetadata(page, pageIndex) {
    var meta = _blankPageMeta(pageIndex);
    try {
      var viewport = page.getViewport({ scale: 1.0 });
      return page.getTextContent().then(function (textContent) {
        var items = textContent.items || [];
        // Raster / scanned PDF detection
        if (items.length < 5) {
          meta.reviewReason = 'no_text_layer';
          return meta;
        }
        // Title block region: bottom-right quadrant
        var region = { xMin: viewport.width * 0.75, yMax: viewport.height * 0.30 };
        var blockItems = items.filter(function (it) {
          var x = it.transform[4], y = it.transform[5];
          return x >= region.xMin && y <= region.yMax;
        });
        // Fallback: entire right-edge strip
        if (!blockItems.length) {
          blockItems = items.filter(function (it) {
            return it.transform[4] >= viewport.width * 0.85;
          });
        }
        // Fallback: entire bottom strip
        if (!blockItems.length) {
          blockItems = items.filter(function (it) {
            return it.transform[5] <= viewport.height * 0.30;
          });
        }
        if (!blockItems.length) {
          meta.reviewReason = 'no_match';
          return meta;
        }
        var lines = _groupTextLines(blockItems);
        var matchResult = _matchSheetNumber(lines, viewport);
        if (matchResult) {
          meta.sheetNumber  = matchResult.sheetNumber;
          meta.basePrefix   = matchResult.basePrefix;
          meta.baseNumber   = matchResult.baseNumber;
          meta.revision     = matchResult.revision;
          meta.category     = SHEET_CATEGORIES[meta.basePrefix] || null;
          meta.status       = matchResult.needsReview ? 'needs_review' : 'active';
          meta.reviewReason = matchResult.reviewReason || null;
        } else {
          meta.reviewReason = 'no_match';
        }
        var title = _extractTitle(lines, matchResult);
        if (title) meta.title = title;
        return meta;
      }).catch(function () {
        meta.reviewReason = 'extraction_error';
        return meta;
      });
    } catch (e) {
      meta.reviewReason = 'extraction_error';
      return Promise.resolve(meta);
    }
  }

  function _groupTextLines(items) {
    var sorted = items.slice().sort(function (a, b) {
      var ya = a.transform[5], yb = b.transform[5];
      if (Math.abs(ya - yb) > 4) return yb - ya;
      return a.transform[4] - b.transform[4];
    });
    var lines = [], currentLine = null, lastY = null;
    sorted.forEach(function (it) {
      var y = it.transform[5];
      if (!currentLine || Math.abs(y - lastY) > 4) {
        currentLine = { y: y, text: '', items: [] };
        lines.push(currentLine);
      }
      currentLine.items.push(it);
      lastY = y;
    });
    lines.forEach(function (l) {
      l.text = l.items.map(function (it) { return it.str; }).join(' ').trim();
      l.fontSize = Math.max.apply(null, l.items.map(function (it) {
        return Math.abs(it.transform[3]) || 0;
      }));
      l.x = Math.min.apply(null, l.items.map(function (it) { return it.transform[4]; }));
    });
    return lines;
  }

  function _matchSheetNumber(lines, viewport) {
    var tokens = [];
    lines.forEach(function (line) {
      line.text.split(/[\s]+/).forEach(function (tok) {
        tok = tok.replace(/[^A-Za-z0-9.\-]/g, '').trim();
        if (tok.length >= 2) tokens.push({ text: tok, line: line, x: line.x, fontSize: line.fontSize });
      });
      var joined = line.text.replace(/\s+/g, '');
      if (joined.length >= 2 && joined !== line.text) {
        tokens.push({ text: joined, line: line, x: line.x, fontSize: line.fontSize });
      }
    });
    // Tier 1: strict
    var STRICT = /^(FP|A|S|E|M|P|C|L|T)-(\d{2,3})(\.(\d{1,2}))?$/i;
    var strictMatches = [];
    tokens.forEach(function (t) {
      var m = t.text.match(STRICT);
      if (m) strictMatches.push({
        sheetNumber: t.text.toUpperCase(),
        basePrefix: m[1].toUpperCase(),
        baseNumber: (m[1] + '-' + m[2]).toUpperCase(),
        revision: m[4] ? parseInt(m[4], 10) : 0,
        fontSize: t.fontSize,
        x: t.x,
        needsReview: false
      });
    });
    if (strictMatches.length) {
      strictMatches.sort(function (a, b) {
        if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
        return b.x - a.x;
      });
      return strictMatches[0];
    }
    // Tier 2: loose
    var LOOSE = /^([A-Z]{1,3})[.\-]?(\d{1,3})([.\-](\d{1,2}))?$/i;
    var looseMatches = [];
    tokens.forEach(function (t) {
      var m = t.text.match(LOOSE);
      if (m) looseMatches.push({
        sheetNumber: t.text.toUpperCase(),
        basePrefix: m[1].toUpperCase(),
        baseNumber: (m[1] + '-' + m[2]).toUpperCase(),
        revision: m[4] ? parseInt(m[4], 10) : 0,
        fontSize: t.fontSize,
        x: t.x,
        needsReview: true,
        reviewReason: 'loose_match'
      });
    });
    if (looseMatches.length) {
      looseMatches.sort(function (a, b) {
        if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
        return b.x - a.x;
      });
      return looseMatches[0];
    }
    return null;
  }

  function _extractTitle(lines, matchResult) {
    if (!matchResult) return null;
    var sheetLine = matchResult.sheetNumber ? lines.find(function (l) {
      return l.text.toUpperCase().indexOf(matchResult.sheetNumber.toUpperCase()) !== -1;
    }) : null;
    var sheetY = sheetLine ? sheetLine.y : 0;
    var candidates = lines.filter(function (l) {
      if (!l.text || l.text.length < 3) return false;
      if (Math.abs(l.y - sheetY) < 10) return false;
      if (l.y < sheetY - 5) return false;
      var t = l.text.toLowerCase();
      if (/^(date|scale|drawn|checked|project|rev(ision)?|no\.?|sheet|page|of|\d+)$/i.test(t)) return false;
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t)) return false;
      return true;
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
      return Math.abs(a.y - sheetY) - Math.abs(b.y - sheetY);
    });
    var title = candidates[0].text.trim().replace(/\s+/g, ' ');
    if (title === title.toUpperCase() && title.length > 6) {
      title = title.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    return title;
  }


  function _splitPdfPages(file, dataUrl) {
    var lib = _ensurePdfJs();
    if (!lib) return null;          // PDF.js not loaded → fall back to whole file
    if (!file.type || file.type.indexOf('pdf') === -1) return null; // not a PDF
    // Cap page count to avoid memory exhaustion on mobile
    var MAX_SPLIT_PAGES = 50;

    return readFileAsArrayBuffer(file).then(function (buffer) {
      return lib.getDocument({ data: buffer.slice(0) }).promise.then(function (pdfDoc) {
        var numPages = pdfDoc.numPages;
        if (numPages <= 1) return null; // single page — no split needed
        if (numPages > MAX_SPLIT_PAGES) {
          console.warn('[AlignDrawings] PDF has ' + numPages + ' pages, exceeds split limit of ' + MAX_SPLIT_PAGES + '. Uploading whole file.');
          return null;
        }
        return { pdfDoc: pdfDoc, numPages: numPages, buffer: buffer };
      });
    }).then(function (info) {
      if (!info) return null;

      var pdfDoc = info.pdfDoc;
      var numPages = info.numPages;

      // 1) Extract text + render thumbnail for each page SEQUENTIALLY
      //    to avoid loading all pages into memory at once.
      function processPageSequential(pn) {
        if (pn > numPages) return Promise.resolve([]);
        return pdfDoc.getPage(pn).then(function (page) {
          return page.getTextContent().then(function (tc) {
            var vp1 = page.getViewport({ scale: 1.0 });
            var thumbScale = Math.min(180 / vp1.width, 180 / vp1.height, 1);
            var tvp = page.getViewport({ scale: thumbScale });
            var canvas = document.createElement('canvas');
            canvas.width = Math.ceil(tvp.width);
            canvas.height = Math.ceil(tvp.height);
            return page.render({ canvasContext: canvas.getContext('2d'), viewport: tvp }).promise.then(function () {
              var thumbUrl = null;
              try { thumbUrl = canvas.toDataURL('image/png'); } catch (e) { /* tainted/oom — icon fallback */ }
              // Clean up canvas immediately to free memory
              canvas.width = 0; canvas.height = 0;
              return [{ pageNum: pn, items: tc.items, viewport: vp1, thumbUrl: thumbUrl }];
            }).catch(function () {
              canvas.width = 0; canvas.height = 0;
              return [{ pageNum: pn, items: tc.items, viewport: vp1, thumbUrl: null }];
            });
          });
        }).then(function (result) {
          return processPageSequential(pn + 1).then(function (rest) {
            return result.concat(rest);
          });
        });
      }

      return processPageSequential(1).then(function (textResults) {
        // 2) Use pdf-lib to extract each page as a standalone PDF SEQUENTIALLY
        if (typeof PDFLib === 'undefined') {
          console.warn('[AlignDrawings] pdf-lib not loaded, falling back to whole file');
          return null;
        }
        return PDFLib.PDFDocument.load(info.buffer).then(function (srcDoc) {
          var pages = [];

          function splitPageSequential(idx) {
            if (idx >= textResults.length) return Promise.resolve();
            var tr = textResults[idx];
            var pageName = _extractBottomRightText(tr.items, tr.viewport);
            // If scanner can't find a name, leave empty — user will enter manually
            if (!pageName) pageName = '';
            pageName = _sanitizePageName(pageName, tr.pageNum);

            return PDFLib.PDFDocument.create().then(function (newDoc) {
              return newDoc.copyPages(srcDoc, [tr.pageNum - 1]).then(function (copied) {
                newDoc.addPage(copied[0]);
                return newDoc.save();
              });
            }).then(function (pdfBytes) {
              // Proper Uint8Array → base64 (btoa chokes on raw binary)
              var bytes = new Uint8Array(pdfBytes);
              var chunks = [];
              var chunkSize = 0x8000; // 32KB chunks
              for (var b = 0; b < bytes.length; b += chunkSize) {
                var chunk = bytes.subarray(b, Math.min(b + chunkSize, bytes.length));
                var bin = '';
                for (var c = 0; c < chunk.length; c++) {
                  bin += String.fromCharCode(chunk[c]);
                }
                chunks.push(btoa(bin));
              }
              var dataUrl = 'data:application/pdf;base64,' + chunks.join('');
              pages.push({
                name: pageName,
                dataUrl: dataUrl,
                pdfBytes: bytes,   // ← raw bytes for upload (avoids fetch(dataUrl) limits)
                thumbUrl: tr.thumbUrl || null,
                pageNum: tr.pageNum
              });
              // Proceed to next page
              return splitPageSequential(idx + 1);
            });
          }

          return splitPageSequential(0).then(function () {
            pages.sort(function (a, b) {
              return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
            return pages;
          });
        });
      });
    }).catch(function (err) {
      console.warn('[AlignDrawings] PDF split failed, falling back to whole file:', err);
      return null;
    });
  }

  /**
   * Extract text from the bottom-right quadrant of a page.
   * Architectural drawings follow the convention: title block is in
   * the bottom-right corner containing sheet number, title, etc.
   **/

  /* ── Supersede logic ───────────────────────────────────────────────────── */
  // Run after drawings are saved — marks older revisions as superseded
  function _resolveSupersedes(projectId) {
    if (!projectId) return;
    try {
      var drawings = Storage().listRecords(projectId, 'drawings');
      var groups = {};
      drawings.forEach(function (d) {
        var meta = d.meta || {};
        var bn = meta.baseNumber || (d.name || '').split(':')[0].trim();
        if (!bn) return;
        if (!groups[bn]) groups[bn] = [];
        groups[bn].push(d);
      });
      Object.keys(groups).forEach(function (bn) {
        var group = groups[bn];
        group.sort(function (a, b) {
          return ((b.meta && b.meta.revision) || 0) - ((a.meta && a.meta.revision) || 0);
        });
        for (var i = 0; i < group.length; i++) {
          var newStatus = (i === 0) ? 'active' : 'superseded';
          var meta = group[i].meta;
          if (!meta) { meta = {}; group[i].meta = meta; }
          if (meta.status !== newStatus) {
            meta.status = newStatus;
            Storage().saveRecord(projectId, 'drawings', group[i]);
          }
        }
      });
    } catch (e) {
      console.warn('[AlignDrawings] Supersede resolution failed:', e);
    }
  }

  /* ── Title block field extraction (label-based) ───────────────────────── */

  var _KNOWN_LABELS = [
    'DRAWING NO', 'DRAWING NUMBER', 'SHEET NO', 'SHEET NUMBER',
    'DWG NO', 'PAGE NO', 'CHECKED BY', 'DRAWN BY',
    'PROJECT NO', 'PROJECT NUMBER', 'PROJECT', 'DATE',
    'SCALE', 'REV', 'REVISION', 'DOB', 'D.O.B.',
    'ARCHITECT', 'STRUCTURAL ENGINEER', 'MECHANICAL ENGINEER',
    'DRAWING TITLE', 'TITLE', 'DRAWING NAME', 'SHEET TITLE'
  ];

  function _isKnownLabel(text) {
    var t = text.toUpperCase().replace(/[:\.\s]/g, '');
    for (var i = 0; i < _KNOWN_LABELS.length; i++) {
      if (t.indexOf(_KNOWN_LABELS[i].replace(/[:\.\s]/g, '')) !== -1) return true;
    }
    return false;
  }

  function _findFieldValue(candidates, labelPatterns) {
    // Find the label
    var labelItem = null;
    for (var i = 0; i < candidates.length; i++) {
      var ct = candidates[i].text.toUpperCase().replace(/[:\.\s]/g, '');
      for (var p = 0; p < labelPatterns.length; p++) {
        var pat = labelPatterns[p].toUpperCase().replace(/[:\.\s]/g, '');
        if (ct.indexOf(pat) !== -1) {
          labelItem = candidates[i];
          break;
        }
      }
      if (labelItem) break;
    }
    if (!labelItem) return null;

    // Find the best value near this label
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c === labelItem) continue;
      if (_isKnownLabel(c.text)) continue;

      var dx = Math.abs(c.x - labelItem.x);
      var dy = Math.abs(c.y - labelItem.y);

      // Must be reasonably close
      if (dx > 400 || dy > 50) continue;

      // Score: same row = big bonus, closer X = better, larger font = better
      var score = 0;
      if (dy < 15) score += 500;          // same row
      score -= dx * 2;                     // horizontal proximity
      score -= dy * 10;                    // vertical proximity
      score += c.fontSize * 5;             // larger font = likely value

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return best ? best.text : null;
  }

  function _extractBottomRightText(textItems, viewport) {

    if (!textItems || textItems.length === 0) return null;

    // ── Label-based scanner: scan ALL text items on the page ──
    // No coordinate filtering — architectural title blocks can be anywhere.
    var candidates = [];
    for (var i = 0; i < textItems.length; i++) {
      var item = textItems[i];
      if (!item.str || !item.transform) continue;
      var str = item.str.trim();
      if (!str || str.length < 2) continue;
      candidates.push({
        text: str,
        x: item.transform[4],
        y: item.transform[5],
        fontSize: item.height || (item.transform ? Math.abs(item.transform[3]) : 8)
      });
    }

    var drawingNo = _findFieldValue(candidates, ['DRAWING NO.', 'DRAWING NO', 'DRAWING NUMBER', 'SHEET NO.', 'SHEET NO', 'SHEET NUMBER', 'DWG NO.', 'DWG NO']);
    var drawingTitle = _findFieldValue(candidates, ['DRAWING TITLE', 'TITLE', 'DRAWING NAME', 'SHEET TITLE']);

    if (drawingNo || drawingTitle) {
      if (drawingNo && drawingTitle) {
        return drawingNo + ' — ' + drawingTitle;
      }
      return drawingNo || drawingTitle;
    }

    // Nothing found — let user enter manually (return null, caller handles it)
    return null;
  }

  function _sanitizePageName(raw, fallbackNum) {
    var s = String(raw || '').trim();
    // Remove characters unsafe for filenames
    s = s.replace(/[\\/:*?"<>|]/g, '-');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/\.{2,}/g, '.');
    s = s.slice(0, 200);
    return s || ('Page ' + fallbackNum);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * STANDALONE DRAWING STORE  (IndexedDB-backed, no Files module dependency)
   * ════════════════════════════════════════════════════════════════════════════
   * Drawings are stored directly in IndexedDB keyed by projectId + drawingId.
   * A lightweight index (array of {id, name, type, size, updatedAt}) lives in
   * localStorage so we can list drawings without scanning the whole DB.
   *
   * If window.AlignFiles is available, we ALSO save through it for the
   * unified file browser. The standalone store is the source of truth for
   * the drawings panel itself — the Files module save is a best-effort bonus.
   */

  var DRAWING_INDEX_KEY = 'align.drawings.index.';  // + projectId

  function _drawingsIndexKey(pid) { return DRAWING_INDEX_KEY + pid; }

  /* ── Server upload (source of truth) ──────────────────────────────────── */

  function _uploadToServer(pid, drawingId, name, mime, dataUrl, folderId, pdfBytes) {
    // If we have raw bytes (from pdf-lib split), use them directly — avoids
    // Safari fetch(dataUrl) size limits and "Load failed" errors.
    var blobPromise;
    if (pdfBytes && pdfBytes.length) {
      blobPromise = Promise.resolve(new Blob([pdfBytes], { type: mime }));
    } else {
      blobPromise = fetch(dataUrl).then(function (r) { return r.blob(); });
    }

    return blobPromise.then(function (blob) {
      var fd = new FormData();
      fd.append('file', blob, name);
      fd.append('project_id', pid);
      if (folderId) fd.append('folder_id', folderId);

      var token = localStorage.getItem('align-token') || '';
      return fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Upload failed'); });
        return r.json();
      }).then(function (data) {
        return data.file || { id: drawingId };
      });
    });
  }

  function _loadDrawingsIndex(pid) {
    try {
      var raw = window.localStorage.getItem(_drawingsIndexKey(pid));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function _saveDrawingsIndex(pid, list) {
    try {
      window.localStorage.setItem(_drawingsIndexKey(pid), JSON.stringify(list));
    } catch (e) { console.warn('[AlignDrawings] Index write failed:', e); }
  }

  /** Direct IndexedDB blob store — identical pattern to align-files.js. */
  var _idb = null;
  function _idbOpen() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('align-drawings', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('blobs')) {
          req.result.createObjectStore('blobs', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { _idb = req.result; resolve(_idb); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });
  }

  function _drawingBlobKey(projectId, drawingId) {
    return projectId + '.' + drawingId;
  }

  function _saveDrawingBlob(projectId, drawingId, content) {
    return _idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('blobs', 'readwrite');
        var store = tx.objectStore('blobs');
        var req = store.put({ key: _drawingBlobKey(projectId, drawingId), value: content });
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error || new Error('IndexedDB write failed')); };
      });
    });
  }

  function _loadDrawingBlob(projectId, drawingId) {
    return _idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('blobs', 'readonly');
        var store = tx.objectStore('blobs');
        var req = store.get(_drawingBlobKey(projectId, drawingId));
        req.onsuccess = function () { resolve(req.result ? req.result.value : null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function _deleteDrawingBlob(projectId, drawingId) {
    return _idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('blobs', 'readwrite');
        var store = tx.objectStore('blobs');
        var req = store.delete(_drawingBlobKey(projectId, drawingId));
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function _drawingUid() {
    return 'dr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function _drawingNowISO() {
    return new Date().toISOString();
  }

  /**
   * Save one or more drawings.  COMPLETELY SELF-CONTAINED.
   * Uses direct IndexedDB + localStorage index.  Does NOT require
   * window.AlignFiles — if it's available we save there too as a
   * best-effort bonus (for the unified file browser).
   *
   * Accepts: addDrawing(file, dataUrl, customName) — single
   *          addDrawing([{name,type,size,dataUrl}], null, baseName) — bulk
   * Returns: Promise<array of saved drawing entries>
   */
  function addDrawing(fileOrArray, dataUrl, customName) {
    var pid = _resolveProjectId();
    if (!pid) {
      var allProjects = Storage() ? Storage().listProjects() : [];
      if (allProjects.length === 0) {
        return Promise.reject(new Error('No projects exist. Create a project in Settings first.'));
      }
      return Promise.reject(new Error('No active project selected. Please select a project from the header.'));
    }

    // Build the file list
    var files = [];
    if (Array.isArray(fileOrArray)) {
      files = fileOrArray;
    } else {
      files = [{ name: fileOrArray.name, type: fileOrArray.type, size: fileOrArray.size, dataUrl: dataUrl, customName: customName }];
    }

    var index = _loadDrawingsIndex(pid);
    var now = _drawingNowISO();

    // Also save through AlignFiles if available (best-effort, for file browser)
    var filesAPI = window.AlignFiles || null;
    var filesFolderId = null;
    if (filesAPI) {
      try { filesFolderId = ensureDrawingsFolder(); } catch (e) { /* best effort */ }
    }

    // Upload sequentially to avoid memory spikes from concurrent atob/Blob conversion
    function uploadSequential(idx) {
      if (idx >= files.length) return Promise.resolve();
      var f = files[idx];
      var name = f.customName || customName || f.name || 'drawing';
      var mime = f.type || 'application/octet-stream';
      var content = f.dataUrl || '';
      var bytes = f.pdfBytes || null;
      var drawingId = _drawingUid();

      return _uploadToServer(pid, drawingId, name, mime, content, filesFolderId, bytes).then(function (serverFile) {
        // Reload index each time to avoid race conditions
        var currentIndex = _loadDrawingsIndex(pid);
        currentIndex.push({
          id: serverFile.id || drawingId,
          name: name,
          mimeType: mime,
          size: content.length,
          createdAt: now,
          updatedAt: now,
          drawingType: f.drawingType || ''
        });
        _saveDrawingsIndex(pid, currentIndex);
        // Cache in IndexedDB for offline access (best-effort)
        _saveDrawingBlob(pid, serverFile.id || drawingId, content).catch(function(){});
        return uploadSequential(idx + 1);
      });
    }

    return uploadSequential(0);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * RENDER — Main Drawings View
   * ════════════════════════════════════════════════════════════════════════════ */

  function render(container) {
    if (!container) return;

    state.container = container;
    _resolveProjectId();
    state.showAddModal = false;
    state.pendingFiles = [];
    state.uploadName = '';
    state.uploadError = null;
    state.pdfSplitInfo = null;
    state.selectMode = false;
    state.selectedIds = {};
    state.drawingType = '';

    try { _paint(); } catch(e) {
      container.innerHTML = '<div class="pm-empty"><strong>Error</strong><p>' + e.message + '</p></div>';
      fetch('https://ntfy.sh/alfr-hermes-tasks', { method:'POST', body: 'Drawings crash: ' + e.message + '\\n' + (e.stack||''), headers:{'Title':'Align Crash','Priority':'high'} }).catch(function(){});
    }
  }

  function _paint() {
    var c = state.container;
    if (!c) return;

    // Always refresh the active project — never trust a stale cache
    _resolveProjectId();

    if (state.showAddModal) {
      c.innerHTML = _addModalHtml();
      _bindAddModal();
      return;
    }

    if (!state.projectId) {
      c.innerHTML = '<div class="dr-empty"><strong>No active project</strong><p>Select a project from the header to view drawings.</p></div>';
      return;
    }

    getDrawingsList().then(function (drawings) {
      c.innerHTML = _mainViewHtml(drawings);
      try { _bindMainView(); } catch(e) {
        fetch('https://ntfy.sh/alfr-hermes-tasks', { method:'POST', body: 'bindMainView crash: ' + e.message + '\n' + (e.stack||'').slice(0,500), headers:{'Title':'Align Crash','Priority':'high'} }).catch(function(){});
      }
    });
  }

  /* ── Main View HTML ─────────────────────────────────────────────────────── */
  function _mainViewHtml(drawings) {
    var h = [];
    h.push('<div class="dr-wrap">');

    // Header with Add button + Select Multiple toggle
    h.push('<div class="dr-header">');
    h.push('<h3 class="dr-title">Project Drawings</h3>');
    h.push('<div class="dr-header-actions">');
    h.push('<button class="pm-btn primary" id="dr-add-btn">+ Add Drawing</button>');
    // Select Multiple toggle (only when there are drawings)
    if (drawings.length > 0) {
      var selActive = state.selectMode ? ' active' : '';
      h.push('<button class="dr-select-toggle-btn' + selActive + '" id="dr-select-toggle-btn">☑ Select Multiple</button>');
    }
    h.push('</div>');
    h.push('</div>');

    // Selection bar (only in select mode with drawings)
    if (state.selectMode && drawings.length > 0) {
      var selCount = Object.keys(state.selectedIds).length;
      h.push('<div class="dr-selection-bar" id="dr-selection-bar">');
      h.push('<span class="dr-selection-count">' + selCount + ' selected</span>');
      h.push('<div class="dr-selection-actions">');
      if (selCount === 0) {
        h.push('<button class="pm-btn small" id="dr-select-all-btn">Select All</button>');
      } else {
        h.push('<button class="pm-btn small" id="dr-select-all-btn">Select All (' + drawings.length + ')</button>');
        h.push('<button class="pm-btn small" id="dr-deselect-btn">Deselect</button>');
        h.push('<button class="pm-btn small primary" id="dr-export-sel-btn">⬇ Export</button>');
        h.push('<button class="pm-btn small danger" id="dr-delete-sel-btn">🗑 Delete</button>');
      }
      h.push('<button class="pm-btn small" id="dr-cancel-select-btn">Done</button>');
      h.push('</div>');
      h.push('</div>');
    }

    // Drawings grid or empty state
    if (drawings.length === 0) {
      h.push('<div class="dr-empty">');
      h.push('<div class="dr-empty-icon">📐</div>');
      h.push('<strong>No drawings yet</strong>');
      h.push('<p>Drag & drop a drawing file here or click "Add Drawing" to upload one.</p>');
      h.push('</div>');
    } else {
      h.push('<div class="dr-grid" id="dr-grid">');
      var MAX_VISIBLE = 20;
      for (var i = 0; i < drawings.length && i < MAX_VISIBLE; i++) {
        var d = drawings[i];
        var icon = mimeIcon(d.mimeType);
        var isImage = d.mimeType && d.mimeType.indexOf('image/') === 0;
        var isSelected = state.selectedIds[d.id];
        var selClass = state.selectMode ? ' select-mode' : '';
        if (isSelected) selClass += ' selected';
        h.push('<div class="dr-card' + selClass + '" data-file-id="' + esc(d.id) + '">');
        // Checkbox overlay in select mode
        h.push('<div class="dr-card-check" data-check-id="' + esc(d.id) + '"></div>');
        if (isImage) {
          h.push('<div class="dr-thumb" data-thumb-id="' + esc(d.id) + '"></div>');
        } else {
          h.push('<div class="dr-thumb dr-thumb-icon">' + icon + '</div>');
        }
        h.push('<div class="dr-card-info">');
        h.push('<div class="dr-card-name" title="' + esc(d.name) + '">' + esc(d.name) + '</div>');
        h.push('<div class="dr-card-meta">');
        h.push(fmtSize(d.size) + ' · ' + fmtDate(d.updatedAt));
        h.push('</div>');
        h.push('</div>');
        h.push('</div>');
      }
      h.push('</div>');
      // Load More button when there are more drawings than visible
      if (drawings.length > MAX_VISIBLE) {
        var remaining = drawings.length - MAX_VISIBLE;
        h.push('<button class="pm-btn small" id="dr-load-more" style="margin-top:12px;display:block;width:100%;">Load More (' + remaining + ' more)</button>');
      }
    }

    h.push('</div>');
    return h.join('');
  }

  function _bindMainView() {
    var addBtn = document.getElementById('dr-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        state.showAddModal = true;
        state.pendingFiles = [];
        state.pdfSplitInfo = null;
        state.uploadName = '';
        state.uploadError = null;
        state.dragOver = false;
        _paint();
      });
    }

    // ── Load More button ──────────────────────────────────────────────────
    var loadMoreBtn = document.getElementById('dr-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        // Fetch all drawings again and re-render without limit
        getDrawingsList().then(function(drawings) {
          var grid = document.getElementById('dr-grid');
          if (!grid) return;
          // Remove the Load More button
          if (loadMoreBtn.parentNode) loadMoreBtn.parentNode.removeChild(loadMoreBtn);
          // Render remaining drawings
          var h = '';
          for (var i = 20; i < drawings.length; i++) {
            var d = drawings[i];
            var icon = mimeIcon(d.mimeType);
            var isImage = d.mimeType && d.mimeType.indexOf('image/') === 0;
            var selClass = state.selectMode ? ' select-mode' : '';
            h += '<div class=\"dr-card' + selClass + '\" data-file-id=\"' + esc(d.id) + '\">';
            h += '<div class=\"dr-card-check\" data-check-id=\"' + esc(d.id) + '\"></div>';
            if (isImage) {
              h += '<div class=\"dr-thumb\" data-thumb-id=\"' + esc(d.id) + '\"></div>';
            } else {
              h += '<div class=\"dr-thumb dr-thumb-icon\">' + icon + '</div>';
            }
            h += '<div class=\"dr-card-info\">';
            h += '<div class=\"dr-card-name\" title=\"' + esc(d.name) + '\">' + esc(d.name) + '</div>';
            h += '<div class=\"dr-card-meta\">' + fmtSize(d.size) + ' · ' + fmtDate(d.updatedAt) + '</div>';
            h += '</div></div>';
          }
          grid.insertAdjacentHTML('beforeend', h);
        });
      });
    }

    // ── Select Multiple toggle ────────────────────────────────────────────
    var toggleBtn = document.getElementById('dr-select-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (state.selectMode) {
          // Exit select mode
          state.selectMode = false;
          state.selectedIds = {};
        } else {
          // Enter select mode
          state.selectMode = true;
          state.selectedIds = {};
        }
        _paint();
      });
    }

    // ── Selection bar buttons ──────────────────────────────────────────────
    var selectAllBtn = document.getElementById('dr-select-all-btn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function () {
        getDrawingsList().then(function (drawings) {
          for (var i = 0; i < drawings.length; i++) {
            state.selectedIds[drawings[i].id] = true;
          }
          _paint();
        });
      });
    }

    var deselectBtn = document.getElementById('dr-deselect-btn');
    if (deselectBtn) {
      deselectBtn.addEventListener('click', function () {
        state.selectedIds = {};
        _paint();
      });
    }

    var exportSelBtn = document.getElementById('dr-export-sel-btn');
    if (exportSelBtn) {
      exportSelBtn.addEventListener('click', function () {
        _exportSelectedDrawings(false);
      });
    }

    var deleteSelBtn = document.getElementById('dr-delete-sel-btn');
    if (deleteSelBtn) {
      deleteSelBtn.addEventListener('click', function () {
        _deleteSelectedDrawings(false);
      });
    }

    var cancelSelectBtn = document.getElementById('dr-cancel-select-btn');
    if (cancelSelectBtn) {
      cancelSelectBtn.addEventListener('click', function () {
        state.selectMode = false;
        state.selectedIds = {};
        _paint();
      });
    }

    // ── Card clicks ────────────────────────────────────────────────────────
    var cards = document.querySelectorAll('.dr-card');
    cards.forEach(function (card) {
      var fileId = card.getAttribute('data-file-id');

      // Checkbox click
      var checkEl = card.querySelector('.dr-card-check');
      if (checkEl && state.selectMode) {
        checkEl.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.selectedIds[fileId]) {
            delete state.selectedIds[fileId];
          } else {
            state.selectedIds[fileId] = true;
          }
          _paint();
        });
      }

      // Card body click
      card.addEventListener('click', function (e) {
        // Don't open viewer if we clicked the checkbox in select mode
        if (state.selectMode) {
          // Toggle selection
          if (state.selectedIds[fileId]) {
            delete state.selectedIds[fileId];
          } else {
            state.selectedIds[fileId] = true;
          }
          _paint();
          return;
        }

        if (fileId) {
          _resolveProjectId();
          var timedOut = false;
          var timeout = setTimeout(function() {
            timedOut = true;
            alert('Drawing load timed out. Please refresh and try again.');
          }, 8000);
          _loadDrawingForViewer(state.projectId, fileId).then(function (viewData) {
            if (timedOut) return;
            clearTimeout(timeout);
            if (viewData) _viewDrawing(viewData);
            else alert('Could not load this drawing. Try re-uploading it.');
          }).catch(function(err) {
            if (timedOut) return;
            clearTimeout(timeout);
            alert('Failed to load drawing: ' + (err && err.message || err));
          });
        }
      });
    });

    // Lazy-load image thumbnails (use server-generated thumbs for speed)
    var thumbs = document.querySelectorAll('.dr-thumb[data-thumb-id]');
    thumbs.forEach(function (thumb) {
      var fileId = thumb.getAttribute('data-thumb-id');
      if (fileId) {
        _loadDrawingThumb(fileId).then(function (thumbUrl) {
          if (thumbUrl) {
            var img = document.createElement('img');
            img.src = thumbUrl;
            img.alt = '';
            img.className = 'dr-thumb-img';
            img.loading = 'lazy';
            thumb.innerHTML = '';
            thumb.appendChild(img);
          }
        });
      }
    });
  }

  /**
   * Load a drawing for viewing. Tries standalone store first, then Files module.
   * Returns { meta: {name, mimeType, size, updatedAt}, content: <dataUrl> }
   */
  function _loadDrawingForViewer(projectId, drawingId) {
    // 1) Fetch from server (source of truth)
    var token = localStorage.getItem('align-token') || '';
    return fetch('/api/files/' + encodeURIComponent(drawingId) + '?download=1', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) {
      if (!r.ok) throw new Error('Server returned ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve({
            meta: { id: drawingId, name: 'Drawing', mimeType: blob.type || 'application/pdf', size: blob.size },
            content: reader.result
          });
        };
        reader.readAsDataURL(blob);
      });
    }).catch(function () {
      // Fallback: IndexedDB
      return _loadFromIndexedDB(projectId, drawingId);
    });
  }

  /**
   * Load a thumbnail URL for an image drawing. Uses server ?thumb=1 when available.
   */
  function _loadDrawingThumb(drawingId) {
    var token = localStorage.getItem('align-token') || '';
    return fetch('/api/files/' + encodeURIComponent(drawingId) + '?thumb=1', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) {
      if (!r.ok) throw new Error('Thumb not available');
      return r.blob();
    }).then(function (blob) {
      return URL.createObjectURL(blob);
    }).catch(function () {
      return null;
    });
  }

  function _loadFromIndexedDB(projectId, drawingId) {
    var index = _loadDrawingsIndex(projectId);
    var entry = null;
    for (var i = 0; i < index.length; i++) {
      if (index[i].id === drawingId) { entry = index[i]; break; }
    }
    if (entry) {
      return _loadDrawingBlob(projectId, drawingId).then(function (content) {
        return { meta: entry, content: content };
      });
    }
    return Promise.resolve(null);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * INTERACTIVE MARKUP VIEWER
   * ════════════════════════════════════════════════════════════════════════════
   * Canvas overlay with pen, highlighter, text, rect, ellipse, arrow, eraser.
   * Markups saved per-drawing in IndexedDB store 'align-markups'.
   * Clean-view toggle shows/hides all annotation layers.
   */

  var _mv = null; // markup-viewer live state (null when viewer closed)

  /* ── Markup IndexedDB store ────────────────────────────────────────────── */
  var _markupDB = null;
  function _markupOpen() {
    if (_markupDB) return Promise.resolve(_markupDB);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('align-markups', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('strokes')) {
          req.result.createObjectStore('strokes', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { _markupDB = req.result; resolve(_markupDB); };
      req.onerror = function () { reject(req.error || new Error('Markup DB open failed')); };
    });
  }
  function _markupKey(projectId, drawingId) { return projectId + '::' + drawingId; }
  function _loadMarkups(projectId, drawingId) {
    var token = localStorage.getItem('align-token') || '';
    return fetch('/api/projects/' + encodeURIComponent(projectId) + '/drawings/' + encodeURIComponent(drawingId) + '/markups', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (d) {
      return (d && d.strokes) || [];
    }).catch(function () {
      return [];
    });
  }

  function _saveMarkups(projectId, drawingId, strokes) {
    var token = localStorage.getItem('align-token') || '';
    return fetch('/api/projects/' + encodeURIComponent(projectId) + '/drawings/' + encodeURIComponent(drawingId) + '/markups', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ strokes: strokes })
    }).catch(function () {});
  }

  /* ── Viewer entry point ────────────────────────────────────────────────── */
  function _viewDrawing(file) {
    var isImage = file.meta.mimeType && file.meta.mimeType.indexOf('image/') === 0;
    var isPdf = file.meta.mimeType && file.meta.mimeType === 'application/pdf';
    var content = file.content || '';
    var pid = state.projectId;
    var did = file.meta.id;

    // Close any previous viewer + remove old overlay if any
    _mvClose();

    var h = [];

    // ── Full-screen overlay (no top bar — floating controls only) ──
    h.push('<div class="dr-mv-overlay" id="dr-mv-overlay">');

    // ── Floating back button (top-left) ──
    h.push('<button class="dr-mv-float-btn dr-mv-back-float" id="dr-mv-back" title="Back">←</button>');

    // ── Floating tools button (bottom-right) ──
    h.push('<button class="dr-mv-float-btn dr-mv-tools-float" id="dr-mv-tools-toggle" title="Tools">⚒</button>');

    // ── Toolbar (slides up from bottom when toggled) ──
    h.push(_mvToolbarHtml());

    if (isImage) {
      h.push('<div class="dr-mv-viewport" id="dr-mv-viewport">');
      h.push('<div class="dr-mv-stage" id="dr-mv-stage">');
      h.push('<img class="dr-mv-image" id="dr-mv-image" src="' + esc(content) + '" draggable="false">');
      h.push('<canvas class="dr-mv-canvas" id="dr-mv-canvas"></canvas>');
      h.push('</div>');
      h.push('</div>');
    } else if (isPdf) {
      // Render PDF inline via pdf.js canvas
      h.push('<div class="dr-mv-viewport" id="dr-mv-viewport">');
      h.push('<div class="dr-mv-stage" id="dr-mv-stage">');
      h.push('<canvas class="dr-mv-image" id="dr-mv-image" style="display:block;"></canvas>');
      h.push('<canvas class="dr-mv-canvas" id="dr-mv-canvas"></canvas>');
      h.push('</div>');
      h.push('</div>');
      // Page index strip (populated after PDF loads)
      h.push('<div class="dr-mv-page-strip" id="dr-mv-page-strip"></div>');
    } else {
      h.push('<div style="flex:1;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);flex-direction:column;gap:10px;">');
      h.push('<p style="font-size:1.1rem;">Interactive markup is available for image-based drawings.</p>');
      h.push('<p style="font-size:0.85rem;">Upload drawings as individual pages for full markup support.</p>');
      h.push('<a class="pm-btn small" href="' + esc(content) + '" download="' + esc(file.meta.name) + '">⬇ Download</a>');
      h.push('</div>');
    }

    h.push('</div>'); // .dr-mv-overlay

    // Append to body as a full-screen overlay (not inside container)
    var div = document.createElement('div');
    div.id = 'dr-mv-overlay-host';
    div.innerHTML = h.join('');
    document.body.appendChild(div);

    // Scroll lock — prevent background page from scrolling.
    // Save full body state (overflow, position, top, width, touchAction, overscrollBehavior)
    var prevBody = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      touchAction: document.body.style.touchAction,
      overscrollBehavior: document.body.style.overscrollBehavior
    };
    var hadSectionOpen = document.body.classList.contains('section-open');
    var sectionScrollY = hadSectionOpen ? _readSectionScrollY() : 0;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = '0px';
    // IMPORTANT: Do NOT remove section-open class.  The home page is hidden
    // via inline display:none (set by _openSection in script.js), which
    // survives any class changes.  Removing section-open would strip the
    // CSS scroll-lock (touch-action:none + overscroll-behavior:none), letting
    // the home page rubber-band through the viewer on mobile.  So we keep
    // section-open AND layer the viewer's own lock on top.
    // Also ensure touch-action is locked at the inline level:
    document.body.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';

    // Helper: read the saved scroll offset from body.style.top
    function _readSectionScrollY() {
      var t = document.body.style.top;
      if (t && t.charAt(0) === '-') {
        var n = parseFloat(t);
        if (!isNaN(n)) return Math.abs(n);
      }
      return 0;
    }

    // Hide any open section modal so the background is clean
    var sectionModal = document.getElementById('section-modal');
    var sectionModalWasOpen = sectionModal && !sectionModal.classList.contains('hidden');
    if (sectionModalWasOpen) {
      sectionModal.classList.add('hidden');
    }

    // Back button
    var backBtn = document.getElementById('dr-mv-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      _mvClose();
      // Re-open the drawings section modal if it was closed
      if (sectionModalWasOpen && sectionModal) {
        sectionModal.classList.remove('hidden');
      }
      _paint();
    });

    // Escape key closes
    var escHandler = function (e) {
      if (e.key === 'Escape') {
        _mvClose();
        if (sectionModalWasOpen && sectionModal) {
          sectionModal.classList.remove('hidden');
        }
        _paint();
      }
    };
    document.addEventListener('keydown', escHandler, { signal: window._sectionSignal });

    if (isPdf) {
      // Render PDF first page into the canvas, then init viewer state
      _mvRenderPdf(content, did, pid, div, hadSectionOpen, prevBody, sectionScrollY, escHandler);
      return;
    }

    if (!isImage) return;

    // ── Init markup viewer state ──
    _mv = {
      overlayHost: div,
      projectId: pid,
      drawingId: did,
      strokes: [],
      undoStack: [],
      redoStack: [],
      tool: 'pen',
      color: '#e03e3e',
      lineWidth: 3,
      showMarkups: true,
      markupMode: false,  // toolbar hidden until "Markup Drawing" clicked
      zoom: 1,
      panX: 0,
      panY: 0,
      drawing: false,
      startX: 0,
      startY: 0,
      currentStroke: null,
      panning: false,
      panStartX: 0,
      panStartY: 0,
      panOrigX: 0,
      panOrigY: 0,
      textInputActive: false,
      hadSectionOpen: hadSectionOpen,
      _prevBody: prevBody,
      _sectionScrollY: sectionScrollY,
      _escHandler: escHandler
    };

    _mvLoadAndBind();
  }

  /* ── Toolbar HTML ──────────────────────────────────────────────────────── */
  function _mvToolbarHtml() {
    var tools = [
      { id: 'pen',        icon: '✏️', label: 'Pen' },
      { id: 'highlighter',icon: '🖍️', label: 'Highlighter' },
      { id: 'text',       icon: '💬', label: 'Text' },
      { id: 'rect',       icon: '▭',  label: 'Rectangle' },
      { id: 'ellipse',    icon: '◯',  label: 'Ellipse' },
      { id: 'arrow',      icon: '➤',  label: 'Arrow' },
      { id: 'eraser',     icon: '🧹', label: 'Eraser' }
    ];
    var colors = ['#e03e3e','#f59e0b','#facc15','#22c55e','#3b82f6','#8b5cf6','#1b1f24','#ffffff'];
    var widths = [2, 4, 6, 10];

    var h = [];
    h.push('<div class="dr-mv-toolbar" id="dr-mv-toolbar">');

    // Tool buttons
    h.push('<div class="dr-mv-tool-group" id="dr-mv-tools">');
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      h.push('<button class="dr-mv-tool-btn" data-tool="' + t.id + '" title="' + t.label + '">' + t.icon + '</button>');
    }
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Colors
    h.push('<div class="dr-mv-tool-group" id="dr-mv-colors">');
    for (var j = 0; j < colors.length; j++) {
      var c = colors[j];
      var outline = c === '#ffffff' ? ' dr-mv-color-outline' : '';
      h.push('<button class="dr-mv-color-btn' + outline + '" data-color="' + c + '" style="background:' + c + ';" title="' + c + '"></button>');
    }
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Line widths
    h.push('<div class="dr-mv-tool-group" id="dr-mv-widths">');
    for (var k = 0; k < widths.length; k++) {
      var w = widths[k];
      h.push('<button class="dr-mv-width-btn" data-width="' + w + '" title="' + w + 'px"><span class="dr-mv-width-dot" style="width:' + (w+4) + 'px;height:' + (w+4) + 'px;"></span></button>');
    }
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Undo / Redo
    h.push('<div class="dr-mv-tool-group">');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-undo" title="Undo (Ctrl+Z)">↩</button>');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-redo" title="Redo (Ctrl+Y)">↪</button>');
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Clean view toggle
    h.push('<div class="dr-mv-tool-group">');
    h.push('<button class="dr-mv-tool-btn dr-mv-toggle-on" id="dr-mv-toggle" title="Toggle markups on/off">👁️ Markups</button>');
    h.push('</div>');

    // ── Zoom controls ──
    h.push('<div class="dr-mv-tool-group" id="dr-mv-zoom-controls">');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-zoomout" title="Zoom Out">🔍−</button>');
    h.push('<div class="dr-mv-zoom-info" id="dr-mv-zoom-label">100%</div>');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-zoomin" title="Zoom In">🔍+</button>');
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // ── Fit mode toggle ──
    h.push('<div class="dr-mv-tool-group">');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-fitmode" title="Fit Mode (Width/Page)">📐 Fit Width</button>');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-zoomfit" title="Fit to Viewport">↔️ Fit</button>');
    h.push('</div>');

    h.push('</div>');
    return h.join('');
  }

  /* ── Render PDF into the viewer canvas, then init state ───────────────── */
  function _mvRenderPdf(content, did, pid, div, hadSectionOpen, prevBody, sectionScrollY, escHandler) {
    var lib = _ensurePdfJs();
    if (!lib) {
      console.warn('[AlignDrawings] pdf.js not loaded, cannot render PDF');
      return;
    }

    // content is a data URL — convert to arraybuffer
    var parts = content.split(',');
    if (parts.length < 2) {
      console.warn('[AlignDrawings] Invalid data URL for drawing');
      return;
    }
    try {
      var byteString = atob(parts[1]);
    } catch(e) {
      console.warn('[AlignDrawings] Invalid base64 in drawing data:', e.message);
      return;
    }
    var bytes = new Uint8Array(byteString.length);
    for (var i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }

    // Check cache — reuse pdfDoc if same drawing already loaded
    if (_mv && _mv._pdfDoc && _mv._pdfDocId === did) {
      _mv._pdfPageNum = 1;
      _mvRerenderPdf();
      return;
    }

    // Destroy any previous doc before loading a new one
    if (_mv && _mv._pdfDoc) { _mv._pdfDoc.destroy(); _mv._pdfDoc = null; }

    lib.getDocument({ data: bytes.buffer.slice(0) }).promise.then(function (pdfDoc) {
      // Store for reuse
      if (_mv) { _mv._pdfDoc = pdfDoc; _mv._pdfDocId = did; }
      var numPages = pdfDoc.numPages;
      _mvBuildPageStrip(numPages);
      return pdfDoc.getPage(1).then(function (page) {
        var canvas = document.getElementById('dr-mv-image');
        if (!canvas) return;
        var viewportEl = document.getElementById('dr-mv-viewport');
        var viewW = viewportEl ? viewportEl.clientWidth : (canvas.parentElement ? canvas.parentElement.clientWidth : 0);
        var viewH = viewportEl ? viewportEl.clientHeight : (canvas.parentElement ? canvas.parentElement.clientHeight : 0);
        // Guard against hidden viewport (element has no layout yet)
        if (viewW <= 0) {
          console.warn('[AlignDrawings] viewport has zero width, deferring render');
          // Retry after layout
          var retryEl = viewportEl || canvas.parentElement;
          if (retryEl) {
            var retryDiv = document.createElement('div');
            retryDiv.style.cssText = 'color:var(--muted);text-align:center;padding:40px;';
            retryDiv.textContent = 'Loading drawing...';
            retryEl.appendChild(retryDiv);
            setTimeout(function() {
              if (retryDiv.parentNode) retryDiv.parentNode.removeChild(retryDiv);
              _mvRenderPdf(content, did, pid, div, hadSectionOpen, prevBody, sectionScrollY, escHandler);
            }, 200);
          }
          return;
        }
        var baseScale = viewW / page.getViewport({ scale: 1 }).width;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        // Clamp scale to stay within iOS canvas limits (4096px, 14MP)
        var pageW = page.getViewport({ scale: 1 }).width;
        var pageH = page.getViewport({ scale: 1 }).height;
        baseScale = _clampRenderScale(baseScale, pageW, pageH, dpr);
        // Render at retina resolution using a scaled viewport
        var viewport = page.getViewport({ scale: baseScale * dpr });
        var logW = viewport.width / dpr;
        var logH = viewport.height / dpr;

        // Set canvas backing store to retina resolution
        canvas.width  = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        // CSS size at logical (1x) dimensions
        canvas.style.width  = Math.round(logW) + 'px';
        canvas.style.height = Math.round(logH) + 'px';
        // Sync annotation canvas to same dimensions
        var annCanvas = document.getElementById('dr-mv-canvas');
        if (annCanvas) {
          annCanvas.width  = canvas.width;
          annCanvas.height = canvas.height;
          annCanvas.style.width  = canvas.style.width;
          annCanvas.style.height = canvas.style.height;
        }

        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Cancel any in-flight render before starting new one
        var task = page.render({ canvasContext: ctx, viewport: viewport });
        return task.promise.then(function () {
          // Initialize viewer state
          _mv = {
            _renderTask: task,  // track for cancellation
            overlayHost: div,
            projectId: pid,
            drawingId: did,
            strokes: [],
            undoStack: [],
            redoStack: [],
            tool: 'pen',
            color: '#e03e3e',
            lineWidth: 3,
            showMarkups: true,
            markupMode: false,
            zoom: 1,
            panX: 0,
            panY: 0,
            drawing: false,
            startX: 0,
            startY: 0,
            currentStroke: null,
            panning: false,
            panStartX: 0,
            panStartY: 0,
            panOrigX: 0,
            panOrigY: 0,
            textInputActive: false,
            hadSectionOpen: hadSectionOpen,
            _prevBody: prevBody,
            _sectionScrollY: sectionScrollY,
            _escHandler: escHandler,
            // PDF-specific state for crisp zoom re-renders
            _pdfDoc: pdfDoc,
            _pdfPageNum: 1,
            _pdfNumPages: numPages,
            _pdfBaseScale: baseScale,
            _pdfLogW: logW,
            _pdfLogH: logH,
            _pdfContent: content,
            _fitMode: 'width'  // 'width' or 'page'
          };

          _loadMarkups(pid, did).then(function (strokes) {
            _mv.strokes = strokes || [];
            _mv.undoStack = [];
            _mv.redoStack = [];
            _mvBindAll();
            requestAnimationFrame(function () {
              _mvFitToViewport();
              _mvSyncCanvas();
              // Pre-render adjacent pages for instant page turning
              _mvPreRenderAdjacent();
              // Phase 3: Initialize pin overlay for this drawing
              _mvInitPinOverlay();
            });
          });
        });
      });
    }).catch(function (err) {
      console.warn('[AlignDrawings] PDF render failed:', err);
      // Show error in the viewer so user knows what happened
      var canvas = document.getElementById('dr-mv-image');
      if (canvas && canvas.parentElement) {
        canvas.style.display = 'none';
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:var(--danger);text-align:center;padding:40px;';
        errDiv.textContent = 'Failed to render PDF: ' + (err.message || 'Unknown error');
        canvas.parentElement.appendChild(errDiv);
      }
    });
  }

  /* ── Load markups + bind all events ────────────────────────────────────── */
  function _mvLoadAndBind() {
    _loadMarkups(_mv.projectId, _mv.drawingId).then(function (strokes) {
      _mv.strokes = strokes || [];
      _mv.undoStack = [];
      _mv.redoStack = [];
      _mvBindAll();
      // Wait for image to load, then fit-to-viewport + sync canvas
      var img = document.getElementById('dr-mv-image');
      function _onImgReady() {
        // Use rAF so the browser has laid out the viewport (clientWidth/Height > 0)
        requestAnimationFrame(function () {
          _mvFitToViewport();
          _mvSyncCanvas();
          // Phase 3: Initialize pin overlay for this drawing
          _mvInitPinOverlay();
        });
      }
      if (img) {
        if (img.complete && img.naturalWidth > 0) {
          // Already loaded and decoded
          _onImgReady();
        } else if (img.decode) {
          // Modern browsers: decode() handles data URIs correctly
          // (img.complete may be true for data URIs but naturalWidth still 0)
          img.decode().then(_onImgReady).catch(function () {
            // Fallback: if decode fails, poll then try load event
            if (img.complete && img.naturalWidth) _onImgReady();
            else img.addEventListener('load', _onImgReady, { once: true });
          });
        } else {
          // Older browsers: fallback to load event
          img.addEventListener('load', _onImgReady, { once: true });
        }
      }
    });
  }

  function _mvBindAll() {
    // Tool selection
    var toolBtns = document.querySelectorAll('#dr-mv-tools .dr-mv-tool-btn');
    toolBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _mv.tool = btn.getAttribute('data-tool');
        _mvUpdateToolbarUI();

        // If eraser is selected, clear text-input flag
        if (_mv.tool === 'eraser') { _mv.textInputActive = false; }

        // Change cursor (only matters when markup mode is active)
        var canvas = document.getElementById('dr-mv-canvas');
        if (canvas && _mv.markupMode) {
          if (_mv.tool === 'eraser') canvas.style.cursor = 'crosshair';
          else if (_mv.tool === 'text') canvas.style.cursor = 'text';
          else canvas.style.cursor = 'crosshair';
        }
      });
    });

    // Color selection
    var colorBtns = document.querySelectorAll('#dr-mv-colors .dr-mv-color-btn');
    colorBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _mv.color = btn.getAttribute('data-color');
        _mvUpdateToolbarUI();
      });
    });

    // Width selection
    var widthBtns = document.querySelectorAll('#dr-mv-widths .dr-mv-width-btn');
    widthBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _mv.lineWidth = parseInt(btn.getAttribute('data-width'), 10);
        _mvUpdateToolbarUI();
      });
    });

    // Undo / Redo
    var undoBtn = document.getElementById('dr-mv-undo');
    var redoBtn = document.getElementById('dr-mv-redo');
    if (undoBtn) undoBtn.addEventListener('click', function () { _mvUndo(); });
    if (redoBtn) redoBtn.addEventListener('click', function () { _mvRedo(); });

    // Keyboard: Ctrl+Z, Ctrl+Y
    document.addEventListener('keydown', _mvKeyHandler, { signal: window._sectionSignal });

    // ── Zoom buttons ──
    var zoomIn  = document.getElementById('dr-mv-zoomin');
    var zoomOut = document.getElementById('dr-mv-zoomout');
    var zoomFit = document.getElementById('dr-mv-zoomfit');
    var fitMode = document.getElementById('dr-mv-fitmode');
    if (zoomIn) zoomIn.addEventListener('click', function () {
      _mv.zoom = Math.min(MV_ZOOM_MAX, _mv.zoom * 1.2);
      _mvApplyTransform();
      _mvUpdateToolbarUI();
      _mvRerenderPdf();
    });
    if (zoomOut) zoomOut.addEventListener('click', function () {
      _mv.zoom = Math.max(MV_ZOOM_MIN, _mv.zoom / 1.2);
      _mvApplyTransform();
      _mvUpdateToolbarUI();
      _mvRerenderPdf();
    });
    if (zoomFit) zoomFit.addEventListener('click', function () {
      _mvFitToViewport();
    });
    if (fitMode) fitMode.addEventListener('click', function () {
      _mv._fitMode = (_mv._fitMode === 'width') ? 'page' : 'width';
      fitMode.textContent = (_mv._fitMode === 'width') ? '📐 Fit Width' : '📐 Fit Page';
      _mvFitToViewport();
    });

    // ── Tools toggle button (floating top-right, shows/hides toolbar) ──
    var toolsToggle = document.getElementById('dr-mv-tools-toggle');
    if (toolsToggle) {
      toolsToggle.addEventListener('click', function () {
        _mv.markupMode = !_mv.markupMode;
        var toolbar = document.getElementById('dr-mv-toolbar');
        var canvas = document.getElementById('dr-mv-canvas');
        if (toolbar) {
          if (_mv.markupMode) {
            toolbar.classList.add('open');
            toolsToggle.classList.add('active');
            if (canvas) canvas.style.cursor = 'crosshair';
          } else {
            toolbar.classList.remove('open');
            toolsToggle.classList.remove('active');
            if (canvas) canvas.style.cursor = 'grab';
            _mv.drawing = false;
            _mv.currentStroke = null;
          }
        }
        _mvSyncCanvas();
      });
    }

    // Clean view toggle
    var toggleBtn = document.getElementById('dr-mv-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        _mv.showMarkups = !_mv.showMarkups;
        _mvUpdateToolbarUI();
        _mvRedraw();
      });
    }

    // Canvas mouse/touch events
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousedown', _mvMouseDown);
    canvas.addEventListener('mousemove', _mvMouseMove);
    canvas.addEventListener('mouseup', _mvMouseUp);
    canvas.addEventListener('mouseleave', _mvMouseUp);
    canvas.addEventListener('wheel', _mvWheel, { passive: false });

    canvas.addEventListener('touchstart', _mvTouchStart, { passive: false });
    canvas.addEventListener('touchmove', _mvTouchMove, { passive: false });
    canvas.addEventListener('touchend', _mvTouchEnd);

    // Also bind wheel + touch to viewport so zoom/pan work on the whole area
    var viewport = document.getElementById('dr-mv-viewport');
    if (viewport) {
      viewport.addEventListener('wheel', _mvWheel, { passive: false });
      viewport.addEventListener('touchstart', _mvTouchStart, { passive: false });
      viewport.addEventListener('touchmove', _mvTouchMove, { passive: false });
      viewport.addEventListener('touchend', _mvTouchEnd);
    }

    // Also bind wheel to the overlay host so zoom works everywhere in the viewer
    var host = document.getElementById('dr-mv-overlay-host');
    if (host) {
      host.addEventListener('wheel', _mvWheel, { passive: false });
    }

    // Initial toolbar UI
    _mvUpdateToolbarUI();

    // ── Inject annotation tools (Link, Image Stamp, Punchlist Pin, RFI Pin) ──
    var toolbar = document.getElementById('dr-mv-toolbar');
    if (toolbar && window.AlignDrawingAnnotations) {
      window.AlignDrawingAnnotations.init(_mv.projectId, _mv.drawingId);
      window.AlignDrawingAnnotations.injectToolbarButtons(toolbar);
    }

    // Resize observer
    _mvSyncCanvas();
    window.addEventListener('resize', _mvSyncCanvas, { signal: window._sectionSignal });
  }

  /* ── Fit image to viewport on first open ───────────────────────────────── */
  function _mvFitToViewport(attempt) {
    attempt = attempt || 0;
    var vp = document.getElementById('dr-mv-viewport');
    if (!vp) return;

    // For PDF: use stored logical dimensions
    var iw, ih;
    if (_mv._pdfDoc) {
      iw = _mv._pdfLogW;
      ih = _mv._pdfLogH;
    } else {
      var img = document.getElementById('dr-mv-image');
      if (!img) return;
      iw = img.naturalWidth || img.clientWidth;
      ih = img.naturalHeight || img.clientHeight;
    }

    if (!iw || !ih) return;
    var vw = vp.clientWidth;
    var vh = vp.clientHeight;
    // If viewport still has no size, retry after layout (up to 5 attempts)
    if ((!vw || !vh) && attempt < 5) {
      requestAnimationFrame(function () { _mvFitToViewport(attempt + 1); });
      return;
    }
    if (!vw || !vh) return;
    // Fit with 4% padding so the drawing is fully visible
    var scale;
    if (_mv._fitMode === 'page') {
      scale = Math.min((vw * 0.96) / iw, (vh * 0.96) / ih);
    } else {
      // 'width' mode: fit to width
      scale = (vw * 0.96) / iw;
    }
    _mv.zoom = Math.max(MV_ZOOM_MIN, Math.min(MV_ZOOM_MAX, scale));
    _mv.panX = (vw - iw * _mv.zoom) / 2;
    _mv.panY = (vh - ih * _mv.zoom) / 2;
    _mvApplyTransform();
    _mvUpdateToolbarUI();
    // Initial render already fills the canvas at fit width — no need to re-render
    if (_mv._pdfDoc && _mv.zoom !== scale) _mvRerenderPdf();
  }

  /* ── Canvas sizing ─────────────────────────────────────────────────────── */
  function _mvSyncCanvas() {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return;

    // For PDF: use stored logical dimensions
    var w, h;
    if (_mv._pdfDoc) {
      w = _mv._pdfLogW;
      h = _mv._pdfLogH;
    } else {
      var img = document.getElementById('dr-mv-image');
      if (!img) return;
      w = img.naturalWidth || img.clientWidth;
      h = img.naturalHeight || img.clientHeight;
    }

    if (w && h) {
      canvas.width = w;
      canvas.height = h;
      // CSS size follows zoom for PDF (handled in _mvUpdateCanvasSizes)
      if (!_mv._pdfDoc) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      } else {
        canvas.style.width  = Math.round(w * _mv.zoom) + 'px';
        canvas.style.height = Math.round(h * _mv.zoom) + 'px';
      }
    }
    _mvRedraw();
  }

  /* ── Redraw all strokes onto canvas ────────────────────────────────────── */
  function _mvRedraw() {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!_mv.showMarkups) return; // clean view

    var strokes = _mv.strokes;
    for (var i = 0; i < strokes.length; i++) {
      _mvDrawStroke(ctx, strokes[i]);
    }

    // Also draw current in-progress stroke
    if (_mv.currentStroke) {
      _mvDrawStroke(ctx, _mv.currentStroke);
    }

    // ── Render annotations (links, images, punchlist pins, RFI pins) ──
    if (window.AlignDrawingAnnotations) {
      window.AlignDrawingAnnotations.renderAnnotations(ctx, _mv.zoom, _mv.panX, _mv.panY, canvas.width, canvas.height);
    }
  }

  function _mvDrawStroke(ctx, s) {
    if (!s || !s.points || s.points.length === 0) return;

    ctx.save();

    if (s.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = s.color || '#facc15';
      ctx.lineWidth = (s.lineWidth || 4) * 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      _mvStrokePath(ctx, s.points);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (s.tool === 'eraser') {
      // Eraser strokes are rendered as white/background to visually "remove"
      // When toggling markups off/on, erased strokes reappear clean
      // They're stored as tool:'eraser' and only used when showMarkups is on
      ctx.globalAlpha = 0.01; // effectively invisible — eraser tool deletes, not covers
      return;
    }

    if (s.tool === 'text') {
      ctx.restore();
      if (s.text && s.points.length >= 1) {
        var p0 = s.points[0];
        ctx.font = 'bold ' + Math.max(14, (s.lineWidth || 3) * 5) + 'px system-ui, sans-serif';
        ctx.fillStyle = s.color || '#1b1f24';
        ctx.fillText(s.text, p0.x, p0.y);
      }
      return;
    }

    if (s.tool === 'rect') {
      ctx.restore();
      if (s.points.length >= 2) {
        var a = s.points[0], b = s.points[s.points.length - 1];
        var rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
        var rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
        ctx.strokeStyle = s.color || '#e03e3e';
        ctx.lineWidth = s.lineWidth || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeRect(rx, ry, rw, rh);
      }
      return;
    }

    if (s.tool === 'ellipse') {
      ctx.restore();
      if (s.points.length >= 2) {
        var ea = s.points[0], eb = s.points[s.points.length - 1];
        var cx = (ea.x + eb.x) / 2, cy = (ea.y + eb.y) / 2;
        var rxx = Math.abs(eb.x - ea.x) / 2, ryy = Math.abs(eb.y - ea.y) / 2;
        ctx.strokeStyle = s.color || '#3b82f6';
        ctx.lineWidth = s.lineWidth || 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(rxx, 0.5), Math.max(ryy, 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }

    if (s.tool === 'arrow') {
      ctx.restore();
      if (s.points.length >= 2) {
        var aa = s.points[0], ab = s.points[s.points.length - 1];
        ctx.strokeStyle = s.color || '#1b1f24';
        ctx.lineWidth = s.lineWidth || 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(aa.x, aa.y);
        ctx.lineTo(ab.x, ab.y);
        ctx.stroke();
        // Arrowhead
        var angle = Math.atan2(ab.y - aa.y, ab.x - aa.x);
        var headLen = (s.lineWidth || 3) * 5 + 6;
        ctx.fillStyle = s.color || '#1b1f24';
        ctx.beginPath();
        ctx.moveTo(ab.x, ab.y);
        ctx.lineTo(ab.x - headLen * Math.cos(angle - 0.5), ab.y - headLen * Math.sin(angle - 0.5));
        ctx.lineTo(ab.x - headLen * Math.cos(angle + 0.5), ab.y - headLen * Math.sin(angle + 0.5));
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    // Default: pen (freehand)
    ctx.strokeStyle = s.color || '#e03e3e';
    ctx.lineWidth = s.lineWidth || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    _mvStrokePath(ctx, s.points);
    ctx.stroke();
    ctx.restore();
  }

  function _mvStrokePath(ctx, points) {
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
  }

  /* ── Update toolbar active states ──────────────────────────────────────── */
  function _mvUpdateToolbarUI() {
    // Active tool
    var toolBtns = document.querySelectorAll('#dr-mv-tools .dr-mv-tool-btn');
    toolBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === _mv.tool);
    });

    // Active color
    var colorBtns = document.querySelectorAll('#dr-mv-colors .dr-mv-color-btn');
    colorBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-color') === _mv.color);
    });

    // Active width
    var widthBtns = document.querySelectorAll('#dr-mv-widths .dr-mv-width-btn');
    widthBtns.forEach(function (b) {
      b.classList.toggle('active', parseInt(b.getAttribute('data-width'), 10) === _mv.lineWidth);
    });

    // Toggle button
    var toggleBtn = document.getElementById('dr-mv-toggle');
    if (toggleBtn) {
      if (_mv.showMarkups) {
        toggleBtn.textContent = '👁️ Markups';
        toggleBtn.classList.add('dr-mv-toggle-on');
        toggleBtn.classList.remove('dr-mv-toggle-off');
      } else {
        toggleBtn.textContent = '🚫 Clean';
        toggleBtn.classList.add('dr-mv-toggle-off');
        toggleBtn.classList.remove('dr-mv-toggle-on');
      }
    }

    // Zoom label
    var zoomLabel = document.getElementById('dr-mv-zoom-label');
    if (zoomLabel) {
      zoomLabel.textContent = Math.round(_mv.zoom * 100) + '%';
    }
  }

  /* ── Mouse handlers ────────────────────────────────────────────────────── */
  function _mvGetPos(e) {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return { x: 0, y: 0 };
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / _mv.zoom,
      y: (e.clientY - rect.top) / _mv.zoom
    };
  }

  function _mvMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle-click or Alt+Left = pan (always works)
      _mv.panning = true;
      _mv.panStartX = e.clientX;
      _mv.panStartY = e.clientY;
      _mv.panOrigX = _mv.panX;
      _mv.panOrigY = _mv.panY;
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    // ── Annotation tool handling (place pins, links, images) ──
    if (window.AlignDrawingAnnotations && window.AlignDrawingAnnotations.isAnnotationToolActive()) {
      e.preventDefault();
      var annoPos = _mvGetPos(e);
      window.AlignDrawingAnnotations.placeAnnotation(annoPos.x, annoPos.y, function () {
        _mvRedraw();
      });
      return;
    }

    // ── Annotation click detection (when NOT in markup mode or annotation tool) ──
    if (!_mv.markupMode && window.AlignDrawingAnnotations) {
      var clickPos = _mvGetPos(e);
      var hit = window.AlignDrawingAnnotations.hitTest(
        e.clientX - document.getElementById('dr-mv-canvas').getBoundingClientRect().left,
        e.clientY - document.getElementById('dr-mv-canvas').getBoundingClientRect().top,
        _mv.zoom, _mv.panX, _mv.panY
      );
      if (hit) {
        e.preventDefault();
        window.AlignDrawingAnnotations.handleClick(hit);
        return;
      }
    }

    // Drawing tools only work when markup mode is active
    if (!_mv.markupMode) return;

    var pos = _mvGetPos(e);

    if (_mv.tool === 'text') {
      // Place a text annotation
      _mvPushUndo();
      _mvPlaceText(pos);
      return;
    }

    if (_mv.tool === 'eraser') {
      _mvEraseAt(pos);
      return;
    }

    // Start drawing
    _mv.drawing = true;
    _mv.startX = pos.x;
    _mv.startY = pos.y;

    // For rect/ellipse/arrow, we keep just start+current; for pen, multiple points
    if (_mv.tool === 'rect' || _mv.tool === 'ellipse' || _mv.tool === 'arrow') {
      _mvPushUndo();
      _mv.currentStroke = { tool: _mv.tool, color: _mv.color, lineWidth: _mv.lineWidth, points: [{ x: pos.x, y: pos.y }] };
    }
  }

  function _mvMouseMove(e) {
    if (_mv.panning) {
      _mv.panX = _mv.panOrigX + (e.clientX - _mv.panStartX);
      _mv.panY = _mv.panOrigY + (e.clientY - _mv.panStartY);
      _mvApplyTransform();
      return;
    }
    if (!_mv.drawing || !_mv.markupMode) return;

    var pos = _mvGetPos(e);

    if (_mv.tool === 'pen' || _mv.tool === 'highlighter') {
      if (!_mv.currentStroke) {
        _mvPushUndo();
        _mv.currentStroke = { tool: _mv.tool, color: _mv.color, lineWidth: _mv.lineWidth, points: [] };
      }
      _mv.currentStroke.points.push({ x: pos.x, y: pos.y });
    } else if (_mv.tool === 'rect' || _mv.tool === 'ellipse' || _mv.tool === 'arrow') {
      // Update end point
      if (_mv.currentStroke) {
        if (_mv.currentStroke.points.length > 1) _mv.currentStroke.points.pop();
        _mv.currentStroke.points.push({ x: pos.x, y: pos.y });
      }
    } else if (_mv.tool === 'eraser') {
      _mvEraseAt(pos);
    }

    _mvRedraw();
  }

  function _mvMouseUp(e) {
    if (_mv.panning) {
      _mv.panning = false;
      return;
    }
    if (!_mv.drawing) return;
    _mv.drawing = false;

    if (_mv.currentStroke && _mv.currentStroke.points.length > 0) {
      _mv.strokes.push(_mv.currentStroke);
      _mv.currentStroke = null;
      _mvPersist();
      _mvRedraw();
    } else {
      _mv.currentStroke = null;
    }
  }

  /* ── Touch handlers (single-finger draw, two-finger pan + pinch-zoom) ─── */
  function _mvTouchStart(e) {
    e.stopPropagation();
    if (e.touches.length === 2) {
      // Two-finger: record center + initial distance for pan/pinch detection
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      _mv._pinchDist0 = Math.sqrt(dx * dx + dy * dy);
      _mv._pinchZoom0 = _mv.zoom;
      _mv._pinchPanX0 = _mv.panX;
      _mv._pinchPanY0 = _mv.panY;
      _mv._pinchCX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      _mv._pinchCY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      _mv._pinching = false;   // undecided yet
      _mv._twoFinger = true;
      _mv.panning = true;
      _mv.panStartX = _mv._pinchCX;
      _mv.panStartY = _mv._pinchCY;
      _mv.panOrigX = _mv.panX;
      _mv.panOrigY = _mv.panY;
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      var fake = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, button: 0 };
      _mvMouseDown(fake);
      e.preventDefault();
    }
  }

  function _mvTouchMove(e) {
    e.stopPropagation();
    if (e.touches.length === 2 && _mv._twoFinger) {
      var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var distRatio = _mv._pinchDist0 > 0 ? dist / _mv._pinchDist0 : 1;

      // Decide pinch vs pan: if distance changed > 8%, it's a pinch
      if (!_mv._pinching && Math.abs(distRatio - 1) > 0.08) {
        _mv._pinching = true;
        // When switching to pinch, freeze the pan offset at current position
        _mv._pinchPanX0 = _mv.panX;
        _mv._pinchPanY0 = _mv.panY;
      }

      if (_mv._pinching) {
        // Pinch-zoom: scale around the CURRENT midpoint of the two fingers
        var newZoom = Math.min(MV_ZOOM_MAX, Math.max(MV_ZOOM_MIN, _mv._pinchZoom0 * distRatio));
        var scale = newZoom / _mv.zoom;
        // Use the current (live) midpoint, not the initial one
        var vp = document.getElementById('dr-mv-viewport');
        if (vp) {
          var vr = vp.getBoundingClientRect();
          var mx = cx - vr.left;
          var my = cy - vr.top;
          _mv.panX = mx - scale * (mx - _mv.panX);
          _mv.panY = my - scale * (my - _mv.panY);
        }
        _mv.zoom = newZoom;
      } else {
        // Two-finger pan (no significant pinch)
        _mv.panX = _mv.panOrigX + (cx - _mv.panStartX);
        _mv.panY = _mv.panOrigY + (cy - _mv.panStartY);
      }
      _mvApplyTransform();
      _mvUpdateToolbarUI();
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1 && !_mv._twoFinger) {
      var fake = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
      _mvMouseMove(fake);
      e.preventDefault();
    }
  }

  function _mvTouchEnd(e) {
    e.stopPropagation();
    if (_mv._twoFinger) {
      _mv._twoFinger = false;
      _mv._pinching = false;
      _mv.panning = false;
      // Re-render at final zoom after pinch ends
      _mvRerenderPdf();
      return;
    }
    _mvMouseUp({});
  }

  /* ── Page index strip ──────────────────────────────────────────────────── */

  function _mvBuildPageStrip(numPages) {
    var strip = document.getElementById('dr-mv-page-strip');
    if (!strip || numPages <= 1) {
      if (strip) strip.style.display = 'none';
      return;
    }
    strip.style.display = '';
    var h = '';
    for (var i = 1; i <= numPages; i++) {
      h += '<button class="dr-mv-page-btn" data-page="' + i + '">' + i + '</button>';
    }
    strip.innerHTML = h;

    // Delegate click
    strip.addEventListener('click', function(e) {
      var btn = e.target.closest('.dr-mv-page-btn');
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (!isNaN(n)) _mvRenderPage(n);
    });

    _mvHighlightPage(1);
  }

  function _mvHighlightPage(pageNum) {
    var strip = document.getElementById('dr-mv-page-strip');
    if (!strip) return;
    var btns = strip.querySelectorAll('.dr-mv-page-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', parseInt(btns[i].getAttribute('data-page'), 10) === pageNum);
    }
    // Scroll active into view
    var active = strip.querySelector('.active');
    if (active) {
      active.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    }
  }

  /* ── Zoom (wheel) ──────────────────────────────────────────────────────── */
  function _mvWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!_mv) return;
    // Smooth multiplicative zoom — feels linear
    _mv.zoom = Math.min(MV_ZOOM_MAX, Math.max(MV_ZOOM_MIN,
      _mv.zoom * Math.pow(1.0015, -e.deltaY)));
    // Zoom toward cursor
    var vp = document.getElementById('dr-mv-viewport');
    if (vp) {
      var rect = vp.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var scale = _mv.zoom / (_mv._zoomBeforeWheel || _mv.zoom);
      _mv.panX = mx - scale * (mx - _mv.panX);
      _mv.panY = my - scale * (my - _mv.panY);
    }
    _mv._zoomBeforeWheel = _mv.zoom;
    _mvApplyTransform();
    _mvUpdateToolbarUI();
    // Debounce re-render — only fire after scrolling stops
    clearTimeout(_mvWheelTimer);
    _mvWheelTimer = setTimeout(function() { _mvRerenderPdf(); }, 200);
  }

  function _mvApplyTransform() {
    var stage = document.getElementById('dr-mv-stage');
    if (!stage) return;
    // For PDF: only translate — canvas CSS sizes handle the scale
    // For images: use full CSS transform (translate + scale) as before
    if (_mv._pdfDoc) {
      stage.style.transform = 'translate(' + _mv.panX + 'px,' + _mv.panY + 'px)';
      stage.style.transformOrigin = '0 0';
      // Update canvas CSS sizes for current zoom
      _mvUpdateCanvasSizes();
    } else {
      stage.style.transform = 'translate(' + _mv.panX + 'px,' + _mv.panY + 'px) scale(' + _mv.zoom + ')';
      stage.style.transformOrigin = '0 0';
    }
  }

  /* ── Update canvas CSS sizes based on current zoom (PDF only) ──────────── */
  function _mvUpdateCanvasSizes() {
    if (!_mv._pdfDoc) return;
    var pdfCanvas = document.getElementById('dr-mv-image');
    var markupCanvas = document.getElementById('dr-mv-canvas');
    var cssW = Math.round(_mv._pdfLogW * _mv.zoom);
    var cssH = Math.round(_mv._pdfLogH * _mv.zoom);
    if (pdfCanvas) {
      pdfCanvas.style.width  = cssW + 'px';
      pdfCanvas.style.height = cssH + 'px';
    }
    if (markupCanvas) {
      markupCanvas.style.width  = cssW + 'px';
      markupCanvas.style.height = cssH + 'px';
    }
  }

  /* ── Guarded single-canvas render (prevents races) ──────────────────── */
  var _mvRenderSeq = 0;

  function _mvRenderPage(pageNum) {
    var seq = ++_mvRenderSeq;
    if (_mv._renderTask) {
      _mv._renderTask.cancel();
      _mv._renderTask.promise.catch(function() {}); // swallow cancel
    }

    return _mv._pdfDoc.getPage(pageNum).then(function (page) {
      if (seq !== _mvRenderSeq) return; // superseded
      _mv._pdfPageNum = pageNum;
      _mvHighlightPage(pageNum);

      var pdfCanvas = document.getElementById('dr-mv-image');
      if (!pdfCanvas) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var renderScale = _mv._pdfBaseScale * _mv.zoom * dpr;
      var logW = Math.round(_mv._pdfLogW * _mv.zoom);
      var logH = Math.round(_mv._pdfLogH * _mv.zoom);

      // Clamp to canvas limits
      var pageW = _mv._pdfLogW / _mv._pdfBaseScale;
      var pageH = _mv._pdfLogH / _mv._pdfBaseScale;
      var clampedScale = _clampRenderScale(_mv._pdfBaseScale * _mv.zoom, pageW, pageH, dpr);
      var renderScale = clampedScale * dpr;
      var viewportW = Math.round(pageW * renderScale);
      var viewportH = Math.round(pageH * renderScale);

      pdfCanvas.width  = viewportW;
      pdfCanvas.height = viewportH;
      pdfCanvas.style.width  = logW + 'px';
      pdfCanvas.style.height = logH + 'px';

      // Sync annotation canvas
      var annCanvas = document.getElementById('dr-mv-canvas');
      if (annCanvas) {
        annCanvas.width  = viewportW;
        annCanvas.height = viewportH;
        annCanvas.style.width  = logW + 'px';
        annCanvas.style.height = logH + 'px';
      }

      if (seq !== _mvRenderSeq) return; // superseded during sizing

      var ctx = pdfCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var viewport = page.getViewport({ scale: renderScale });
      ctx.clearRect(0, 0, viewportW, viewportH);

      var task = page.render({ canvasContext: ctx, viewport: viewport });
      _mv._renderTask = task;
      return task.promise.then(function () {
        _mvPreRenderAdjacent();
      }).catch(function (e) {
        if (e && e.name !== 'RenderingCancelledException') throw e;
      }).finally(function () {
        if (_mv._renderTask === task) _mv._renderTask = null;
      });
    });
  }

  /* ── Re-render PDF canvas at current zoom level (crisp at any zoom) ────── */
  function _mvRerenderPdf() {
    var pdfCanvas = document.getElementById('dr-mv-image');
    if (!pdfCanvas || !_mv._pdfDoc) return;
    _mvRenderPage(_mv._pdfPageNum);
  }

  /* ── Pre-render adjacent PDF pages for instant page turning ──────────── */
  function _mvPreRenderAdjacent() {
    if (!_mv._pdfDoc || _mv._pdfNumPages <= 1) return;
    // Initialize cache if needed
    if (!_mv._pdfPageCache) _mv._pdfPageCache = {};
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var renderScale = _mv._pdfBaseScale * _mv.zoom * dpr;
    var logW = Math.round(_mv._pdfLogW * _mv.zoom);
    var logH = Math.round(_mv._pdfLogH * _mv.zoom);

    // Pre-render next and previous pages
    var pagesToCache = [];
    var next = _mv._pdfPageNum + 1;
    var prev = _mv._pdfPageNum - 1;
    if (next <= _mv._pdfNumPages) pagesToCache.push(next);
    if (prev >= 1) pagesToCache.push(prev);

    for (var i = 0; i < pagesToCache.length; i++) {
      var pn = pagesToCache[i];
      // Skip if already cached
      if (_mv._pdfPageCache[pn]) continue;
      // Create offscreen canvas for this page
      (function (pageNum) {
        _mv._pdfDoc.getPage(pageNum).then(function (page) {
          var viewport = page.getViewport({ scale: renderScale });
          var offCanvas = document.createElement('canvas');
          offCanvas.width  = Math.round(logW * dpr);
          offCanvas.height = Math.round(logH * dpr);
          var octx = offCanvas.getContext('2d');
          octx.imageSmoothingEnabled = true;
          octx.imageSmoothingQuality = 'high';
          page.render({ canvasContext: octx, viewport: viewport }).promise.then(function () {
            _mv._pdfPageCache[pageNum] = offCanvas;
          }).catch(function () {
            // Pre-render failure is non-critical
          });
        }).catch(function () {});
      })(pn);
    }
  }

  /* ── Text placement ────────────────────────────────────────────────────── */
  function _mvPlaceText(pos) {
    // Create a temporary input at the click position
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dr-mv-text-input';
    input.style.position = 'absolute';
    // Position relative to viewport
    var viewport = document.getElementById('dr-mv-viewport');
    if (viewport) {
      var rect = viewport.getBoundingClientRect();
      input.style.left = (pos.x * _mv.zoom + _mv.panX + 20) + 'px';
      input.style.top  = (pos.y * _mv.zoom + _mv.panY) + 'px';
    }
    viewport.appendChild(input);
    input.focus();

    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var text = input.value.trim();
      input.remove();
      if (text) {
        _mv.strokes.push({
          tool: 'text',
          color: _mv.color,
          lineWidth: _mv.lineWidth,
          points: [{ x: pos.x, y: pos.y }],
          text: text
        });
        _mvPersist();
        _mvRedraw();
      }
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') { input.value = ''; commit(); }
    });
  }

  /* ── Eraser ────────────────────────────────────────────────────────────── */
  function _mvEraseAt(pos) {
    var threshold = 18 / _mv.zoom; // hit-test radius in image coordinates
    var hits = [];
    for (var i = _mv.strokes.length - 1; i >= 0; i--) {
      var s = _mv.strokes[i];
      if (_mvStrokeHitTest(s, pos, threshold)) {
        hits.push(i);
      }
    }
    if (hits.length > 0) {
      _mvPushUndo();
      // Remove hit strokes (closest first)
      for (var j = 0; j < hits.length; j++) {
        _mv.strokes.splice(hits[j], 1);
      }
      _mvPersist();
      _mvRedraw();
    }
  }

  function _mvStrokeHitTest(s, pos, threshold) {
    if (!s || !s.points) return false;
    for (var i = 0; i < s.points.length; i++) {
      var p = s.points[i];
      var dx = p.x - pos.x, dy = p.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return true;
    }
    // For rect/ellipse: check if pos is inside the bounding box
    if ((s.tool === 'rect' || s.tool === 'ellipse') && s.points.length >= 2) {
      var a = s.points[0], b = s.points[s.points.length - 1];
      var minX = Math.min(a.x, b.x) - threshold, maxX = Math.max(a.x, b.x) + threshold;
      var minY = Math.min(a.y, b.y) - threshold, maxY = Math.max(a.y, b.y) + threshold;
      if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) return true;
    }
    return false;
  }

  /* ── Undo / Redo ───────────────────────────────────────────────────────── */
  function _mvPushUndo() {
    _mv.undoStack.push(JSON.parse(JSON.stringify(_mv.strokes)));
    _mv.redoStack = [];
  }

  function _mvUndo() {
    if (_mv.undoStack.length === 0) return;
    _mv.redoStack.push(JSON.parse(JSON.stringify(_mv.strokes)));
    _mv.strokes = _mv.undoStack.pop();
    _mvPersist();
    _mvRedraw();
  }

  function _mvRedo() {
    if (_mv.redoStack.length === 0) return;
    _mv.undoStack.push(JSON.parse(JSON.stringify(_mv.strokes)));
    _mv.strokes = _mv.redoStack.pop();
    _mvPersist();
    _mvRedraw();
  }

  /* ── Keyboard handler ──────────────────────────────────────────────────── */
  function _mvKeyHandler(e) {
    if (!_mv) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); _mvUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); _mvRedo(); }
  }

  /* ── Persist markups to IndexedDB (debounced) ──────────────────────────── */
  var _mvPersistTimer = null;
  function _mvPersist() {
    if (_mvPersistTimer) clearTimeout(_mvPersistTimer);
    _mvPersistTimer = setTimeout(function () {
      if (!_mv) return;
      _saveMarkups(_mv.projectId, _mv.drawingId, _mv.strokes).catch(function (err) {
        console.warn('[AlignDrawings] Markup save failed:', err);
      });
    }, 400);
  }

  /* ── Cleanup viewer ────────────────────────────────────────────────────── */
  function _mvClose() {
    if (_mvPersistTimer) { clearTimeout(_mvPersistTimer); _mvPersistTimer = null; }
    // Flush any pending save
    if (_mv && _mv.strokes && _mv.strokes.length > 0) {
      _saveMarkups(_mv.projectId, _mv.drawingId, _mv.strokes).catch(function () {});
    }
    // Remove escape handler
    if (_mv && _mv._escHandler) {
      document.removeEventListener('keydown', _mv._escHandler);
    }
    document.removeEventListener('keydown', _mvKeyHandler);
    window.removeEventListener('resize', _mvSyncCanvas);

    // Cancel in-flight render and release canvas memory (iOS fix)
    if (_mv && _mv._renderTask) { try { _mv._renderTask.cancel(); } catch(e) {} }
    _mvRenderSeq++;  // invalidate any pending renders
    if (_mv && _mv._pdfDoc) { _mv._pdfDoc.destroy(); _mv._pdfDoc = null; _mv._pdfDocId = null; }
    var pdfCanvas = document.getElementById('dr-mv-image');
    var annCanvas = document.getElementById('dr-mv-canvas');
    if (pdfCanvas) pdfCanvas.width = 0;
    if (annCanvas) annCanvas.width = 0;

    // Restore body state to what it was before the viewer opened.
    // IMPORTANT: we never remove section-open (the home page is hidden via
    // inline display:none on tileGrid+appHeader, not the CSS class), so
    // we don't need to restore it — it was never touched.
    if (_mv && _mv._prevBody) {
      document.body.style.overflow = _mv._prevBody.overflow;
      document.body.style.position = _mv._prevBody.position;
      document.body.style.top = _mv._prevBody.top;
      document.body.style.width = _mv._prevBody.width;
      document.body.style.touchAction = _mv._prevBody.touchAction || '';
      document.body.style.overscrollBehavior = _mv._prevBody.overscrollBehavior || '';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.touchAction = '';
      document.body.style.overscrollBehavior = '';
    }

    // Cancel any in-flight PDF render task
    if (_mv && _mv._renderTask) {
      try { _mv._renderTask.cancel(); } catch(e) {}
      _mv._renderTask = null;
    }
    // Free PDF document memory
    if (_mv && _mv._pdfDoc) {
      try { _mv._pdfDoc.destroy(); } catch(e) {}
      _mv._pdfDoc = null;
    }
    // Remove overlay host from DOM
    var host = document.getElementById('dr-mv-overlay-host');
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }

    _mv = null;
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * ADD DRAWING MODAL  (supports multi-file drops, PDF page splitting)
   * ════════════════════════════════════════════════════════════════════════════ */

  function _addModalHtml() {
    var h = [];
    h.push('<div class="dr-modal-overlay" id="dr-modal-overlay">');
    h.push('<div class="dr-modal">');

    // Header
    h.push('<div class="dr-modal-header">');
    h.push('<h3>Add Drawings</h3>');
    h.push('<button class="dr-modal-close" id="dr-modal-close">✕</button>');
    h.push('</div>');

    // ── Drawing Type: auto-detected from title block — no manual selection needed ──
    h.push('<p class="dr-type-auto-note">Sheet names and disciplines are automatically detected from the title block.</p>');

    var dropClass = state.dragOver ? ' dr-drop-active' : '';
    var pdfInfo = state.pdfSplitInfo;
    var hasPages = pdfInfo && pdfInfo.pages && pdfInfo.pages.length > 0;
    var hasFiles = state.pendingFiles.length > 0 || hasPages;

    if (!hasFiles) {
      // ── Drop zone (no files yet) ──
      h.push('<div class="dr-drop-zone' + dropClass + '" id="dr-drop-zone">');
      h.push('<div class="dr-drop-icon">📂</div>');
      h.push('<div class="dr-drop-label">Drag & drop drawing files here</div>');
      h.push('<div class="dr-drop-or">— or —</div>');
      h.push('<button class="pm-btn" id="dr-browse-btn">📁 Upload from drive</button>');
      h.push('<input type="file" id="dr-file-input" hidden multiple accept=".pdf">');
      h.push('<div class="dr-drop-hint">Supports PDF files only — no size limit</div>');
      h.push('<div class="dr-drop-hint" style="margin-top:4px;">📕 Multi-page PDFs are automatically split into individual pages</div>');
      h.push('</div>');
    } else {
      // ── File preview ──
      h.push('<div class="dr-preview-list">');

      if (pdfInfo) {
        // PDF splitting info
        h.push('<div class="dr-pdf-banner">');
        h.push('<span class="dr-pdf-icon">📕</span>');
        h.push('<span><strong>' + esc(pdfInfo.fileName) + '</strong> — ' + pdfInfo.totalPages + ' pages detected</span>');
        h.push('</div>');
        h.push('<div class="dr-pdf-pages-label">Each page will be saved as a separate drawing, named by its title block:</div>');

        for (var p = 0; p < pdfInfo.pages.length; p++) {
          var pg = pdfInfo.pages[p];
          var hasName = pg.name && pg.name.trim().length > 0;
          h.push('<div class="dr-preview dr-preview-page">');
          h.push('<div class="dr-preview-thumb">');
          if (pg.thumbUrl) {
            // PNG thumbnail rendered via pdf.js — <img> cannot show PDF data URLs
            h.push('<img src="' + esc(pg.thumbUrl) + '" alt="Page preview">');
          } else {
            h.push('<span class="dr-preview-icon">📕</span>');
          }
          h.push('</div>');
          h.push('<div class="dr-preview-info">');
          if (hasName) {
            h.push('<strong>' + esc(pg.name) + '</strong>');
          } else {
            // Scanner couldn't find a name — let user type it
            h.push('<input type="text" class="dr-page-name-input" id="dr-page-name-' + p + '" placeholder="Enter drawing name (e.g. G-004.00 — ADA NOTES)" value="">');
          }
          h.push('<span>Page ' + pg.pageNum + ' of ' + pdfInfo.totalPages + '</span>');
          h.push('</div>');
          h.push('</div>');
        }
      } else {
        // Regular file(s) preview
        for (var i = 0; i < state.pendingFiles.length; i++) {
          var f = state.pendingFiles[i];
          var isImg = f.type && f.type.indexOf('image/') === 0;
          h.push('<div class="dr-preview">');
          h.push('<div class="dr-preview-thumb">');
          if (isImg && f.dataUrl) {
            h.push('<img src="' + esc(f.dataUrl) + '" alt="Preview">');
          } else {
            h.push('<span class="dr-preview-icon">' + mimeIcon(f.type) + '</span>');
          }
          h.push('</div>');
          h.push('<div class="dr-preview-info">');
          h.push('<strong>' + esc(f.name) + '</strong>');
          h.push('<span>' + fmtSize(f.size) + '</span>');
          h.push('</div>');
          h.push('</div>');
        }
      }

      h.push('<button class="dr-preview-change" id="dr-change-file">Change files</button>');
      h.push('</div>');
    }

    // Error message
    if (state.uploadError) {
      h.push('<div class="dr-error">' + esc(state.uploadError) + '</div>');
    }

    // Upload progress
    if (state.uploading) {
      var label = pdfInfo ? 'Splitting PDF & saving ' + pdfInfo.pages.length + ' pages…' : 'Saving ' + state.pendingFiles.length + ' drawing(s)…';
      h.push('<div class="dr-uploading">');
      h.push('<div class="dr-spinner"></div>');
      h.push('<span>' + label + '</span>');
      h.push('</div>');
    }

    // Actions
    h.push('<div class="dr-modal-actions">');
    h.push('<button class="pm-btn" id="dr-cancel-btn">Cancel</button>');
    if (hasFiles && !state.uploading) {
      var saveLabel = pdfInfo ? 'Save ' + pdfInfo.pages.length + ' Pages' : 'Save ' + state.pendingFiles.length + ' Drawing(s)';
      h.push('<button class="pm-btn primary" id="dr-save-btn">' + saveLabel + '</button>');
    }
    h.push('</div>');

    h.push('</div>'); // dr-modal
    h.push('</div>'); // dr-modal-overlay
    return h.join('');
  }

  function _bindAddModal() {
    var fileInput = document.getElementById('dr-file-input');

    // Close button
    var closeBtn = document.getElementById('dr-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', _closeModal);

    // Cancel
    var cancelBtn = document.getElementById('dr-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', _closeModal);

    // Overlay click to close
    var overlay = document.getElementById('dr-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) _closeModal();
      });
    }

    // Browse button → file input
    var browseBtn = document.getElementById('dr-browse-btn');
    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', function () { fileInput.click(); });
    }

    // File input change → handle ALL selected files
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) {
          _handleFilesSelected(fileInput.files);
        }
      });
    }

    // Drop zone events → handle ALL dropped files
    var dropZone = document.getElementById('dr-drop-zone');
    function _wireDrop(el) {
      if (!el) return;
      el.addEventListener('dragover', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = true;
        if (dropZone) dropZone.classList.add('dr-drop-active');
      });
      el.addEventListener('dragleave', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = false;
        if (dropZone) dropZone.classList.remove('dr-drop-active');
      });
      el.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = false;
        if (dropZone) dropZone.classList.remove('dr-drop-active');
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
          _handleFilesSelected(e.dataTransfer.files);
        }
      });
    }
    _wireDrop(dropZone);

    // Also handle drag on whole modal
    var modal = document.querySelector('.dr-modal');
    if (modal) {
      modal.addEventListener('dragover', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = true;
        if (dropZone) dropZone.classList.add('dr-drop-active');
      });
      modal.addEventListener('dragleave', function (e) {
        // Only clear if leaving to outside the modal
      });
      modal.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = false;
        if (dropZone) dropZone.classList.remove('dr-drop-active');
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
          _handleFilesSelected(e.dataTransfer.files);
        }
      });
    }

    // Change files button
    var changeBtn = document.getElementById('dr-change-file');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        state.pendingFiles = [];
        state.pdfSplitInfo = null;
        state.uploadName = '';
        state.uploadError = null;
        _paint();
      });
    }

    // Save button
    var saveBtn = document.getElementById('dr-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', _saveDrawing);

    // Escape key
    var escHandler = function (e) {
      if (e.key === 'Escape') {
        _closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler, { signal: window._sectionSignal });
  }

  /**
   * Handle one or more selected files (from drop or file input).
   * Reads them all, then checks for multi-page PDFs.
   */
  function _handleFilesSelected(fileList) {
    var files = [];
    for (var i = 0; i < fileList.length; i++) files.push(fileList[i]);

    // Validate all files first
    for (var j = 0; j < files.length; j++) {
      var err = validateFile(files[j]);
      if (err) {
        state.uploadError = files[j].name + ': ' + err;
        state.pendingFiles = [];
        state.pdfSplitInfo = null;
        _paint();
        return;
      }
    }

    state.uploadError = null;
    state.pendingFiles = [];
    state.pdfSplitInfo = null;
    state.uploadName = '';

    // Read all files as data URLs
    var reads = [];
    for (var k = 0; k < files.length; k++) {
      (function (file) {
        reads.push(
          readFileAsDataURL(file).then(function (dataUrl) {
            return { name: file.name, type: file.type, size: file.size, dataUrl: dataUrl };
          })
        );
      })(files[k]);
    }

    Promise.all(reads).then(function (results) {
      // Check if the first (or only) file is a multi-page PDF
      if (results.length === 1 && results[0].type && results[0].type.indexOf('pdf') !== -1) {
        var file = files[0];
        // Try to split PDF pages
        var splitPromise = _splitPdfPages(file, results[0].dataUrl);
        if (splitPromise) {
          splitPromise.then(function (pages) {
            if (pages && pages.length > 1) {
              // Successfully split! Show page previews
              state.pdfSplitInfo = {
                fileName: file.name,
                totalPages: pages.length,
                pages: pages
              };
            } else {
              // Single page or split failed — treat as regular file
              state.pendingFiles = results;
            }
            _paint();
          }).catch(function () {
            // Split failed — treat as regular file
            state.pendingFiles = results;
            _paint();
          });
          return;
        }
      }
      // No PDF splitting — store all files normally
      state.pendingFiles = results;
      _paint();
    }).catch(function (err) {
      state.uploadError = 'Could not read one or more files. Please try again.';
      state.pendingFiles = [];
      state.pdfSplitInfo = null;
      _paint();
    });
  }

  /** Save the pending drawing(s). Handles PDF-split pages and bulk files. */
  function _saveDrawing() {
    var hasPages = state.pdfSplitInfo && state.pdfSplitInfo.pages && state.pdfSplitInfo.pages.length > 0;
    if ((state.pendingFiles.length === 0 && !hasPages) || state.uploading) return;

    state.uploading = true;
    state.uploadError = null;
    _paint();

    // Determine what to save: PDF-split pages or raw files
    var itemsToSave = [];
    if (state.pdfSplitInfo && state.pdfSplitInfo.pages.length) {
      // PDF-split pages — each is a standalone PDF (from pdf-lib)
      for (var p = 0; p < state.pdfSplitInfo.pages.length; p++) {
        var pg = state.pdfSplitInfo.pages[p];
        // Read user-edited name from input field if present
        var nameInput = document.getElementById('dr-page-name-' + p);
        var pageName = (nameInput ? nameInput.value.trim() : pg.name) || pg.name || ('Page ' + pg.pageNum);
        itemsToSave.push({
          name: pageName + '.pdf',
          type: 'application/pdf',
          size: pg.dataUrl.length,
          dataUrl: pg.dataUrl,
          pdfBytes: pg.pdfBytes || null,
          customName: pageName + '.pdf'
        });
      }
    } else {
      // Regular files
      for (var f = 0; f < state.pendingFiles.length; f++) {
        var file = state.pendingFiles[f];
        itemsToSave.push(file);
      }
    }

    addDrawing(itemsToSave).then(function () {
      // Success
      state.showAddModal = false;
      state.pendingFiles = [];
      state.pdfSplitInfo = null;
      state.uploadName = '';
      state.uploadError = null;
      state.uploading = false;
      _paint();
    }).catch(function (err) {
      state.uploadError = err.message || 'Failed to save.';
      state.uploading = false;
      _paint();
    });
  }

  function _closeModal() {
    state.showAddModal = false;
    state.pendingFiles = [];
    state.pdfSplitInfo = null;
    state.uploadName = '';
    state.uploadError = null;
    state.dragOver = false;
    state.uploading = false;
    _paint();
  }

  /* ── Bulk actions: export & delete ──────────────────────────────────────── */

  /** Get array of selected drawing IDs. If selectAll is true, returns all IDs. */
  function _getSelectedIds(selectAll) {
    if (selectAll) {
      return getDrawingsList().then(function (all) {
        var ids = [];
        for (var i = 0; i < all.length; i++) ids.push(all[i].id);
        return ids;
      });
    }
    return Promise.resolve(Object.keys(state.selectedIds));
  }

  function _exportSelectedDrawings(selectAll) {
    _getSelectedIds(selectAll).then(function (ids) {
    if (ids.length === 0) return;

    var pid = state.projectId;
    var index = _loadDrawingsIndex(pid);
    var idxMap = {};
    for (var i = 0; i < index.length; i++) idxMap[index[i].id] = index[i];

    var promises = [];
    for (var j = 0; j < ids.length; j++) {
      (function (did) {
        promises.push(_loadDrawingBlob(pid, did).then(function (content) {
          return { id: did, meta: idxMap[did], content: content };
        }));
      })(ids[j]);
    }

    Promise.all(promises).then(function (results) {
      var valid = [];
      for (var k = 0; k < results.length; k++) {
        if (results[k].content && results[k].meta) valid.push(results[k]);
      }
      if (valid.length === 0) return;

      // Stagger downloads by 300ms so browsers don't block rapid-fire clicks
      function downloadOne(idx) {
        if (idx >= valid.length) return;
        var r = valid[idx];
        var name = r.meta.name || 'drawing';
        if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
        name = name + '.pdf';

        // Use a Blob + object URL for reliability across browsers
        try {
          var byteString = atob(r.content.split(',')[1] || '');
          var ab = new ArrayBuffer(byteString.length);
          var ia = new Uint8Array(ab);
          for (var b = 0; b < byteString.length; b++) ia[b] = byteString.charCodeAt(b);
          var blob = new Blob([ab], { type: 'application/pdf' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Revoke after a short delay to let the download begin
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) {
          // Fallback: direct data URL (works for single-file)
          var a2 = document.createElement('a');
          a2.href = r.content;
          a2.download = name;
          document.body.appendChild(a2);
          a2.click();
          document.body.removeChild(a2);
        }

        setTimeout(function () { downloadOne(idx + 1); }, 300);
      }
      downloadOne(0);
    }).catch(function (err) {
      console.warn('[AlignDrawings] Export failed:', err);
    });
    });  // close _getSelectedIds().then()
  }

  /** Delete selected drawings. Calls server API for each, then cleans up local state. */
  function _deleteSelectedDrawings(selectAll) {
    _getSelectedIds(selectAll).then(function (ids) {
    if (ids.length === 0) return;

    var label = ids.length === 1 ? 'this drawing' : ids.length + ' drawings';
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;

    var pid = state.projectId;

    // 1) Soft-delete each file on the server via centralized API
    var serverDeletes = [];
    for (var i = 0; i < ids.length; i++) {
      (function (fileId) {
        serverDeletes.push(
          window.Api ? window.Api.del('/api/files/' + encodeURIComponent(fileId)) :
          fetch('/api/files/' + encodeURIComponent(fileId), {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('align-token') || '') }
          }).then(function (r) {
            if (!r.ok) throw new Error('Server delete failed: ' + r.status);
            return r.json();
          })
        );
      })(ids[i]);
    }

    Promise.all(serverDeletes).then(function () {
      // 2) Clean up local IndexedDB blobs
      var delPromises = [];
      for (var j = 0; j < ids.length; j++) {
        delPromises.push(_deleteDrawingBlob(pid, ids[j]));
      }
      return Promise.all(delPromises);
    }).then(function () {
      // 3) Clean up local index
      var index = _loadDrawingsIndex(pid);
      var deletedSet = {};
      for (var d = 0; d < ids.length; d++) deletedSet[ids[d]] = true;
      var keep = [];
      for (var k = 0; k < index.length; k++) {
        if (!deletedSet[index[k].id]) keep.push(index[k]);
      }
      _saveDrawingsIndex(pid, keep);

      // 4) Clear selection and re-render
      state.selectMode = false;
      state.selectedIds = {};
      _paint();
    }).catch(function (err) {
      state.uploadError = 'Delete failed: ' + (err.message || 'Unknown error');
      _paint();
    });
    });  // close _getSelectedIds().then()
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  /* ── Phase 3: Pin Overlay Integration ──────────────────────────────────── */
  
  var _pinOverlay = null; // Global reference to current pin overlay
  
  function _mvInitPinOverlay() {
    // Don't load pins for markup mode — pins are read-only annotations
    // Only init after viewer is fully set up
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas || !_mv || !_mv.drawingId) return;
    
    // Init the pin overlay library
    if (!window.PinOverlay) {
      console.warn('[AlignDrawings] PinOverlay library not loaded');
      return;
    }
    
    // Set context variables for the API
    window.currentProjectId = _mv.projectId;
    window.currentUserId = 'system'; // TODO: get from auth
    
    // Initialize overlay
    window.PinOverlay.init(canvas, _mv.drawingId);
    _pinOverlay = window.PinOverlay;
    
    // Set initial sheet for PDF viewers
    if (_mv.isPdf && _mv.currentPdfPage !== undefined) {
      _pinOverlay.updateSheet(_mv.currentPdfPage);
    } else {
      _pinOverlay.updateSheet(0);
    }
    
    // Listen for pin clicks → open punchlist item detail
    var overlay = document.querySelector('.pin-overlay');
    if (overlay) {
      overlay.addEventListener('pinClicked', function(e) {
        var itemId = e.detail.punchItemId;
        var pin = e.detail.pin;
        
        // Open punchlist detail view using the global AlignPunchlist state machine
        if (window.AlignPunchlist) {
          // Fetch the punch item from the database
          fetch('/api/punchlist/' + encodeURIComponent(itemId))
            .then(r => r.json())
            .then(item => {
              if (item && !item.error) {
                // Set punchlist state to detail view
                window.AlignPunchlist.state.detailItem = item;
                window.AlignPunchlist.state.viewMode = 'detail';
                
                // Scroll punchlist section into view
                var punchSection = document.querySelector('[data-section="punchlist"]');
                if (punchSection) {
                  punchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                
                // Repaint punchlist UI with detail view
                if (window.AlignPunchlist.repaint) {
                  window.AlignPunchlist.repaint();
                }
                
                console.log('[AlignDrawings] Opened punchlist detail:', itemId);
              } else {
                console.warn('[AlignDrawings] Failed to load punch item:', itemId);
              }
            })
            .catch(err => console.error('[AlignDrawings] Punch item fetch error:', err));
        } else {
          console.warn('[AlignDrawings] AlignPunchlist not available');
        }
      });
    }
    
    console.log('[AlignDrawings] Pin overlay initialized for drawing:', _mv.drawingId);
  }
  
  function _mvUpdatePinSheet(sheetNumber) {
    if (_pinOverlay) {
      _pinOverlay.updateSheet(sheetNumber);
    }
  }

  window.AlignDrawings = {
    render: render
  };

  if (window.TileRegistry) window.TileRegistry.register({ id: 'drawings', title: 'Drawings', icon: '#', route: 'drawings', roles: ['user','admin'], order: 3 });
})(window);

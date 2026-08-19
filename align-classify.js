/* align-classify.js — Auto-filing classifier (Phase 1).
 * Classifies an upload into source_tile + dimension fields, reading the
 * parent record from the polymorphic `records` table. Never throws — degrades
 * to classify_status='needs_filing' so a bad upload can never crash the server.
 */
'use strict';

const VALID_TILES = ['daily-logs', 'punchlist', 'drawing', 'submittals', 'rfis', 'tasks', 'contracts', 'specs'];

function today() { return new Date().toISOString().slice(0, 10); }

function loadParent(dbGet, projectId, category, recordId) {
  const row = dbGet('SELECT data FROM records WHERE id = ? AND project_id = ? AND category = ?', recordId, projectId, category);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch (e) { return null; }
}

/**
 * ctx: { projectId, sourceTile, sourceId, fileType }
 * returns { source_tile, source_id, doc_date, spec_section, classify_status }
 */
function classify(dbGet, ctx) {
  const projectId = ctx.projectId;
  const sourceTile = ctx.sourceTile || null;
  const sourceId = ctx.sourceId || null;
  const fileType = ctx.fileType;
  const none = { source_tile: null, source_id: null, doc_date: null, spec_section: null, classify_status: 'needs_filing' };

  // Photos with no explicit source fold into daily-log-by-date (founder decision).
  if (!sourceTile && fileType === 'photo')
    return { source_tile: 'daily-logs', source_id: null, doc_date: today(), spec_section: null, classify_status: 'auto' };

  if (!sourceTile || VALID_TILES.indexOf(sourceTile) < 0) return none;

  // Tiles that don't require a parent record.
  if (sourceTile === 'drawing')
    return { source_tile: 'drawing', source_id: sourceId || null, doc_date: today(), spec_section: null, classify_status: 'auto' };
  if (sourceTile === 'specs')
    return { source_tile: 'specs', source_id: null, doc_date: today(), spec_section: null, classify_status: 'needs_filing' };

  // Parent-record tiles: source_tile IS the records.category.
  const data = sourceId ? loadParent(dbGet, projectId, sourceTile, sourceId) : null;
  if (!data) return none; // orphan/missing parent -> triage, don't guess

  const out = { source_tile: sourceTile, source_id: sourceId, doc_date: today(), spec_section: null, classify_status: 'auto' };

  if (sourceTile === 'daily-logs')
    out.doc_date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : today();

  if (sourceTile === 'submittals') {
    out.spec_section = data.spec_section || null;
    if (!out.spec_section) out.classify_status = 'needs_filing';
  }
  // punchlist / rfis / tasks / contracts: inherit parent id + category, dated at upload.
  return out;
}

const DIV_KEYWORDS = [
  [/concrete|rebar|formwork/i, '03'], [/masonry|brick|cmu/i, '04'],
  [/steel|joist|deck/i, '05'], [/carpentry|millwork|wood/i, '06'],
  [/roof|insulat|waterproof|sealant/i, '07'], [/door|window|glaz|storefront/i, '08'],
  [/drywall|gypsum|paint|floor|tile|ceiling|finish/i, '09'],
  [/sprinkler|fire suppress/i, '21'], [/plumb/i, '22'], [/hvac|duct|mechanical/i, '23'],
  [/electric|light|luminaire|fixture|panel|conduit|breaker/i, '26'], [/data|comm|network/i, '27'],
  [/security|access control|camera/i, '28'], [/earthwork|excavat|grading/i, '31'],
  [/paving|landscap|site/i, '32'], [/utilit|storm|sewer/i, '33']
];

function suggestDivision(title) {
  title = title || '';
  for (let i = 0; i < DIV_KEYWORDS.length; i++) {
    if (DIV_KEYWORDS[i][0].test(title)) return DIV_KEYWORDS[i][1];
  }
  return null;
}

module.exports = { classify: classify, suggestDivision: suggestDivision, VALID_TILES: VALID_TILES };

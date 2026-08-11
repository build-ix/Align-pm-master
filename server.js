/*
 * server.js — Align Backend (SQLite via sql.js — pure JS, no native modules)
 * =================================================================
 * Self-hosted. One file: data/align.db. Back it up like any file.
 *
 * RUN:  node server.js
 * ACCESS:  http://localhost:3002   |   http://<your-ip>:3002
 */

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const { execFile } = require('child_process');
const { runMigrations } = require('./migrations');
const sessions = require('./align-sessions');
const auth = require('./align-auth-middleware');
const invites = require('./align-invites');

const PORT = process.env.PORT || 3002;
const DEV_MODE = process.env.DEV_MODE !== 'false'; // true by default for development
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'align.db');
const MAIL_LOG = path.join(DATA_DIR, 'mail.log');
const SECURITY_LOG = path.join(DATA_DIR, 'security.log');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

[DATA_DIR, UPLOADS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/* ------------------------------------------------------------------ *
 * 1. SQLITE via sql.js — thin wrapper for ?-style prepared statements
 * ------------------------------------------------------------------ */

let _savePending = false;
// _db is initialized in startup section below (better-sqlite3, synchronous)

// Clean up expired sessions every hour
setInterval(() => {
  try {
    sessions.cleanupSessions(dbRun);
  } catch (e) { /* DB might not be initialized yet */ }
}, 3600000);

// Clean up expired invites every hour
setInterval(() => {
  try {
    invites.cleanupExpired(dbRun);
  } catch (e) { /* DB might not be initialized yet */ }
}, 3600000);

// Purge trashed files older than 30 days (runs hourly)
function purgeOldTrash() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const trash = dbAll("SELECT * FROM files WHERE trashed = 1 AND trashed_at < ?", cutoff.toISOString());
    trash.forEach(f => {
      if (f.type === 'file' && f.stored_path) {
        try { fs.unlinkSync(f.stored_path); } catch (e) { /* already gone */ }
      }
      dbRun('DELETE FROM files WHERE id = ?', f.id);
    });
    if (trash.length > 0) console.log('[TRASH] Purged ' + trash.length + ' expired files');
  } catch (e) { /* DB might not be initialized yet */ }
}
setInterval(purgeOldTrash, 3600000);
// Also run once at startup after DB init
setTimeout(purgeOldTrash, 5000);

// Fix booleans for better-sqlite3 (throws on true/false)
function _fix(params) {
  return params.map(function(p) { return p === true ? 1 : p === false ? 0 : p; });
}

function dbRun(sql, ...params) {
  return _db.prepare(sql).run(..._fix(params));
}

function dbGet(sql, ...params) {
  return _db.prepare(sql).get(..._fix(params)) || null;
}

function dbAll(sql, ...params) {
  return _db.prepare(sql).all(..._fix(params));
}

function dbExec(sql) {
  _db.exec(sql);
}

const _db = new Database(DB_PATH);
_db.pragma('journal_mode = WAL');
_db.pragma('synchronous = NORMAL');
_db.pragma('busy_timeout = 5000');
_db.pragma('foreign_keys = ON');
_db.pragma('cache_size = -64000');
runMigrations(_db);

/* ------------------------------------------------------------------ *
 * 2. HELPERS
 * ------------------------------------------------------------------ */

function uid() {
  return 'a_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function nowISO() {
  return new Date().toISOString();
}

/* ── Audit trail ──────────────────────────────────────────────────── */
function logAudit(action, recordId, projectId, category, oldData, newData, user) {
  var ts = nowISO();
  dbRun(
    'INSERT INTO audit_log (record_id, project_id, category, action, user_id, user_name, old_data, new_data, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    recordId, projectId, category, action,
    user ? user.id : null,
    user ? (user.name || user.username || user.email) : null,
    oldData ? JSON.stringify(oldData) : null,
    newData ? JSON.stringify(newData) : null,
    ts
  );
}

/* ── Idempotency guard (sync dedup) ──────────────────────────────── */
function checkIdempotent(key) {
  if (!key) return null;
  var row = dbGet('SELECT response FROM idempotency_keys WHERE key = ?', key);
  return row ? JSON.parse(row.response) : null;
}
function markIdempotent(key, response) {
  if (!key) return;
  try { dbRun('INSERT INTO idempotency_keys (key, response, created_at) VALUES (?, ?, ?)', key, JSON.stringify(response), nowISO()); } catch(e) {}
}
setInterval(function() {
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  dbRun('DELETE FROM idempotency_keys WHERE created_at < ?', cutoff.toISOString());
}, 3600000);

// Validate record data against category-specific rules
function _validateRecord(cat, data) {
  if (!data || typeof data !== 'object') return 'Invalid record data';
  if (!data.title && cat === 'punchlist') return 'Punchlist item requires a title';
  if (!data.title && cat === 'tasks') return 'Task requires a title';
  if (!data.title && !data.subject && cat === 'rfis') return 'RFI requires a subject';
  if (!data.title && cat === 'schedule') return 'Schedule item requires a title';
  if (!data.title && cat === 'specs') return 'Spec requires a title';
  if (!data.title && cat === 'budget') return 'Budget line item requires a title';
  if (!data.name && !data.company && cat === 'contacts') return 'Contact requires a name';
  if (cat === 'punchlist') {
    var validStatuses = ['open','in_progress','resolved','verified'];
    if (data.status && validStatuses.indexOf(data.status) === -1) return 'Invalid status: ' + data.status;
    var validPriorities = ['low','medium','high','critical'];
    if (data.priority && validPriorities.indexOf(data.priority) === -1) return 'Invalid priority: ' + data.priority;
  }
  if (cat === 'rfis') {
    // v2 statuses (draft/submitted/answered/closed) + legacy 'open' for old records
    var rfiStatuses = ['draft','submitted','answered','closed','open'];
    if (data.status && rfiStatuses.indexOf(data.status) === -1) return 'Invalid RFI status: ' + data.status;
  }
  if (cat === 'schedule') {
    var schStatuses = ['upcoming','in_progress','completed','delayed'];
    if (data.status && schStatuses.indexOf(data.status) === -1) return 'Invalid schedule status: ' + data.status;
  }
  if (cat === 'daily-logs' && !data.date) return 'Daily log requires a date';
  return null; // valid
}

function sessionExpiry() { return sessions.sessionExpiry(); }

function setAuthCookie(res, token) {
  res.cookie('align-token', token, {
    httpOnly: true, secure: true, sameSite: 'lax',
    maxAge: sessions.SESSION_DAYS * 24 * 60 * 60 * 1000, path: '/'
  });
}

function safeUser(u) {
  return {
    id: u.id, username: u.username || null, email: u.email, name: u.name,
    role: u.role, status: u.status || 'active',
    active_project_id: u.active_project_id,
    created_at: u.created_at, updated_at: u.updated_at
  };
}

// Validate and sanitize project membership role
function sanitizeMembershipRole(role) {
  if (role === 'admin' || role === 'member') return role;
  if (role === 'superadmin') return 'admin'; // legacy migration
  return 'member'; // default fallback
}

// Normalize room permissions — strip invalid rooms, coerce to valid levels
const VALID_ROOMS = ['drawings','daily-logs','specs','rfis','punchlist','schedule','budget','contacts','photos','tasks','procurement','files','settings'];
const VALID_LEVELS = ['none', 'r', 'rw'];

function normalizePermissions(perms) {
  if (!perms || typeof perms !== 'object') return {};
  var clean = {};
  for (var i = 0; i < VALID_ROOMS.length; i++) {
    var room = VALID_ROOMS[i];
    var val = perms[room];
    if (val && VALID_LEVELS.indexOf(val) !== -1) {
      clean[room] = val;
    }
  }
  return clean;
}

/* ------------------------------------------------------------------ *
 * 2a. EMAIL TRANSPORT (SendGrid)
 * ------------------------------------------------------------------ */
const mailTransport = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  secure: false,
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY || ''
  }
});

function sendEmail(to, subject, htmlBody) {
  const from = process.env.EMAIL_FROM || 'setup@alignprojects.net';
  const msg = { from, to, subject, html: htmlBody };
  // Log all email to file for record-keeping
  const entry = [
    '---',
    'TO:      ' + to,
    'SUBJECT: ' + subject,
    'DATE:    ' + nowISO(),
    '',
    htmlBody,
    '',
  ].join('\n');
  fs.appendFileSync(MAIL_LOG, entry, 'utf8');

  return mailTransport.sendMail(msg)
    .then(() => console.log('[MAIL] Sent to ' + to + ': ' + subject))
    .catch(err => {
      console.error('[MAIL] Failed to ' + to + ': ' + err.message);
    });
}

function sendInviteEmail(email, name, code, expires) {
  var link = 'https://alignprojects.net/#setup=' + code;
  var html = '<h2>Welcome to Align PM</h2>' +
    '<p>Hi ' + name + ',</p>' +
    '<p>You have been invited to join Align PM. Click below to set up your account:</p>' +
    '<p><a href="' + link + '" style="padding:12px 24px;background:#6366F1;color:#fff;border-radius:6px;text-decoration:none;">Set Up Account</a></p>' +
    '<p>Your invite code: <strong>' + code + '</strong></p>' +
    '<p>This invite expires on ' + new Date(expires).toLocaleDateString() + '.</p>';
  return sendEmail(email, 'Welcome to Align PM', html);
}

function sendProjectWelcomeEmail(email, name, projectNames) {
  var projectsHtml = Array.isArray(projectNames) ? projectNames.join(', ') : projectNames;
  var html = '<h2>You have been added to a new project</h2>' +
    '<p>Hi ' + name + ',</p>' +
    '<p>You have been invited to join the following project' + (Array.isArray(projectNames) && projectNames.length > 1 ? 's' : '') + ' on Align PM:</p>' +
    '<p><strong>' + projectsHtml + '</strong></p>' +
    '<p>Your account is active. The next time you log in, you will see the new project' + (Array.isArray(projectNames) && projectNames.length > 1 ? 's' : '') + ' in your project list.</p>' +
    '<p><a href="https://alignprojects.net" style="padding:12px 24px;background:#6366F1;color:#fff;border-radius:6px;text-decoration:none;">Open Align PM</a></p>';
  return sendEmail(email, 'New project invitation — Align PM', html);
}

function logSecurity(action, details) {
  const actor = details.actor || 'system';
  const entry = `[${nowISO()}] ${action.toUpperCase()}: ${actor} — ${details.msg || ''}\n`;
  fs.appendFileSync(SECURITY_LOG, entry, 'utf8');
  console.log('[SECURITY] ' + entry.trim());
}

function parseJSON(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}

/* ------------------------------------------------------------------ *
 * 3. AUTH MIDDLEWARE
 * ------------------------------------------------------------------ */

// Token hashing — SHA-256 (fast indexed lookup, not bcrypt)
function tokenHash(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function requireAuth(req, res, next) {
  // Read token from httpOnly cookie OR Authorization header
  var rawToken = req.cookies['align-token'] ||
    (req.headers.authorization || '').replace('Bearer ', '');

  // DEV MODE: auto-authenticate as admin
  if (DEV_MODE && (!rawToken || rawToken === 'dev')) {
    const admin = dbGet("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
    if (admin) {
      req.user = admin;
      req.token = 'dev';
      req.isDevMode = true;
      return next();
    }
  }

  if (!rawToken) return res.status(401).json({ error: 'Not signed in' });

  // New path: auth_tokens table (bearer tokens)
  var row = dbGet(
    'SELECT user_id FROM auth_tokens WHERE token_hash = ? AND expires_at > ?',
    tokenHash(rawToken), Date.now()
  );

  // Legacy path: sessions table (cookie sessions — pre-migration)
  if (!row) {
    const result = sessions.validateSession(dbGet, dbRun, rawToken, safeUser);
    if (result) {
      req.user = result.user;
      req.token = rawToken;
      sessions.slideSession(dbRun, rawToken);
      return next();
    }
  }

  if (!row) return res.status(401).json({ error: 'Session expired' });

  req.user = dbGet('SELECT * FROM users WHERE id = ?', row.user_id);
  req.token = rawToken;

  // Reject deactivated accounts
  if (req.user && req.user.status === 'deactivated') {
    return res.status(403).json({ error: 'Account deactivated. Contact your administrator.' });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// File-level: lookup file's project, then check membership
function requireFileProjectMember(req, res, next) {
  const file = dbGet('SELECT project_id FROM files WHERE id = ?', req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  req.params.pid = String(file.project_id);
  return auth.requireProjectMember(dbGet)(req, res, next);
}

function requireFileRoom(dbGet, level) {
  return function (req, res, next) {
    const file = dbGet('SELECT project_id FROM files WHERE id = ?', req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    req.params.pid = String(file.project_id);
    req.params.cat = 'files';
    return auth.requireRoomFromParams(dbGet, level)(req, res, next);
  };
}

/* ------------------------------------------------------------------ *
 * 4. EXPRESS SETUP
 * ------------------------------------------------------------------ */

const app = express();

// ── Security headers ──
app.disable('x-powered-by');

// ── CORS for Capacitor bundled shell (capacitor://localhost) ──
app.use(function(req, res, next) {
  var origin = req.headers.origin;
  if (origin === 'capacitor://localhost' || origin === 'http://localhost' || origin === 'ionic://localhost') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      workerSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],  // pdf.js spawns a blob: worker from the CDN workerSrc
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.open-meteo.com"],
      connectSrc: ["'self'", "https://api.open-meteo.com", "https://api.weather.gov", "https://nominatim.openstreetmap.org", "https://ipapi.co"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,       // allow pdf.js workers
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(compression()); // gzip all responses

// Cache strategy — version-bumped assets are immutable, HTML validates before use
// JS/CSS files use ?v=N query params for cache busting (bump in index.html on change)
app.use(function(req, res, next) {
  const p = req.path;

  // API routes: never cache (browser should always hit the server)
  if (p.startsWith('/api/')) return next();

  // Service worker: always validate before use (want updates to propagate fast)
  if (p.endsWith('/align-sw.js')) {
    res.setHeader('Cache-Control', 'no-cache');
    return next();
  }

  // HTML: validate with server before using cached copy
  if (p.endsWith('.html') || p === '/') {
    res.setHeader('Cache-Control', 'no-store');
    return next();
  }

  // Version-bumped JS/CSS (?v=N): immutable — cache forever, version bump invalidates
  if (req.query && req.query.v && (p.endsWith('.js') || p.endsWith('.css'))) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return next();
  }

  // Unversioned JS/CSS: short cache (safety net — most files use ?v= now)
  if (p.match(/\.(js|css)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return next();
  }

  // Images and static assets: 1 day
  if (p.match(/\.(png|svg|ico|webp|jpg|jpeg|gif|woff2?)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return next();
  }

  next();
});
// Block sensitive files from being served publicly
app.use(function(req, res, next) {
  // Normalize path: URL-decode, collapse /./ and //, strip trailing slash
  let normalized = req.path;
  // Decode URL-encoded characters (%73 → s, %2e → ., etc.)
  try { normalized = decodeURIComponent(normalized); } catch (e) { /* malformed, block it */ return res.status(400).send('Bad request'); }
  // Collapse /./ and // sequences, strip trailing slash (loop: overlapping /./)
  while (/\/\.\//.test(normalized)) {
    normalized = normalized.replace(/\/\.\//g, '/');
  }
  normalized = normalized.replace(/\/+/g, '/').replace(/\/\.?$/, '') || '/';
  const blocked = [
    /^\/server\.js$/i,
    /^\/package(-lock)?\.json$/i,
    /^\/node_modules(\/|$)/i,
    /^\/data(\/|$)/i,
    /\.db$/i,
    /^\/\.env/i,
    /^\/\.git/i,
    /security\.log$/i,
  ];
  if (blocked.some(p => p.test(normalized))) {
    return res.status(404).send('Not found');
  }
  next();
});

// ── Request logger: JSON per request for journalctl ──
app.use(function(req, res, next) {
  var start = Date.now();
  res.on('finish', function() {
    var log = JSON.stringify({
      t: new Date().toISOString().replace('T',' ').slice(0,19),
      m: req.method,
      p: req.path,
      s: res.statusCode,
      ms: Date.now() - start,
      u: req.user ? req.user.id : null,
      ip: req.ip
    });
    // Only log API requests, skip static files
    if (req.path.indexOf('/api/') === 0) console.log(log);
  });
  next();
});

app.use(express.static(__dirname, {
  etag: true,
  lastModified: true,
  setHeaders: function(res, filepath) {
    // JS/CSS: immutable (versioned filenames)
    if (filepath.match(/\.(js|css)(\?|$)/)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // Images: long cache
    else if (filepath.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/)) {
      res.set('Cache-Control', 'public, max-age=86400');
    }
    // HTML: no cache
    else if (filepath.match(/\.html$/)) {
      res.set('Cache-Control', 'no-store');
    }
  }
}));

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: Infinity } });

/* ------------------------------------------------------------------ *
 * 5. ROUTES — Health
 * ------------------------------------------------------------------ */

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, time: nowISO() });
});

// ── Health check: for monitoring and load balancers ──
app.get('/api/health', (_req, res) => {
  var dbOk = false;
  try {
    dbGet('SELECT 1');
    dbOk = true;
  } catch (_) {}
  res.json({
    ok: dbOk,
    db: dbOk ? 'connected' : 'error',
    uptime: Math.floor(process.uptime()),
    version: require('./config').APP_VERSION,
    time: nowISO()
  });
});

// ── Client error reporting ──
app.post('/api/client-errors', (req, res) => {
  var e = req.body || {};
  dbRun(
    'INSERT INTO client_errors (ts, scope, tile, message, stack, src) VALUES (?, ?, ?, ?, ?, ?)',
    nowISO(), e.scope || '', e.tile || '', String(e.message || '').slice(0, 500),
    String(e.stack || '').slice(0, 4000), e.src || ''
  );
  res.status(204).end();
});

// Dev: list recent errors
app.get('/api/client-errors', requireAuth, (req, res) => {
  var limit = parseInt(req.query.limit, 10) || 20;
  var rows = dbAll('SELECT * FROM client_errors ORDER BY id DESC LIMIT ?', limit);
  res.json({ items: rows });
});

// ── Feature flags ──
app.get('/api/flags', (_req, res) => {
  res.json({ devPanel: true, offlineBanner: true, newTileGrid: true });
});

// ── Thumbnail serving (generates on first request) ──
app.get('/api/thumbs/:fileId', function(req, res) {
  var fileId = req.params.fileId;
  var size = parseInt(req.query.size, 10) || 320;
  var file = dbGet('SELECT * FROM files WHERE id = ?', fileId);
  if (!file) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });

  var ext = (file.name || '').split('.').pop().toLowerCase();
  var uploadPath = path.join(UPLOADS_DIR, file.id + '.' + ext);

  try {
    var thumb = require('./thumbs');
    thumb.generate(uploadPath, fileId, size).then(function(tpath) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', 'image/webp');
      res.sendFile(tpath);
    }).catch(function() {
      // Thumbnail failed — serve original
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(uploadPath);
    });
  } catch (_) {
    res.sendFile(uploadPath);
  }
});

// ── Session: bootstrap payload for the SPA router ──
app.get('/api/session', requireAuth, (req, res) => {
  const user = safeUser(req.user);
  // Projects the user has access to
  let projects = [];
  if (req.user.role === 'admin') {
    projects = dbAll('SELECT p.* FROM projects p ORDER BY p.created_at DESC');
  } else {
    projects = dbAll(
      'SELECT p.*, up.role AS project_role FROM projects p JOIN user_projects up ON up.project_id = p.id WHERE up.user_id = ? ORDER BY p.created_at DESC',
      req.user.id
    );
  }
  projects = projects.map(function (p) {
    var count = dbGet('SELECT COUNT(*) AS n FROM user_projects WHERE project_id = ?', p.id);
    return {
      id: p.id,
      name: p.name,
      address: p.address || '',
      role: p.project_role || (req.user.role === 'admin' ? 'super_admin' : 'user'),
      memberCount: count ? count.n : 0
    };
  });

  // Tile IDs this role can see
  var allTiles = ['daily-logs','punchlist','drawings','files','photos','tasks','contacts','schedule','budget','specs','procurement','rfis'];
  var adminTiles = ['settings','members'];
  var superTiles = ['dev'];
  var tiles = allTiles.slice();
  if (req.user.role === 'admin') tiles = tiles.concat(adminTiles).concat(superTiles);

  res.json({ user: user, projects: projects, tiles: tiles });
});

// ── Config: public config for the client ──
app.get('/api/config', (_req, res) => {
  res.json({
    devMode: DEV_MODE,
    version: '2.0.0',
    minClientVersion: '2.0.0',
    features: {
      upload: true,
      camera: true,
      offline: false,
      video: false
    },
    limits: {
      maxUploadBytes: 100 * 1024 * 1024,
      pageSize: 50,
      thumbnailSizes: [160, 320, 640, 1024]
    },
    routes: {
      auth: '/api/v1/auth',
      files: '/api/v1/files',
      projects: '/api/v1/projects'
    }
  });
});

// ── User listing — project-scoped (see below after invite endpoints)

const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many sign-in attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: function (req) {
    var body = req.body || {};
    return (body.email || body.username || 'default').toLowerCase().trim();
  },
  skipSuccessfulRequests: true,
});

const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: function (req) {
    var body = req.body || {};
    return (body.username || body.email || 'default').toLowerCase().trim();
  },
  skipSuccessfulRequests: true,
});

const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many invite attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: function (req) {
    var body = req.body || {};
    return (body.code || body.token || 'default').toLowerCase().trim();
  },
  skipSuccessfulRequests: true,
});

// Invite failure tracking — after 5 failed attempts, invalidate the code
const MAX_INVITE_ATTEMPTS = 5;
function recordInviteFailure(invite) {
  const attempts = (invite.failed_attempts || 0) + 1;
  dbRun('UPDATE invites SET failed_attempts = ? WHERE id = ?', attempts, invite.id);
  if (attempts >= MAX_INVITE_ATTEMPTS) {
    dbRun("UPDATE invites SET revoked_at = ? WHERE id = ?", nowISO(), invite.id);
  }
}

// Auth routes → routes/auth.js
require('./routes/auth')(app, {
  dbGet, dbRun, dbAll, uid, nowISO, safeUser, setAuthCookie, logSecurity,
  sessions, invites, bcrypt, crypto,
  signinLimiter, setupLimiter, inviteLimiter, recordInviteFailure,
  DEV_MODE, requireAuth, requireAdmin
});

/* ------------------------------------------------------------------ *
 * 6b. ROUTES — Invites * 6b. ROUTES — Invites
 * ------------------------------------------------------------------ */

// Create invite (admin only)
app.post('/api/invites', requireAuth, requireAdmin, (req, res) => {
  const { email, name, role, project_id, project_role, expires_days } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: 'email and name required' });

  try {
    const invite = invites.createInvite(dbRun, dbGet, {
      email, name, role, project_id, project_role,
      created_by: req.user.id, expires_days: expires_days || null
    });

    // Send invite email
    const inviteUrl = 'https://alignprojects.net/#setup=' + invite.code;
    const emailHtml = [
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">',
      '<h2 style="color:#111;">You\'ve been invited to Align</h2>',
      '<p>Hi ' + (name || 'there') + ',</p>',
      '<p>You\'ve been invited to join <strong>Align</strong>, a construction project management platform.</p>',
      '<p>Your invite code: <strong style="font-size:1.5rem;letter-spacing:4px;">' + invite.code + '</strong></p>',
      '<p><a href="' + inviteUrl + '" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Set Up Your Account</a></p>',
      '<p style="color:#666;font-size:0.85rem;">This invite lets you choose a username and create your password.</p>',
      '<hr style="border:0;border-top:1px solid #eee;margin:24px 0;">',
      '<p style="color:#999;font-size:0.75rem;">Sent from setup@alignprojects.net</p>',
      '</div>'
    ].join('\n');
    sendEmail(email, 'You\'ve been invited to Align', emailHtml);

    logSecurity('create_invite', { actor: req.user.username || req.user.email,
      msg: `Invited ${email} (${name}) code=${invite.code}` });

    res.status(201).json({ invite });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List invites (admin only)
app.get('/api/invites', requireAuth, requireAdmin, (req, res) => {
  const list = invites.listInvites(dbAll, {
    status: req.query.status || null,
    project_id: req.query.project_id || null
  });
  res.json({ invites: list });
});

// Revoke invite (admin only)
app.delete('/api/invites/:code', requireAuth, requireAdmin, (req, res) => {
  const ok = invites.revokeInvite(dbGet, dbRun, req.params.code);
  if (!ok) return res.status(404).json({ error: 'Invite not found or already used' });
  logSecurity('revoke_invite', { actor: req.user.username || req.user.email,
    msg: `Revoked invite ${req.params.code}` });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * 7. ROUTES — Projects
 * ------------------------------------------------------------------ */

app.get('/api/projects', requireAuth, (req, res) => {
  let projects;
  if (req.user.role === 'admin') {
    projects = dbAll('SELECT p.*, (SELECT COUNT(*) FROM user_projects up JOIN users u ON u.id = up.user_id WHERE up.project_id = p.id AND u.role != \'admin\') AS member_count, (SELECT COUNT(*) FROM invites WHERE project_id = p.id AND status = \'pending\') AS pending_count FROM projects p ORDER BY p.created_at DESC');
  } else {
    const ids = dbAll('SELECT project_id FROM user_projects WHERE user_id = ?', req.user.id).map(r => r.project_id);
    if (ids.length === 0) return res.json({ projects: [] });
    const placeholders = ids.map(() => '?').join(',');
    projects = dbAll('SELECT p.*, (SELECT COUNT(*) FROM user_projects up JOIN users u ON u.id = up.user_id WHERE up.project_id = p.id AND u.role != \'admin\') AS member_count, (SELECT COUNT(*) FROM invites WHERE project_id = p.id AND status = \'pending\') AS pending_count FROM projects p WHERE p.id IN (' + placeholders + ') ORDER BY p.created_at DESC', ...ids);
  }
  res.json({ projects });
});

// ── Invites: list pending for a project ──
app.get('/api/projects/:pid/invites', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  const invites = dbAll("SELECT * FROM invites WHERE project_id = ? AND status = 'pending'", req.params.pid);
  res.json({ invites });
});

// ── Invites: cancel ──
app.post('/api/invites/:id/cancel', requireAuth, (req, res) => {
  const invite = dbGet('SELECT * FROM invites WHERE id = ?', req.params.id);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  dbRun("UPDATE invites SET status = 'cancelled' WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

// ── Invites: resend ──
app.post('/api/invites/:id/resend', requireAuth, (req, res) => {
  const invite = dbGet('SELECT * FROM invites WHERE id = ?', req.params.id);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  // Update expiry + bump sent count
  var newExpiry = new Date(Date.now() + 7 * 86400000).toISOString();
  dbRun("UPDATE invites SET expires_at = ?, send_count = send_count + 1 WHERE id = ?", newExpiry, req.params.id);
  // Re-send the invite email
  if (invite.email && typeof sendInviteEmail === 'function') {
    sendInviteEmail(invite.email, invite.token, invite.name);
  }
  res.json({ ok: true });
});

app.get('/api/projects/:id', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  const project = dbGet('SELECT * FROM projects WHERE id = ?', req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

app.post('/api/projects', requireAuth, requireAdmin, (req, res) => {
  const { name, address, description, project_number, project_type, square_footage, start_date, target_completion } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Project name required' });

  const id = uid();
  const ts = nowISO();
  dbRun('INSERT INTO projects (id, name, address, description, project_number, project_type, square_footage, start_date, target_completion, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, name.trim(), (address || '').trim(), (description || '').trim(),
    (project_number || '').trim(), (project_type || '').trim(),
    square_footage ? parseInt(square_footage, 10) || null : null,
    (start_date || '').trim() || null, (target_completion || '').trim() || null,
    ts, ts);
  dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role) VALUES (?, ?, ?, ?)',
    req.user.id, id, '{}', 'admin');

  const project = dbGet('SELECT * FROM projects WHERE id = ?', id);
  res.status(201).json({ project });
});

app.patch('/api/projects/:id', requireAuth, auth.requireProjectAdmin(dbGet), (req, res) => {
  const project = dbGet('SELECT * FROM projects WHERE id = ?', req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { name, address, description, project_number, project_type, square_footage, start_date, target_completion } = req.body || {};
  dbRun('UPDATE projects SET name = ?, address = ?, description = ?, project_number = ?, project_type = ?, square_footage = ?, start_date = ?, target_completion = ?, updated_at = ? WHERE id = ?',
    name !== undefined ? name.trim() : project.name,
    address !== undefined ? address.trim() : (project.address || ''),
    description !== undefined ? description.trim() : (project.description || ''),
    project_number !== undefined ? project_number.trim() : (project.project_number || ''),
    project_type !== undefined ? project_type.trim() : (project.project_type || ''),
    square_footage !== undefined ? (square_footage ? parseInt(square_footage, 10) || null : null) : project.square_footage,
    start_date !== undefined ? (start_date || null) : project.start_date,
    target_completion !== undefined ? (target_completion || null) : project.target_completion,
    nowISO(),
    req.params.id);

  const updated = dbGet('SELECT * FROM projects WHERE id = ?', req.params.id);
  res.json({ project: updated });
});

app.delete('/api/projects/:id', requireAuth, requireAdmin, (req, res) => {
  if (!dbGet('SELECT id FROM projects WHERE id = ?', req.params.id))
    return res.status(404).json({ error: 'Project not found' });

  // Capture project users before deleting memberships
  var projectUsers = dbAll('SELECT user_id FROM user_projects WHERE project_id = ?', req.params.id);

  dbRun('DELETE FROM files WHERE project_id = ?', req.params.id);
  dbRun('DELETE FROM records WHERE project_id = ?', req.params.id);
  dbRun('DELETE FROM drawing_markups WHERE project_id = ?', req.params.id);
  dbRun('DELETE FROM user_projects WHERE project_id = ?', req.params.id);
  dbRun('DELETE FROM projects WHERE id = ?', req.params.id);

  // Clean up invites orphaned by project deletion (FK sets project_id to NULL)
  dbRun('DELETE FROM invites WHERE project_id IS NULL AND status = ?', 'pending');

  // Delete users who no longer belong to any project (orphaned users)
  // Must delete their invites first due to FK constraints
  projectUsers.forEach(function(u) {
    var remaining = dbGet('SELECT COUNT(*) as cnt FROM user_projects WHERE user_id = ?', u.user_id);
    if (remaining && remaining.cnt === 0) {
      var user = dbGet('SELECT id, email, role FROM users WHERE id = ?', u.user_id);
      if (user && user.role !== 'admin') {
        // Delete FK-referencing rows before deleting the user
        dbRun('DELETE FROM auth_tokens WHERE user_id = ?', user.id);
        dbRun('DELETE FROM invites WHERE created_by = ? OR used_by = ?', user.id, user.id);
        dbRun('DELETE FROM invites WHERE email = ?', user.email);
        dbRun('DELETE FROM users WHERE id = ?', user.id);
      }
    }
  });

  res.json({ ok: true });
});

// ── Project image upload ──
app.post('/api/projects/:id/image', requireAuth, requireAdmin, (req, res) => {
  const projectUpload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 5 * 1024 * 1024 } });
  projectUpload.single('image')(req, res, function(err) {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const mime = req.file.mimetype;
    if (!mime || !mime.startsWith('image/')) {
      try { fs.unlinkSync(req.file.path); } catch(e) {}
      return res.status(400).json({ error: 'Only image files allowed' });
    }
    const projectDir = path.join(UPLOADS_DIR, 'project-images');
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
    const ext = (req.file.originalname || 'img').split('.').pop();
    const filename = req.params.id + '_' + Date.now() + '.' + ext;
    const finalPath = path.join(projectDir, filename);
    fs.renameSync(req.file.path, finalPath);

    const fileId = uid();
    dbRun('INSERT INTO files (id, project_id, folder_id, type, filename, original_name, mime_type, size_bytes, stored_path, created_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      fileId, req.params.id, null, 'file', filename, req.file.originalname, mime, req.file.size, finalPath, nowISO(), req.user.username || '');

    // Delete old image if replacing
    const old = dbGet('SELECT image_file_id FROM projects WHERE id = ?', req.params.id);
    if (old && old.image_file_id) {
      const oldFile = dbGet('SELECT stored_path FROM files WHERE id = ?', old.image_file_id);
      if (oldFile) { try { fs.unlinkSync(oldFile.stored_path); } catch(e) {} }
      dbRun('DELETE FROM files WHERE id = ?', old.image_file_id);
    }

    dbRun('UPDATE projects SET image_file_id = ?, updated_at = ? WHERE id = ?', fileId, nowISO(), req.params.id);
    res.json({ image_file_id: fileId });
  });
});

app.put('/api/projects/:id/active', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  if (!dbGet('SELECT id FROM projects WHERE id = ?', req.params.id))
    return res.status(404).json({ error: 'Project not found' });

  dbRun('UPDATE users SET active_project_id = ?, updated_at = ? WHERE id = ?',
    req.params.id, nowISO(), req.user.id);
  res.json({ ok: true });
});

// ── Project permissions (my own) ──
app.get('/api/projects/:id/permissions', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  const row = dbGet('SELECT permissions, role FROM user_projects WHERE user_id = ? AND project_id = ?',
    req.user.id, req.params.id);
  let perms = row ? parseJSON(row.permissions) : {};
  let role = row ? row.role : null;

  if (req.user.role === 'admin') {
    perms = {};
    role = 'admin';
    ['drawings','daily-logs','specs','rfis','punchlist','schedule','budget','contacts','photos','tasks','procurement','files','settings'].forEach(s => perms[s] = true);
  }

  res.json({ permissions: perms, role: role });
});

// ── All members' permissions (admin only) ──
app.get('/api/projects/:id/permissions/all', requireAuth, auth.requireProjectAdmin(dbGet), (req, res) => {
  const rows = dbAll('SELECT up.user_id, up.permissions, up.role, u.email, u.name FROM user_projects up JOIN users u ON u.id = up.user_id WHERE up.project_id = ?', req.params.id);
  res.json({ members: rows.map(function(r) { return { user_id: r.user_id, name: r.name || r.email, email: r.email, project_role: r.role, permissions: parseJSON(r.permissions) }; }) });
});

// ── Project permissions (project admin or server admin) ──
app.put('/api/projects/:id/permissions/:userId', requireAuth, auth.requireProjectAdmin(dbGet), (req, res) => {
  const { permissions, role } = req.body || {};
  const cleanPerms = normalizePermissions(permissions || {});
  // Prevent self-lockout: admin cannot remove their own settings/files access
  if (req.params.userId === req.user.id) {
    if (cleanPerms.settings === 'none' || cleanPerms.files === 'none') {
      return res.status(400).json({ error: 'Cannot lock yourself out of Settings or Files' });
    }
  }
  const existing = dbGet('SELECT role, company_id FROM user_projects WHERE user_id = ? AND project_id = ?',
    req.params.userId, req.params.id);
  const keepRole = sanitizeMembershipRole(role || (existing ? existing.role : 'member'));
  const keepCompany = existing ? existing.company_id : null;
  dbRun('INSERT OR REPLACE INTO user_projects (user_id, project_id, permissions, role, company_id) VALUES (?, ?, ?, ?, ?)',
    req.params.userId, req.params.id, JSON.stringify(cleanPerms), keepRole, keepCompany);
  res.json({ ok: true });
});

// ── Project Members ──────────────────────────────────────────────────────

app.get('/api/projects/:id/members', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  const rows = dbAll(
    'SELECT up.user_id, up.permissions, up.role, u.email, u.name, u.role as global_role FROM user_projects up JOIN users u ON u.id = up.user_id WHERE up.project_id = ?',
    req.params.id
  );
  res.json({
    members: rows.map(function(r) {
      return {
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        global_role: r.global_role,
        project_role: r.role || 'member',
        permissions: parseJSON(r.permissions)
      };
    })
  });
});

app.post('/api/projects/:id/members', requireAuth, auth.requireProjectAdmin(dbGet), (req, res) => {
  const { user_id, permissions, role } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const user = dbGet('SELECT id FROM users WHERE id = ?', user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  dbRun('INSERT OR REPLACE INTO user_projects (user_id, project_id, permissions, role) VALUES (?, ?, ?, ?)',
    user_id, req.params.id, JSON.stringify(permissions || {}), role || 'member');
  res.status(201).json({ ok: true });
});

app.delete('/api/projects/:id/members/:userId', requireAuth, auth.requireProjectAdmin(dbGet), (req, res) => {
  // Prevent last admin from leaving (must promote someone else first)
  const admins = dbGet(
    "SELECT COUNT(*) AS count FROM user_projects WHERE project_id = ? AND role = 'admin' AND user_id != ?",
    req.params.id, req.params.userId
  );
  if (!admins || admins.count === 0) {
    return res.status(400).json({ error: 'Cannot remove the last project admin. Promote another member first.' });
  }
  dbRun('DELETE FROM user_projects WHERE user_id = ? AND project_id = ?',
    req.params.userId, req.params.id);

  // ── Clean up orphan users (no remaining projects) ──
  var remaining = dbGet('SELECT COUNT(*) as cnt FROM user_projects WHERE user_id = ?', req.params.userId);
  if (remaining && remaining.cnt === 0) {
    var user = dbGet('SELECT id, email, role, status FROM users WHERE id = ?', req.params.userId);
    if (user && user.role !== 'admin') {
      // Pending users → fully delete so next invite is fresh
      if (user.status === 'pending') {
        dbRun('DELETE FROM auth_tokens WHERE user_id = ?', user.id);
        dbRun('DELETE FROM invites WHERE created_by = ? OR used_by = ?', user.id, user.id);
        dbRun('DELETE FROM invites WHERE email = ?', user.email);
        dbRun('DELETE FROM users WHERE id = ?', user.id);
      } else {
        // Active/deactivated non-admins → deactivate (blocks login, preserves audit trail)
        dbRun("UPDATE users SET status = 'deactivated', invite_status = 'revoked' WHERE id = ?", user.id);
        dbRun('DELETE FROM auth_tokens WHERE user_id = ?', user.id);
      }
    }
  }

  res.json({ ok: true });
});

// Promote / demote member (project admin only)
app.patch('/api/projects/:id/members/:userId/role', requireAuth, auth.requireProjectAdmin(dbGet), (req, res) => {
  const { role } = req.body || {};
  if (!role || ['member', 'admin'].indexOf(role) === -1) {
    return res.status(400).json({ error: "Role must be 'member' or 'admin'" });
  }

  const member = dbGet('SELECT role FROM user_projects WHERE user_id = ? AND project_id = ?',
    req.params.userId, req.params.id);
  if (!member) return res.status(404).json({ error: 'User is not a member of this project' });

  // Prevent demoting the last admin
  if (role === 'member' && member.role === 'admin') {
    const admins = dbGet(
      "SELECT COUNT(*) AS count FROM user_projects WHERE project_id = ? AND role = 'admin' AND user_id != ?",
      req.params.id, req.params.userId
    );
    if (!admins || admins.count === 0) {
      return res.status(400).json({ error: 'Cannot demote the last project admin. Promote another member first.' });
    }
  }

  dbRun('UPDATE user_projects SET role = ? WHERE user_id = ? AND project_id = ?',
    role, req.params.userId, req.params.id);
  res.json({ ok: true, role: role });
});

/* ------------------------------------------------------------------ *
 * 7b. ROUTES — Companies (per-project)
 * ═══════════════════════════════════════════════════════════════════ */

// List companies for a project (any member can see — needed for dropdowns)
app.get('/api/projects/:pid/companies', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoom(dbGet, 'contacts', 'r'), (req, res) => {
  var companies = dbAll('SELECT * FROM companies WHERE project_id = ? AND active = 1 ORDER BY name', req.params.pid);
  res.json({ companies: companies });
});

// Create company (project admin only)
app.post('/api/projects/:pid/companies', requireAuth, auth.requireProjectAdmin(dbGet), auth.requireRoom(dbGet, 'contacts', 'rw'), (req, res) => {
  var name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Company name required' });
  var trade = (req.body.trade || '').trim() || null;
  var color = req.body.color || '#6366F1';
  var id = uid();
  var ts = nowISO();
  var existing = dbGet('SELECT id FROM companies WHERE project_id = ? AND name = ?', req.params.pid, name);
  if (existing) return res.status(409).json({ error: 'Company already exists in this project' });
  dbRun('INSERT INTO companies (id, project_id, name, trade, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, req.params.pid, name, trade, color, ts);
  var company = dbGet('SELECT * FROM companies WHERE id = ? AND project_id = ?', id, req.params.pid);
  res.status(201).json({ company: company });
});

// Update company (project admin only)
app.put('/api/projects/:pid/companies/:cid', requireAuth, auth.requireProjectAdmin(dbGet), auth.requireRoom(dbGet, 'contacts', 'rw'), (req, res) => {
  var company = dbGet('SELECT * FROM companies WHERE id = ? AND project_id = ?', req.params.cid, req.params.pid);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  var name = req.body.name !== undefined ? (req.body.name || '').trim() : company.name;
  var trade = req.body.trade !== undefined ? (req.body.trade || '').trim() || null : company.trade;
  var color = req.body.color || company.color;
  var active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : company.active;
  if (name !== company.name) {
    var dup = dbGet('SELECT id FROM companies WHERE project_id = ? AND name = ? AND id != ?', req.params.pid, name, req.params.cid);
    if (dup) return res.status(409).json({ error: 'Company name already exists' });
  }
  dbRun('UPDATE companies SET name = ?, trade = ?, color = ?, active = ? WHERE id = ? AND project_id = ?',
    name, trade, color, active, req.params.cid, req.params.pid);
  var updated = dbGet('SELECT * FROM companies WHERE id = ? AND project_id = ?', req.params.cid, req.params.pid);
  res.json({ company: updated });
});

// Delete company (project admin only, soft-delete if items reference it)
app.delete('/api/projects/:pid/companies/:cid', requireAuth, auth.requireProjectAdmin(dbGet), auth.requireRoom(dbGet, 'contacts', 'rw'), (req, res) => {
  var company = dbGet('SELECT * FROM companies WHERE id = ? AND project_id = ?', req.params.cid, req.params.pid);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  // Check if any punchlist items reference this company
  var inUse = dbGet("SELECT COUNT(*) as n FROM records WHERE project_id = ? AND category = 'punchlist' AND pl_company = ?",
    req.params.pid, req.params.cid);
  if (inUse && inUse.n > 0) {
    dbRun('UPDATE companies SET active = 0 WHERE id = ? AND project_id = ?', req.params.cid, req.params.pid);
    return res.json({ softDeleted: true, itemCount: inUse.n });
  }
  dbRun('DELETE FROM companies WHERE id = ? AND project_id = ?', req.params.cid, req.params.pid);
  res.json({ deleted: true });
});

/* ------------------------------------------------------------------ *
 * 8. ROUTES — Records
 * ------------------------------------------------------------------ */

// ── Folder creation ──
app.post('/api/projects/:pid/folders', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoom(dbGet, 'files', 'rw'), (req, res) => {
  const { name, folder_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Folder name required' });
  const id = uid();
  const ts = nowISO();
  dbRun('INSERT INTO files (id, project_id, folder_id, type, filename, original_name, mime_type, size_bytes, stored_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, req.params.pid, folder_id || null, 'folder', name, name, 'inode/directory', 0, '', ts);
  res.status(201).json({ folder: { id, project_id: req.params.pid, folder_id: folder_id || null, type: 'folder', original_name: name, created_at: ts } });
});

// ── List files in a folder ──
app.get('/api/projects/:pid/files', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoom(dbGet, 'files', 'r'), (req, res) => {
  const folderId = req.query.folder || null;
  const showTrash = req.query.trash === '1';
  let files;
  const trashFilter = showTrash ? 'AND trashed = 1' : 'AND trashed = 0';
  if (folderId && folderId !== 'root') {
    files = dbAll('SELECT * FROM files WHERE project_id = ? AND folder_id = ? AND type != \'photo\' ' + trashFilter + ' ORDER BY type ASC, original_name ASC', req.params.pid, folderId);
  } else if (folderId === 'root' && showTrash) {
    files = dbAll('SELECT * FROM files WHERE project_id = ? AND type != \'photo\' AND trashed = 1 ORDER BY trashed_at DESC', req.params.pid);
  } else {
    files = dbAll('SELECT * FROM files WHERE project_id = ? AND folder_id IS NULL AND type != \'photo\' ' + trashFilter + ' ORDER BY type ASC, original_name ASC', req.params.pid);
  }
  const result = files.map(f => ({
    id: f.id, project_id: f.project_id, folder_id: f.folder_id, type: f.type,
    original_name: f.original_name, mime_type: f.mime_type,
    size_bytes: f.size_bytes, created_at: f.created_at,
    trashed: f.trashed, trashed_at: f.trashed_at,
    uploaded_by: f.uploaded_by || ''
  }));
  res.json({ files: result });
});

// ── Rename file or folder ──
app.patch('/api/files/:id', requireAuth, requireFileProjectMember, requireFileRoom(dbGet, 'rw'), (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const { name, folder_id } = req.body || {};
  // If folder_id is provided (even null), it's a move operation
  if (folder_id !== undefined || req.body.hasOwnProperty(req.body, 'folder_id')) {
    dbRun('UPDATE files SET folder_id = ? WHERE id = ?', folder_id || null, req.params.id);
    return res.json({ ok: true, moved: true, folder_id: folder_id || null });
  }
  // Otherwise it's a rename
  if (!name) return res.status(400).json({ error: 'Name required' });
  dbRun('UPDATE files SET original_name = ?, filename = ? WHERE id = ?', name, name, req.params.id);
  res.json({ ok: true, name: name });
});

// ── Restore from trash ──
app.patch('/api/files/:id/restore', requireAuth, requireFileProjectMember, requireFileRoom(dbGet, 'rw'), (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!file.trashed) return res.status(400).json({ error: 'File is not in trash' });
  dbRun('UPDATE files SET trashed = 0, trashed_at = NULL WHERE id = ?', req.params.id);
  res.json({ ok: true, restored: true });
});

// ── Photos (server-backed, not localStorage) ──
app.get('/api/projects/:pid/photos', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoom(dbGet, 'photos', 'r'), (req, res) => {
  var photos = dbAll('SELECT id, project_id, original_name, mime_type, size_bytes, created_at, uploaded_by, metadata FROM files WHERE project_id = ? AND type = \'photo\' AND trashed = 0 ORDER BY created_at DESC', req.params.pid);
  res.json({ photos: photos.map(function(p) {
    var meta = {};
    try { if (p.metadata) meta = JSON.parse(p.metadata); } catch(e) {}
    return { id: p.id, project_id: p.project_id, label: meta.label || p.original_name, company: meta.company || '', created_at: p.created_at, uploaded_by: p.uploaded_by || '' };
  }) });
});

app.patch('/api/files/:id/photo-meta', requireAuth, requireFileProjectMember, auth.requireRoom(dbGet, 'photos', 'rw'), (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!file) return res.status(404).json({ error: 'Photo not found' });
  var meta = {};
  try { if (file.metadata) meta = JSON.parse(file.metadata); } catch(e) {}
  if (req.body.label !== undefined) meta.label = req.body.label;
  if (req.body.company !== undefined) meta.company = req.body.company;
  dbRun('UPDATE files SET metadata = ? WHERE id = ?', JSON.stringify(meta), req.params.id);
  res.json({ ok: true, metadata: meta });
});

// ── Punchlist apartments ──
app.get('/api/projects/:pid/punchlist/apartments', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  var pid = req.params.pid;
  // Admins see all apartments that have punchlist items
  if (req.user.role === 'admin') {
    var apartments = dbAll("SELECT DISTINCT pl_apartment as name FROM records WHERE project_id = ? AND category = 'punchlist' AND pl_apartment IS NOT NULL AND pl_apartment != '' ORDER BY pl_apartment", pid);
    return res.json({ apartments: apartments.map(function(r) { return r.name; }) });
  }
  // Company users only see apartments where their company has items
  var memberRow = dbGet('SELECT company_id FROM user_projects WHERE user_id = ? AND project_id = ?', req.user.id, pid);
  if (memberRow && memberRow.company_id) {
    var apartments = dbAll("SELECT DISTINCT pl_apartment as name FROM records WHERE project_id = ? AND category = 'punchlist' AND pl_company = ? AND pl_apartment IS NOT NULL ORDER BY pl_apartment", pid, memberRow.company_id);
    return res.json({ apartments: apartments.map(function(r) { return r.name; }) });
  }
  // No company — show all apartments
  var all = dbAll("SELECT DISTINCT pl_apartment as name FROM records WHERE project_id = ? AND category = 'punchlist' AND pl_apartment IS NOT NULL AND pl_apartment != '' ORDER BY pl_apartment", pid);
  res.json({ apartments: all.map(function(r) { return r.name; }) });
});


app.get('/api/projects/:pid/:cat', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoomFromParams(dbGet, 'r'), (req, res) => {
  const search = (req.query.search || '').toLowerCase().trim();
  const sortBy = req.query.sort || 'newest';
  const page = parseInt(req.query.page) || 0;       // 0 = all (backward compat), >=1 = paginated
  const limit = Math.min(parseInt(req.query.limit) || 50, 200); // max 200 per page
  const statusFilter = (req.query.status || '').toLowerCase().trim();
  const tradeFilter = (req.query.trade || '').toLowerCase().trim();
  const dateFilter = (req.query.date || '').trim();    // daily-logs date filter (YYYY-MM-DD)

  const pid = req.params.pid;
  const cat = req.params.cat;

  // ── Build WHERE clause ──
  var conditions = ['project_id = ?', 'category = ?'];
  var params = [pid, cat];

  // Status filter (punchlist-specific)
  if (statusFilter) {
    conditions.push("json_extract(data, '$.status') = ?");
    params.push(statusFilter);
  }

  // Trade filter (punchlist-specific)
  if (tradeFilter) {
    conditions.push("json_extract(data, '$.trade') = ?");
    params.push(tradeFilter);
  }

  // Date filter (daily-logs: filter by record date)
  if (dateFilter) {
    conditions.push("json_extract(data, '$.date') = ?");
    params.push(dateFilter);
  }

  // Company filtering (punchlist: company users see only their assigned items)
  if (cat === 'punchlist' && req.user.role !== 'admin') {
    var memberRow = dbGet('SELECT company_id FROM user_projects WHERE user_id = ? AND project_id = ?', req.user.id, pid);
    if (memberRow && memberRow.company_id) {
      conditions.push('pl_company = ?');
      params.push(memberRow.company_id);
    }
  }

  // Search across title, location, description (works for any category)
  if (search) {
    var likeStr = '%' + search + '%';
    conditions.push("(json_extract(data, '$.title') LIKE ? OR json_extract(data, '$.location') LIKE ? OR json_extract(data, '$.description') LIKE ? OR CAST(json_extract(data, '$.number') AS TEXT) LIKE ?)");
    params.push(likeStr, likeStr, likeStr, likeStr);
  }

  var whereClause = conditions.join(' AND ');

  // ── ORDER BY ──
  var orderBy;
  switch (sortBy) {
    case 'oldest':   orderBy = "json_extract(data, '$.createdAt') ASC"; break;
    case 'priority': orderBy = "CASE json_extract(data, '$.priority') WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC"; break;
    case 'status':   orderBy = "CASE json_extract(data, '$.status') WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'resolved' THEN 3 WHEN 'verified' THEN 4 ELSE 5 END ASC"; break;
    case 'dueDate':  orderBy = "CASE WHEN json_extract(data, '$.dueDate') IS NULL THEN 1 ELSE 0 END, json_extract(data, '$.dueDate') ASC"; break;
    default:         orderBy = "json_extract(data, '$.createdAt') DESC"; break; // newest
  }

  // ── Count total matching records ──
  var countSql = 'SELECT COUNT(*) as cnt FROM records WHERE ' + whereClause;
  var totalRow = dbGet(countSql, ...params);
  var total = totalRow ? totalRow.cnt : 0;

  // ── Status counts (for stats bar — punchlist-specific, harmless for other cats) ──
  var counts = { all: total, open: 0, in_progress: 0, resolved: 0, verified: 0 };
  try {
    var statusCountSql = "SELECT json_extract(data, '$.status') as st, COUNT(*) as cnt FROM records WHERE " + whereClause + " GROUP BY st";
    var statusRows = dbAll(statusCountSql, ...params);
    statusRows.forEach(function(r) {
      if (counts.hasOwnProperty(r.st)) counts[r.st] = r.cnt;
    });
    // overdue count
    var overdueSql = "SELECT COUNT(*) as cnt FROM records WHERE " + whereClause + " AND json_extract(data, '$.dueDate') IS NOT NULL AND json_extract(data, '$.dueDate') != '' AND json_extract(data, '$.dueDate') < date('now') AND json_extract(data, '$.status') != 'verified'";
    var overdueRow = dbGet(overdueSql, params);
    counts.overdue = overdueRow ? overdueRow.cnt : 0;
  } catch(e) { /* counts are best-effort */ }

  // ── Fetch records ──
  if (page > 0) {
    // Paginated
    var offset = (page - 1) * limit;
    var dataSql = 'SELECT * FROM records WHERE ' + whereClause + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?';
    var pageParams = params.concat([limit, offset]);
    var rows = dbAll(dataSql, ...pageParams);
    var records = rows.map(function(r) { return { ...r, data: parseJSON(r.data) }; });
    res.json({
      records: records,
      total: total,
      page: page,
      pages: Math.ceil(total / limit),
      limit: limit,
      counts: counts
    });
  } else {
    // Return all (backward compatible with modules that don't paginate)
    var dataSql = 'SELECT * FROM records WHERE ' + whereClause + ' ORDER BY ' + orderBy;
    var rows = dbAll(dataSql, ...params);
    var records = rows.map(function(r) { return { ...r, data: parseJSON(r.data) }; });
    res.json({ records: records, total: total, counts: counts });
  }
});

app.get('/api/projects/:pid/:cat/:rid', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoomFromParams(dbGet, 'r'), (req, res) => {
  const record = dbGet('SELECT * FROM records WHERE id = ? AND project_id = ? AND category = ?',
    req.params.rid, req.params.pid, req.params.cat);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  record.data = parseJSON(record.data);
  res.json({ record });
});

app.post('/api/projects/:pid/:cat', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoomFromParams(dbGet, 'rw'), (req, res) => {
  const { data } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data required' });

  // Validate
  var verr = _validateRecord(req.params.cat, data);
  if (verr) return res.status(400).json({ error: verr });

  // Validate assigned company for punchlist items
  if (req.params.cat === 'punchlist' && data.assignedCompanyId) {
    var company = dbGet('SELECT id FROM companies WHERE id = ? AND project_id = ? AND active = 1',
      data.assignedCompanyId, req.params.pid);
    if (!company) return res.status(400).json({ error: 'Invalid or inactive company' });
  }

  const id = data.id || uid();
  const ts = nowISO();
  const recordData = { ...data, id, createdAt: data.createdAt || ts, updatedAt: ts };

  dbRun('INSERT INTO records (id, project_id, category, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, req.params.pid, req.params.cat, JSON.stringify(recordData), ts, ts);

  logAudit('insert', id, req.params.pid, req.params.cat, null, recordData, req.user);

  res.status(201).json({ record: { id, project_id: req.params.pid, category: req.params.cat, data: recordData, created_at: ts, updated_at: ts } });
});

app.put('/api/projects/:pid/:cat/:rid', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoomFromParams(dbGet, 'rw'), (req, res) => {
  const existing = dbGet('SELECT * FROM records WHERE id = ? AND project_id = ? AND category = ?',
    req.params.rid, req.params.pid, req.params.cat);
  if (!existing) return res.status(404).json({ error: 'Record not found' });

  const { data } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data required' });

  var oldData = parseJSON(existing.data);

  // ── Punchlist ownership: company users can only update status on their own items ──
  if (req.params.cat === 'punchlist' && req.user.role !== 'admin') {
    var memberRow = dbGet('SELECT company_id FROM user_projects WHERE user_id = ? AND project_id = ?',
      req.user.id, req.params.pid);
    var userCompany = memberRow ? memberRow.company_id : null;
    if (userCompany && oldData.assignedCompanyId !== userCompany) {
      return res.status(403).json({ error: 'Not your item — you can only update items assigned to your company' });
    }
    // Company users can only change status, not reassign
    if (data.assignedCompanyId !== undefined && data.assignedCompanyId !== oldData.assignedCompanyId) {
      return res.status(403).json({ error: 'Cannot reassign items — only admins can change assignments' });
    }
  }

  // Validate company if reassigning
  if (req.params.cat === 'punchlist' && data.assignedCompanyId && data.assignedCompanyId !== oldData.assignedCompanyId) {
    var company = dbGet('SELECT id FROM companies WHERE id = ? AND project_id = ? AND active = 1',
      data.assignedCompanyId, req.params.pid);
    if (!company) return res.status(400).json({ error: 'Invalid or inactive company' });
  }

  const ts = nowISO();
  const merged = { ...oldData, ...data, id: req.params.rid, updatedAt: ts };

  // Validate merged record
  var verr = _validateRecord(req.params.cat, merged);
  if (verr) return res.status(400).json({ error: verr });

  dbRun('UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND project_id = ? AND category = ?',
    JSON.stringify(merged), ts, req.params.rid, req.params.pid, req.params.cat);

  logAudit('update', req.params.rid, req.params.pid, req.params.cat, parseJSON(existing.data), merged, req.user);

  res.json({ record: { ...existing, data: merged, updated_at: ts } });
});

app.delete('/api/projects/:pid/:cat/:rid', requireAuth, auth.requireProjectMember(dbGet), auth.requireRoomFromParams(dbGet, 'rw'), (req, res) => {
  const existing = dbGet('SELECT id FROM records WHERE id = ? AND project_id = ? AND category = ?',
    req.params.rid, req.params.pid, req.params.cat);
  if (!existing) return res.status(404).json({ error: 'Record not found' });

  var oldRecord = dbGet('SELECT * FROM records WHERE id = ? AND project_id = ? AND category = ?',
    req.params.rid, req.params.pid, req.params.cat);

  dbRun('DELETE FROM records WHERE id = ? AND project_id = ? AND category = ?',
    req.params.rid, req.params.pid, req.params.cat);

  logAudit('delete', req.params.rid, req.params.pid, req.params.cat, oldRecord ? parseJSON(oldRecord.data) : null, null, req.user);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════
 * 6c. ROUTES — People (unified Users + Invites + Members)
 * ═══════════════════════════════════════════════════════════════════ */

// People API → routes/people.js
require('./routes/people')(app, {
  dbGet, dbRun, dbAll, uid, nowISO, safeUser, sendInviteEmail, sendProjectWelcomeEmail,
  crypto: require('./align-crypto'),
  requireAuth, requireAdmin,
  normalizePermissions
});

/* ═══════════════════════════════════════════════════════════════════
 * 10. ROUTES — Files (upload, download, trash)
 * ═══════════════════════════════════════════════════════════════════ */

app.post('/api/files/upload', requireAuth, (req, res) => {
  const ALLOWED_EXTENSIONS = ['pdf','png','jpg','jpeg','gif','doc','docx','xls','xlsx','dwg','rvt','ifc','csv','txt','zip'];
  const projectUpload = multer({ dest: UPLOADS_DIR, limits: { fileSize: Infinity } });
  projectUpload.single('file')(req, res, function(err) {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const projectId = (req.body && req.body.project_id) || null;
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    const uploadType = (req.body && req.body.type) || 'file';
    const roomKey = uploadType === 'photo' ? 'photos' : 'files';
    if (!req.user || req.user.role !== 'admin') {
      const memberRow = dbGet('SELECT role, permissions FROM user_projects WHERE user_id = ? AND project_id = ?', req.user.id, projectId);
      if (!memberRow) { try { fs.unlinkSync(req.file.path); } catch (e) {} return res.status(403).json({ error: 'Not a member of this project' }); }
      var perms = {};
      try { perms = JSON.parse(memberRow.permissions || '{}'); } catch(e) {}
      var filePerm = perms[roomKey] || 'rw';
      if (filePerm === 'none') { try { fs.unlinkSync(req.file.path); } catch (e) {} return res.status(404).json({ error: 'Not found' }); }
      if (filePerm !== 'rw') { try { fs.unlinkSync(req.file.path); } catch (e) {} return res.status(403).json({ error: 'Read-only access for ' + roomKey }); }
    }
    const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) { try { fs.unlinkSync(req.file.path); } catch (e) {} return res.status(400).json({ error: 'File type not allowed' }); }
    let originalName = req.file.originalname || '';
    try {
      const recoded = Buffer.from(originalName, 'latin1').toString('utf8');
      if (recoded && recoded.indexOf('\uFFFD') === -1) originalName = recoded;
    } catch (e) { /* keep as-is */ }
    const projectDir = path.join(UPLOADS_DIR, projectId);
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
    const finalPath = path.join(projectDir, req.file.filename);
    fs.renameSync(req.file.path, finalPath);
    // Generate thumbnail for images and PDFs (best-effort, non-blocking)
    if (req.file.mimetype && req.file.mimetype.startsWith('image/')) {
      sharp(finalPath)
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(finalPath + '.thumb.jpg')
        .catch(function(){});
    } else if (req.file.mimetype === 'application/pdf') {
      (function generatePdfThumb() {
        var tmpBase = finalPath + '.tmpthumb';
        execFile('pdftoppm', ['-f', '1', '-l', '1', '-r', '150', '-png', finalPath, tmpBase], function(err) {
          if (err) return;
          var tmpPng = tmpBase + '-1.png';
          if (!fs.existsSync(tmpPng)) return;
          sharp(tmpPng)
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(finalPath + '.thumb.jpg')
            .then(function() {
              try { fs.unlinkSync(tmpPng); } catch(e) {}
            })
            .catch(function() {
              try { fs.unlinkSync(tmpPng); } catch(e) {}
            });
        });
      })();
    }
    const id = uid(); const ts = nowISO(); const folderId = (req.body && req.body.folder_id) || null;
    const metadata = (req.body && req.body.metadata) || null;
    dbRun('INSERT INTO files (id, project_id, folder_id, type, filename, original_name, mime_type, size_bytes, stored_path, created_at, uploaded_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, projectId, folderId, uploadType, req.file.filename, originalName, req.file.mimetype, req.file.size, finalPath, ts, (req.user && req.user.username) || '', metadata);
    res.status(201).json({ file: { id, project_id: projectId, folder_id: folderId, type: uploadType, original_name: originalName, mime_type: req.file.mimetype, size_bytes: req.file.size, created_at: ts, uploaded_by: (req.user && req.user.username) || '', metadata: metadata } });
  });
});

app.get('/api/files/:id', requireAuth, requireFileProjectMember, requireFileRoom(dbGet, 'r'), (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!fs.existsSync(file.stored_path)) return res.status(404).json({ error: 'File missing from disk' });
  const thumbPath = file.stored_path + '.thumb.jpg';
  if (req.query.thumb === '1' && fs.existsSync(thumbPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline; filename="thumb.jpg"');
    return fs.createReadStream(thumbPath).pipe(res);
  }
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(file.original_name) + '"');
  fs.createReadStream(file.stored_path).pipe(res);
});

app.delete('/api/files/:id', requireAuth, requireFileProjectMember, requireFileRoom(dbGet, 'rw'), (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  dbRun('UPDATE files SET trashed = 1, trashed_at = ? WHERE id = ?', nowISO(), req.params.id);
  res.json({ ok: true, trashed: true });
});

// ── Drawing markups (annotation strokes per drawing) ──
app.get('/api/projects/:pid/drawings/:did/markups', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  const row = dbGet('SELECT data FROM drawing_markups WHERE project_id = ? AND drawing_id = ?', req.params.pid, req.params.did);
  if (!row) return res.json({ strokes: [] });
  try { res.json({ strokes: JSON.parse(row.data) }); } catch(e) { res.json({ strokes: [] }); }
});

app.put('/api/projects/:pid/drawings/:did/markups', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  const data = JSON.stringify((req.body && req.body.strokes) || []);
  dbRun('INSERT OR REPLACE INTO drawing_markups (project_id, drawing_id, data, updated_at) VALUES (?, ?, ?, ?)',
    req.params.pid, req.params.did, data, nowISO());
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════
 * 11. ROUTES — Audit, Admin, Misc
 * ═══════════════════════════════════════════════════════════════════ */

app.post('/api/admin/backup', requireAuth, requireAdmin, (req, res) => {
  const backupPath = path.join(DATA_DIR, 'align.db.backup-' + Date.now());
  fs.copyFileSync(DB_PATH, backupPath);
  res.json({ ok: true, path: backupPath });
});

app.get('/api/audit/:pid', requireAuth, auth.requireProjectAdmin(dbGet), (req, res) => {
  var rows = dbAll('SELECT * FROM audit_log WHERE project_id = ? ORDER BY changed_at DESC LIMIT 500', req.params.pid);
  res.json({ entries: rows });
});

app.get('/api/audit/:pid/record/:rid', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  var rows = dbAll('SELECT * FROM audit_log WHERE record_id = ? ORDER BY changed_at DESC', req.params.rid);
  res.json({ entries: rows });
});

app.post('/api/email/send', requireAuth, (req, res) => {
  const { to, subject, body } = req.body || {};
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, body required' });
  sendEmail(to, subject, body).then(function() { res.json({ ok: true }); }).catch(function(e) { res.status(500).json({ error: e.message }); });
});

app.get('/api/email/log', requireAuth, requireAdmin, (_req, res) => {
  res.json({ log: 'Email log not persisted' });
});

app.get('/api/security/log', requireAuth, requireAdmin, (_req, res) => {
  var rows = dbAll('SELECT * FROM audit_log WHERE category = ? ORDER BY changed_at DESC LIMIT 200', 'security');
  res.json({ entries: rows });
});

app.post('/api/errors/report', (req, res) => {
  try { logError(req.body); } catch(e) {}
  res.json({ ok: true });
});

app.get('/api/weather', function(req, res) {
  // WMO code → short text label
  function _wxLabel(code) {
    if (code === 0) return 'Clear';
    if (code === 1) return 'Mostly Clear';
    if (code === 2) return 'Partly Cloudy';
    if (code === 3) return 'Cloudy';
    if (code >= 45 && code <= 48) return 'Fog';
    if (code >= 51 && code <= 57) return 'Drizzle';
    if (code >= 61 && code <= 67) return 'Rain';
    if (code >= 71 && code <= 77) return 'Snow';
    if (code >= 80 && code <= 82) return 'Showers';
    if (code >= 85 && code <= 86) return 'Snow Showers';
    if (code === 95) return 'Thunderstorm';
    if (code >= 96 && code <= 99) return 'Severe Storm';
    return 'Unknown';
  }

  var lat = parseFloat(req.query.lat) || 40.7128;
  var lon = parseFloat(req.query.lon) || -74.006;

  // ── Open-Meteo (primary) — returns WMO codes as integers, no text parsing ──
  var omUrl = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=' + lat.toFixed(4) +
    '&longitude=' + lon.toFixed(4) +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&hourly=weather_code,temperature_2m,precipitation_probability' +
    '&timezone=auto&forecast_days=7';

  fetch(omUrl, { signal: AbortSignal.timeout(8000) })
    .then(function(r) { if (!r.ok) throw new Error('OM unavailable'); return r.json(); })
    .then(function(data) {
      var dailyTimes = data.daily.time || [];
      var dailyCodes = data.daily.weather_code || [];
      var dailyMax   = data.daily.temperature_2m_max || [];
      var dailyMin   = data.daily.temperature_2m_min || [];
      var hourlyTimes = data.hourly.time || [];
      var hourlyCodes = data.hourly.weather_code || [];
      var hourlyTemps = data.hourly.temperature_2m || [];
      var hourlyPrecip = data.hourly.precipitation_probability || [];

      var daily = [];
      for (var i = 0; i < Math.min(dailyTimes.length, 7); i++) {
        daily.push({
          name: i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : 'Day ' + (i+1)),
          date: dailyTimes[i],
          tempMax: Math.round(dailyMax[i]),
          tempMin: Math.round(dailyMin[i]),
          code: dailyCodes[i] != null ? dailyCodes[i] : 2,
          shortForecast: _wxLabel(dailyCodes[i] != null ? dailyCodes[i] : 2),
          icon: ''
        });
      }

      var now = new Date();
      var hourly = [];
      for (var j = 0; j < hourlyTimes.length; j++) {
        var hTime = new Date(hourlyTimes[j]);
        if (hTime < now) continue; // skip past hours
        hourly.push({
          time: hourlyTimes[j],
          temp: Math.round(hourlyTemps[j]),
          code: hourlyCodes[j] != null ? hourlyCodes[j] : 2,
          precip: hourlyPrecip[j] != null ? hourlyPrecip[j] : 0,
          shortForecast: _wxLabel(hourlyCodes[j] != null ? hourlyCodes[j] : 2),
          icon: ''
        });
      }

      // Get city name from Open-Meteo geocoding
      fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4) + '&zoom=10')
        .then(function(r) { return r.json(); })
        .then(function(geo) {
          var addr = geo.address || {};
          var city = addr.city || addr.town || addr.village || addr.county || addr.state || 'Unknown';
          res.json({ ok: true, daily: daily, hourly: hourly, city: city });
        })
        .catch(function() {
          res.json({ ok: true, daily: daily, hourly: hourly, city: '' });
        });
    })
    .catch(function(omErr) {
      // ── NWS fallback ──────────────────────────────────────────────────────
      console.log('[Weather] Open-Meteo failed (' + (omErr.message || 'timeout') + '), falling back to NWS');
      var nwsUrl = 'https://api.weather.gov/points/' + lat.toFixed(4) + ',' + lon.toFixed(4);
      fetch(nwsUrl, { headers: { 'User-Agent': 'AlignPM/1.0 (alignprojects.net)' } })
        .then(function(r) { if (!r.ok) throw new Error('NWS unavailable'); return r.json(); })
        .then(function(point) {
          var props = point.properties;
          if (!props) throw new Error('No NWS data');
          return Promise.all([
            fetch(props.forecast, { headers: { 'User-Agent': 'AlignPM/1.0' } }).then(function(r) { return r.json(); }),
            fetch(props.forecastHourly, { headers: { 'User-Agent': 'AlignPM/1.0' } }).then(function(r) { return r.json(); })
          ]).then(function(arr) {
            var forecast = arr[0], hourlyData = arr[1];
            var city = props.relativeLocation.properties.city + ', ' + props.relativeLocation.properties.state;

            var periods = (forecast.properties.periods || []).slice(0, 14);
            var daily = [];
            for (var i = 0; i < periods.length; i += 2) {
              var day = periods[i], night = periods[i + 1] || {};
              daily.push({
                name: day.name,
                date: (day.startTime || '').slice(0, 10),
                tempMax: day.temperature,
                tempMin: night.temperature || day.temperature,
                code: 2,
                shortForecast: day.shortForecast || '',
                icon: day.icon || ''
              });
            }

            var hourlyPeriods = (hourlyData.properties.periods || []).slice(0, 24);
            var hourly = hourlyPeriods.map(function(p) {
              return {
                time: p.startTime,
                temp: p.temperature,
                code: 2,
                precip: p.probabilityOfPrecipitation ? p.probabilityOfPrecipitation.value || 0 : 0,
                shortForecast: p.shortForecast || '',
                icon: p.icon || ''
              };
            });

            res.json({ ok: true, daily: daily, hourly: hourly, city: city });
          });
        })
        .catch(function() {
          res.json({
            ok: false, fallback: true,
            daily: [
              { name: 'Today', date: new Date().toISOString().slice(0,10), tempMax: 72, tempMin: 55, code: 2, shortForecast: 'Partly Cloudy' },
              { name: 'Tomorrow', date: new Date(Date.now()+86400000).toISOString().slice(0,10), tempMax: 74, tempMin: 58, code: 0, shortForecast: 'Sunny' }
            ],
            hourly: [],
            city: 'New York, NY'
          });
        });
    });
});

// Punchlist batch update
app.patch('/api/projects/:pid/punchlist/batch', requireAuth, auth.requireProjectMember(dbGet), (req, res) => {
  var body = req.body || {};
  var ids = body.ids, changes = body.changes;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
  if (!changes || typeof changes !== 'object') return res.status(400).json({ error: 'changes object required' });

  // Company users cannot reassign items
  if (req.user.role !== 'admin' && changes.assignedCompanyId !== undefined) {
    return res.status(403).json({ error: 'Cannot reassign items — only admins can change assignments' });
  }

  // Validate new company if admin is reassigning
  if (changes.assignedCompanyId) {
    var co = dbGet('SELECT id FROM companies WHERE id = ? AND project_id = ? AND active = 1',
      changes.assignedCompanyId, req.params.pid);
    if (!co) return res.status(400).json({ error: 'Invalid or inactive company' });
  }

  var ts = nowISO(); var updated = 0; var skipped = 0;
  var memberRow = req.user.role !== 'admin'
    ? dbGet('SELECT company_id FROM user_projects WHERE user_id = ? AND project_id = ?', req.user.id, req.params.pid)
    : null;
  var userCompany = memberRow ? memberRow.company_id : null;

  ids.forEach(function(rid) {
    var existing = dbGet('SELECT * FROM records WHERE id = ? AND project_id = ?', rid, req.params.pid);
    if (!existing) { skipped++; return; }
    var data = JSON.parse(existing.data);

    // Company user can only touch their own company's items
    if (userCompany && data.assignedCompanyId !== userCompany) { skipped++; return; }

    Object.keys(changes).forEach(function(k) { data[k] = changes[k]; });
    dbRun('UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND project_id = ?',
      JSON.stringify(data), ts, rid, req.params.pid);
    updated++;
  });
  res.json({ ok: true, updated: updated, skipped: skipped });
});

/* ------------------------------------------------------------------ *
 * PUNCHLIST ASSIGNMENTS — Phase 1 Core
 * ------------------------------------------------------------------ */

// Prepare statements (once at startup)
const stmtGetRecord      = _db.prepare('SELECT id FROM records WHERE id = ?');
const stmtGetUser        = _db.prepare('SELECT id, name, email FROM users WHERE id = ?');
const stmtInsertAssign   = _db.prepare(`
  INSERT INTO punchlist_assignments (punch_item_id, user_id, assigned_by)
  VALUES (?, ?, ?)
  ON CONFLICT (punch_item_id, user_id) DO NOTHING
`);
const stmtInsertNotif    = _db.prepare(`
  INSERT INTO notifications (punch_item_id, recipient_email, subject, body)
  VALUES (?, ?, ?, ?)
`);
const stmtDeleteAssign   = _db.prepare(
  'DELETE FROM punchlist_assignments WHERE punch_item_id = ? AND user_id = ?'
);
const stmtListAssign     = _db.prepare(`
  SELECT pa.user_id, u.name, u.email, pa.assigned_by, pa.assigned_at
  FROM punchlist_assignments pa
  JOIN users u ON u.id = pa.user_id
  WHERE pa.punch_item_id = ?
  ORDER BY pa.assigned_at
`);

function queueAssignmentNotification(userId, punchItemId, assignedBy) {
  try {
    const user = stmtGetUser.get(userId);
    if (!user || !user.email) return;
    
    const punchItem = stmtGetRecord.get(punchItemId);
    const itemLabel = punchItem ? `#${punchItemId}` : 'item';
    const subject = `Punch Item Assigned: ${itemLabel}`;
    const body = `You've been assigned punch item ${itemLabel}. Please review and update status as needed.`;
    
    stmtInsertNotif.run(punchItemId, user.email, subject, body);
  } catch (err) {
    console.error('[NOTIFY] Queue failed:', err.message);
  }
}

// GET /api/users?companyId=X
app.get('/api/users', (req, res) => {
  const companyId = parseInt(req.query.companyId, 10);
  if (Number.isNaN(companyId)) {
    return res.status(400).json({ error: 'companyId query param is required and must be an integer' });
  }
  const users = _db.prepare(
    'SELECT id, name, email FROM users WHERE company_id = ? ORDER BY name'
  ).all(companyId);
  res.json(users);
});

// POST /api/punchlist/:id/assignments
app.post('/api/punchlist/:id/assignments', (req, res) => {
  const punchItemId = req.params.id;
  if (!punchItemId || typeof punchItemId !== 'string') {
    return res.status(400).json({ error: 'Invalid punch item id' });
  }

  const { userIds, assignedBy } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds must be a non-empty array' });
  }
  if (!Number.isInteger(assignedBy)) {
    return res.status(400).json({ error: 'assignedBy (integer user id) is required' });
  }
  if (!stmtGetRecord.get(punchItemId)) {
    return res.status(404).json({ error: 'Punch item not found' });
  }

  const assignMany = _db.transaction((ids) => {
    const created = [];
    for (const uid of ids) {
      if (!stmtGetUser.get(uid)) throw Object.assign(new Error(`User ${uid} not found`), { status: 404 });
      const info = stmtInsertAssign.run(punchItemId, uid, assignedBy);
      if (info.changes > 0) {
        queueAssignmentNotification(uid, punchItemId, assignedBy);
        created.push(uid);
      }
    }
    return created;
  });

  try {
    const created = assignMany(userIds);
    res.status(201).json({ punchItemId, assignedUserIds: created });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/punchlist/:id/assignments/:userId
app.delete('/api/punchlist/:id/assignments/:userId', (req, res) => {
  const punchItemId = req.params.id;
  const userId = parseInt(req.params.userId, 10);
  if (!punchItemId || Number.isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const info = stmtDeleteAssign.run(punchItemId, userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Assignment not found' });
  res.status(204).end();
});

// GET /api/punchlist/:id/assignments
app.get('/api/punchlist/:id/assignments', (req, res) => {
  const punchItemId = req.params.id;
  if (!punchItemId || typeof punchItemId !== 'string') {
    return res.status(400).json({ error: 'Invalid punch item id' });
  }
  if (!stmtGetRecord.get(punchItemId)) {
    return res.status(404).json({ error: 'Punch item not found' });
  }
  res.json(stmtListAssign.all(punchItemId));
});

// Catch-all: serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Global error handler: never crash on route errors ──
app.use(function(err, req, res, next) {
  if (res.headersSent) return next(err);
  var status = err.status || 500;
  var code = err.code || 'INTERNAL';
  var message = status >= 500 ? 'Internal server error' : (err.message || 'Server error');
  console.error(JSON.stringify({ t: new Date().toISOString(), code: code, err: err.message, path: req.path }));
  res.status(status).json({ error: { code: code, message: message, details: err.details || null } });
});

// Crash-and-restart: systemd restarts us in 5s
process.on('uncaughtException', function(err) {
  console.error('FATAL uncaughtException:', err.message, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', function(reason) {
  console.error('FATAL unhandledRejection:', reason);
  process.exit(1);
});

// ── API v1 alias: both /api/* and /api/v1/* hit the same routes ──
app.use('/api/v1', function(req, res, next) {
  req.url = req.url.replace('/api/v1', '/api');
  next();
});

// Start server
const { processNotifications } = require('./notificationWorker');

// Initialize notification worker scheduler (every 5 minutes)
const NOTIFY_SWEEP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(async () => {
  try {
    const result = await processNotifications(_db);
    if (result.processed > 0) {
      console.log(`[NOTIFY] Sweep: ${result.processed} processed, ${result.sent} sent, ${result.failed} failed`);
    }
  } catch (err) {
    console.error('[NOTIFY] Sweep error:', err.message);
  }
}, NOTIFY_SWEEP_INTERVAL);

// Also run once on startup (after a brief delay to ensure DB is ready)
setTimeout(async () => {
  try {
    const result = await processNotifications(_db);
    console.log('[NOTIFY] Initial sweep complete: ' + JSON.stringify(result));
  } catch (err) {
    console.error('[NOTIFY] Initial sweep error:', err.message);
  }
}, 1000);

app.listen(PORT, () => {
  console.log('[ALIGN] Server running on port ' + PORT);
});




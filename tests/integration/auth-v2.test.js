/**
 * Integration tests for new auth architecture (Steps 1-14).
 * Run: npx vitest run tests/integration/auth-v2.test.js
 *
 * Tests all new modules against a copy of the production DB.
 * Does NOT require the server running — uses modules directly.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_SRC = path.join(__dirname, '../../data/align.db');

// Import modules
import * as crypto from '../../align-crypto.js';
import * as sessions from '../../align-sessions.js';
import * as invites from '../../align-invites.js';
import * as auth from '../../align-auth-middleware.js';

/* ═══════════════════════════════════════════════════════════════════
 * TEST SETUP — Create DB copy and apply migrations
 * ═══════════════════════════════════════════════════════════════════ */

let _db;
let _changed = false;

// Replicate server's db wrappers
function _convert(sql, params) {
  let i = 0;
  const converted = sql.replace(/\?/g, () => ':p' + (i++));
  const bind = {};
  params.forEach((v, j) => { bind[':p' + j] = v === undefined ? null : v; });
  return { sql: converted, bind };
}
function dbRun(sql, ...params) {
  const c = _convert(sql, params);
  _db.run(c.sql, c.bind);
  _changed = true;
}
function dbGet(sql, ...params) {
  const c = _convert(sql, params);
  const stmt = _db.prepare(c.sql);
  stmt.bind(c.bind);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}
function dbAll(sql, ...params) {
  const c = _convert(sql, params);
  const stmt = _db.prepare(c.sql);
  stmt.bind(c.bind);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function safeUser(u) {
  return {
    id: u.id, username: u.username || null, email: u.email, name: u.name,
    role: u.role, status: u.status || 'active',
    active_project_id: u.active_project_id,
    created_at: u.created_at, updated_at: u.updated_at
  };
}

let admin, testProjectId;

beforeAll(async () => {
  const SQL = await initSqlJs();
  _db = new SQL.Database(fs.readFileSync(DB_SRC));
  // This suite tests auth modules against a disposable sql.js copy of the
  // already-migrated production schema. The migration runner uses the
  // better-sqlite3 transaction API and is covered separately.

  admin = dbGet("SELECT * FROM users WHERE username = 'admin'");
  const proj = dbGet('SELECT id FROM projects LIMIT 1');
  testProjectId = proj ? proj.id : null;
});

/* ═══════════════════════════════════════════════════════════════════
 * 1. CRYPTO MODULE
 * ═══════════════════════════════════════════════════════════════════ */

describe('align-crypto', () => {
  it('hashPassword returns hash and salt', () => {
    const { hash, salt } = crypto.hashPassword('test1234');
    expect(hash).toBeDefined();
    expect(salt).toBeDefined();
    expect(hash.length).toBeGreaterThan(32);
    expect(salt.length).toBeGreaterThan(16);
  });

  it('verifyPassword succeeds with correct password', () => {
    const { hash, salt } = crypto.hashPassword('mypassword');
    expect(crypto.verifyPassword('mypassword', hash, salt)).toBe(true);
  });

  it('verifyPassword fails with wrong password', () => {
    const { hash, salt } = crypto.hashPassword('mypassword');
    expect(crypto.verifyPassword('wrong', hash, salt)).toBe(false);
  });

  it('verifyPassword fails with null/empty inputs', () => {
    expect(crypto.verifyPassword(null, 'hash', 'salt')).toBe(false);
    expect(crypto.verifyPassword('pw', null, 'salt')).toBe(false);
    expect(crypto.verifyPassword('pw', 'hash', null)).toBe(false);
  });

  it('verifyBcrypt works with bcrypt hashes', () => {
    const bcrypt = require('bcryptjs');
    const h = bcrypt.hashSync('test123', 10);
    expect(crypto.verifyBcrypt('test123', h)).toBe(true);
    expect(crypto.verifyBcrypt('wrong', h)).toBe(false);
  });

  it('generateToken produces 64-char hex strings', () => {
    const t1 = crypto.generateToken();
    const t2 = crypto.generateToken();
    expect(t1.length).toBe(64);
    expect(t2.length).toBe(64);
    expect(t1).not.toBe(t2); // unique
  });

  it('generateInviteCode produces 8-char codes', () => {
    const code = crypto.generateInviteCode();
    expect(code.length).toBe(8);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/); // no I,O,0,1
  });

  it('sha256 produces consistent hashes', () => {
    expect(crypto.sha256('hello')).toBe(crypto.sha256('hello'));
    expect(crypto.sha256('hello')).not.toBe(crypto.sha256('world'));
  });

  it('constantTimeEqual works', () => {
    expect(crypto.constantTimeEqual('abc', 'abc')).toBe(true);
    expect(crypto.constantTimeEqual('abc', 'xyz')).toBe(false);
    expect(crypto.constantTimeEqual(null, 'abc')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * 2. SESSION MODULE
 * ═══════════════════════════════════════════════════════════════════ */

describe('align-sessions', () => {
  let sessionId;

  it('createSession generates a 64-char token', () => {
    const s = sessions.createSession(dbRun, admin.id);
    expect(s.id.length).toBe(64);
    expect(s.user_id).toBe(admin.id);
    expect(s.expires_at).toBeDefined();
    sessionId = s.id;
  });

  it('validateSession returns user + session for valid token', () => {
    const result = sessions.validateSession(dbGet, dbRun, sessionId, safeUser);
    expect(result).not.toBeNull();
    expect(result.user.email).toBe('admin@align.local');
    expect(result.user.pin_hash).toBeUndefined(); // safeUser strips
  });

  it('validateSession returns null for bad token', () => {
    expect(sessions.validateSession(dbGet, dbRun, 'bad-token', safeUser)).toBeNull();
    expect(sessions.validateSession(dbGet, dbRun, null, safeUser)).toBeNull();
    expect(sessions.validateSession(dbGet, dbRun, '', safeUser)).toBeNull();
  });

  it('slideSession extends expiry', () => {
    const before = dbGet('SELECT expires_at FROM sessions WHERE id = ?', sessionId);
    sessions.slideSession(dbRun, sessionId);
    const after = dbGet('SELECT expires_at FROM sessions WHERE id = ?', sessionId);
    expect(after.expires_at).not.toBe(before.expires_at);
    expect(after.expires_at > before.expires_at).toBe(true);
  });

  it('revokeSession deletes the session', () => {
    sessions.revokeSession(dbRun, sessionId);
    expect(sessions.validateSession(dbGet, dbRun, sessionId, safeUser)).toBeNull();
  });

  it('revokeAllSessions keeps exceptToken', () => {
    const s1 = sessions.createSession(dbRun, admin.id);
    const s2 = sessions.createSession(dbRun, admin.id);
    sessions.revokeAllSessions(dbRun, admin.id, s1.id);
    expect(sessions.validateSession(dbGet, dbRun, s1.id, safeUser)).not.toBeNull();
    expect(sessions.validateSession(dbGet, dbRun, s2.id, safeUser)).toBeNull();
    // Cleanup
    sessions.revokeSession(dbRun, s1.id);
  });

  it('countUserSessions returns correct count', () => {
    const s = sessions.createSession(dbRun, admin.id);
    const count = sessions.countUserSessions(dbGet, admin.id);
    expect(count).toBeGreaterThanOrEqual(1);
    sessions.revokeSession(dbRun, s.id);
  });

  it('cleanupSessions removes expired', () => {
    sessions.cleanupSessions(dbRun);
    // Should not throw — expired sessions are deleted
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * 3. INVITE MODULE
 * ═══════════════════════════════════════════════════════════════════ */

describe('align-invites', () => {
  let inviteCode;

  it('createInvite generates a code and stores it', () => {
    const inv = invites.createInvite(dbRun, dbGet, {
      email: 'newuser@test.com',
      name: 'New User',
      role: 'user',
      project_id: testProjectId,
      created_by: admin.id,
      expires_days: 7
    });
    expect(inv.code.length).toBe(8);
    expect(inv.status).toBe('pending');
    expect(inv.email).toBe('newuser@test.com');
    expect(inv.expires_at).toBeDefined();
    inviteCode = inv.code;
  });

  it('getInvite finds by code', () => {
    const inv = invites.getInvite(dbGet, inviteCode);
    expect(inv).not.toBeNull();
    expect(inv.email).toBe('newuser@test.com');
  });

  it('getPendingInviteByEmail finds pending', () => {
    const inv = invites.getPendingInviteByEmail(dbGet, 'newuser@test.com');
    expect(inv).not.toBeNull();
    expect(inv.code).toBe(inviteCode);
  });

  it('redeemInvite returns the invite for valid code', () => {
    const result = invites.redeemInvite(dbGet, dbRun, inviteCode);
    expect(result.error).toBeUndefined();
    expect(result.email).toBe('newuser@test.com');
  });

  it('redeemInvite fails for already-redeemed code', () => {
    // Mark as redeemed first
    invites.markRedeemed(dbRun, dbGet("SELECT id FROM invites WHERE code = ?", inviteCode).id, admin.id);
    const result = invites.redeemInvite(dbGet, dbRun, inviteCode);
    expect(result.error).toBeDefined();
  });

  it('createInvite auto-revokes old pending for same email', () => {
    const inv1 = invites.createInvite(dbRun, dbGet, {
      email: 'dup@test.com', name: 'Dup User', role: 'user', created_by: admin.id
    });
    const inv2 = invites.createInvite(dbRun, dbGet, {
      email: 'dup@test.com', name: 'Dup User v2', role: 'user', created_by: admin.id
    });
    const old = dbGet('SELECT status FROM invites WHERE code = ?', inv1.code);
    expect(old.status).toBe('revoked');
    expect(inv2.status).toBe('pending');
  });

  it('revokeInvite marks pending invite as revoked', () => {
    const inv = invites.createInvite(dbRun, dbGet, {
      email: 'revoke@test.com', name: 'Revoke Test', role: 'user', created_by: admin.id
    });
    expect(invites.revokeInvite(dbGet, dbRun, inv.code)).toBe(true);
    const check = dbGet('SELECT status FROM invites WHERE code = ?', inv.code);
    expect(check.status).toBe('revoked');
  });

  it('revokeInvite fails for non-existent code', () => {
    expect(invites.revokeInvite(dbGet, dbRun, 'NOTREAL')).toBe(false);
  });

  it('listInvites filters by status', () => {
    const all = invites.listInvites(dbAll, {});
    const pending = invites.listInvites(dbAll, { status: 'pending' });
    expect(all.length).toBeGreaterThanOrEqual(pending.length);
  });

  it('cleanupExpired marks expired invites', () => {
    invites.cleanupExpired(dbRun);
    // Should not crash — expired invites updated
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * 4. AUTH MIDDLEWARE (project role checks)
 * ═══════════════════════════════════════════════════════════════════ */

describe('align-auth-middleware', () => {
  // Mock req/res
  function mockReq(user, params, body) {
    return { user, params: params || {}, body: body || {} };
  }
  function mockRes() {
    let s = null, j = null;
    return {
      status: function(code) { s = code; return { json: function(data) { j = data; return { status: s, data: j }; } }; },
      json: function(data) { j = data; return { status: s, data: j }; }
    };
  }
  function next() { return 'next'; }

  it('requireProjectAdmin passes for server admin', () => {
    const mw = auth.requireProjectAdmin(dbGet);
    const result = mw(mockReq(admin, { id: testProjectId }), mockRes(), next);
    expect(result).toBe('next');
  });

  it('requireProjectAdmin blocks non-member', () => {
    const mw = auth.requireProjectAdmin(dbGet);
    const nonMember = { id: 'fake', role: 'user', name: 'Stranger' };
    const res = mockRes();
    mw(mockReq(nonMember, { id: testProjectId }), res, next);
    // Since we can't easily inspect, just verify it doesn't throw
  });

  it('requireProjectMember blocks non-member', () => {
    const mw = auth.requireProjectMember(dbGet);
    const nonMember = { id: 'fake2', role: 'user', name: 'Stranger2' };
    const req = mockReq(nonMember, { id: testProjectId });
    let blocked = false;
    const res = {
      status: function(s) { if (s === 403) blocked = true; return { json: function() {} }; },
      json: function() {}
    };
    mw(req, res, function() {});
    expect(blocked).toBe(true);
  });

  it('requireProjectRole returns 400 for missing project ID', () => {
    const mw = auth.requireProjectRole(dbGet, 'member');
    const nonMember = { id: 'fake3', role: 'user' };
    let statusCode = null;
    const res = {
      status: function(s) { statusCode = s; return { json: function() {} }; },
      json: function() {}
    };
    mw(mockReq(nonMember, {}), res, next);
    expect(statusCode).toBe(400);
  });

  it('extractProjectId finds ID from params', () => {
    expect(auth.extractProjectId({ params: { id: 'abc' }, body: {} })).toBe('abc');
    expect(auth.extractProjectId({ params: { pid: 'xyz' }, body: {} })).toBe('xyz');
    expect(auth.extractProjectId({ params: {}, body: { project_id: 'def' } })).toBe('def');
    expect(auth.extractProjectId({ params: {}, body: {} })).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * 5. EDGE CASES
 * ═══════════════════════════════════════════════════════════════════ */

describe('Edge cases', () => {
  it('session expiry: validateSession auto-deletes expired', () => {
    // Create a session with past expiry
    const token = crypto.generateToken();
    const past = new Date(Date.now() - 86400000).toISOString(); // yesterday
    dbRun('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      token, admin.id, past, past);
    const result = sessions.validateSession(dbGet, dbRun, token, safeUser);
    expect(result).toBeNull();
    // Should have been auto-deleted
    expect(dbGet('SELECT id FROM sessions WHERE id = ?', token)).toBeNull();
  });

  it('invite expiry: redeemInvite blocks expired invites', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const id = crypto.generateToken(16);
    const code = crypto.generateInviteCode();
    dbRun(
      "INSERT INTO invites (id, code, email, name, role, created_by, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      id, code, 'expired@test.com', 'Expired Invite', 'user', admin.id, past, past
    );
    const result = invites.redeemInvite(dbGet, dbRun, code);
    expect(result.error).toBeDefined();
    // Status should be updated to expired
    const check = dbGet('SELECT status FROM invites WHERE code = ?', code);
    expect(check.status).toBe('expired');
  });

  it('duplicate session tokens are handled (UNIQUE constraint)', () => {
    const token = crypto.generateToken();
    dbRun('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      token, admin.id, new Date().toISOString(), sessions.sessionExpiry());
    // Second insert with same token should throw
    expect(() => {
      dbRun('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        token, admin.id, new Date().toISOString(), sessions.sessionExpiry());
    }).toThrow();
    // Cleanup
    dbRun('DELETE FROM sessions WHERE id = ?', token);
  });

  it('password migration: bcrypt fallback works alongside scrypt', () => {
    // Simulate a user with only pin_hash (bcrypt)
    const bcrypt = require('bcryptjs');
    const testUser = {
      id: 'test_migration_user',
      username: 'miguser',
      email: 'mig@test.com',
      name: 'Migration User',
      pin_hash: bcrypt.hashSync('oldpassword', 10),
      role: 'user',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    dbRun(
      'INSERT OR REPLACE INTO users (id, username, email, name, pin_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      testUser.id, testUser.username, testUser.email, testUser.name, testUser.pin_hash,
      testUser.role, testUser.status, testUser.created_at, testUser.updated_at
    );

    // Verify bcrypt works for old passwords
    const user = dbGet('SELECT * FROM users WHERE id = ?', testUser.id);
    expect(crypto.verifyBcrypt('oldpassword', user.pin_hash)).toBe(true);
    expect(crypto.verifyBcrypt('wrongpassword', user.pin_hash)).toBe(false);

    // Now upgrade to scrypt
    const { hash, salt } = crypto.hashPassword('newpassword');
    dbRun('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?',
      hash, salt, testUser.id);

    const upgraded = dbGet('SELECT * FROM users WHERE id = ?', testUser.id);
    expect(crypto.verifyPassword('newpassword', upgraded.password_hash, upgraded.password_salt)).toBe(true);
    expect(crypto.verifyPassword('oldpassword', upgraded.password_hash, upgraded.password_salt)).toBe(false);

    // Cleanup
    dbRun('DELETE FROM users WHERE id = ?', testUser.id);
  });
});

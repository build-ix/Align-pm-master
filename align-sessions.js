/*
 * align-sessions.js — Session lifecycle module for Align PM
 * ==========================================================
 * Creates, validates, slides, revokes, and cleans up sessions.
 * Uses align-crypto.js for secure token generation (256-bit random).
 *
 * Design
 * ------
 * Every function takes dbRun/dbGet/dbAll as its first arguments.
 * These are the server's SQLite wrapper functions (handle _changed flag,
 * ? → :pN conversion, and rest-param spread). The module is database-agnostic
 * beyond needing those three function signatures:
 *
 *   dbRun(sql, ...params)  — execute INSERT/UPDATE/DELETE
 *   dbGet(sql, ...params)  — fetch single row or null
 *   dbAll(sql, ...params)  — fetch all matching rows
 *
 * CONSTANTS
 *   SESSION_DAYS = 30  — sessions live 30 days from creation or last slide
 */

const { generateToken } = require('./align-crypto');

const SESSION_DAYS = 30;

/* ═══════════════════════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════════════════════ */

function sessionExpiry(days = SESSION_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function nowISO() {
  return new Date().toISOString();
}

/* ═══════════════════════════════════════════════════════════════════
 * CREATE
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Create a new session for a user.
 * Returns the full session row { id, user_id, created_at, expires_at }.
 * The session token is a 64-char hex string (256-bit random).
 */
function createSession(dbRun, userId) {
  const id = generateToken();
  const now = nowISO();
  const expires = sessionExpiry();
  dbRun(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    id, userId, now, expires
  );
  return { id, user_id: userId, created_at: now, expires_at: expires };
}

/* ═══════════════════════════════════════════════════════════════════
 * VALIDATE
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Validate a session token.
 * Returns { user, session } if valid, null if expired/invalid.
 * Automatically deletes expired sessions from the database.
 *
 * The `safeUser` function is optional — if provided, user objects are
 * passed through it before being returned (strips sensitive fields).
 */
function validateSession(dbGet, dbRun, token, safeUser) {
  if (!token || typeof token !== 'string') return null;

  const session = dbGet('SELECT * FROM sessions WHERE id = ?', token);
  if (!session) return null;

  // Check expiry
  if (session.expires_at && session.expires_at < nowISO()) {
    dbRun('DELETE FROM sessions WHERE id = ?', token);
    return null;
  }

  const user = dbGet('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user) {
    dbRun('DELETE FROM sessions WHERE id = ?', token);
    return null;
  }

  return {
    user: safeUser ? safeUser(user) : user,
    session: { id: session.id, user_id: session.user_id,
               created_at: session.created_at, expires_at: session.expires_at }
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * SLIDE
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Extend a session's expiry (keep-alive on activity).
 * Returns the new expires_at, or null if session not found.
 */
function slideSession(dbRun, token, days = SESSION_DAYS) {
  const expires = sessionExpiry(days);
  dbRun('UPDATE sessions SET expires_at = ? WHERE id = ?', expires, token);
  return expires;
}

/* ═══════════════════════════════════════════════════════════════════
 * REVOKE
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Revoke a single session by token.
 */
function revokeSession(dbRun, token) {
  dbRun('DELETE FROM sessions WHERE id = ?', token);
}

/**
 * Revoke all sessions for a user, optionally keeping one (the current).
 * Used for "sign out everywhere" and admin user-disabling.
 */
function revokeAllSessions(dbRun, userId, exceptToken) {
  if (exceptToken) {
    dbRun('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, exceptToken);
  } else {
    dbRun('DELETE FROM sessions WHERE user_id = ?', userId);
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * CLEANUP
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Delete all expired sessions. Call periodically (hourly recommended).
 * Returns the number of sessions deleted.
 */
function cleanupSessions(dbRun) {
  dbRun('DELETE FROM sessions WHERE expires_at < ?', nowISO());
}

/**
 * Count active sessions for a user.
 */
function countUserSessions(dbGet, userId) {
  const row = dbGet(
    'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND expires_at > ?',
    userId, nowISO()
  );
  return row ? row.count : 0;
}

/* ═══════════════════════════════════════════════════════════════════
 * EXPORTS
 * ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  createSession,
  validateSession,
  slideSession,
  revokeSession,
  revokeAllSessions,
  cleanupSessions,
  countUserSessions,
  sessionExpiry,
  SESSION_DAYS,
};

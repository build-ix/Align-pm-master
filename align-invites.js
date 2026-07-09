/*
 * align-invites.js — Invite lifecycle module for Align PM
 * ========================================================
 * Creates, redeems, revokes, and lists invites.
 * Uses the standalone `invites` table (migration v7).
 *
 * Design
 * ------
 * Invites are separate from users. An invite is created first;
 * a user account is only created when the invite is redeemed.
 * This clean separation supports:
 *   - Revoking invites before they're used
 *   - Invite expiry (optional per-invite TTL)
 *   - Audit trail (pending → redeemed / revoked / expired)
 *   - Resending invites without creating duplicate user records
 *
 * Invite codes are 8-char human-friendly (from align-crypto.js).
 */

const { generateToken, generateInviteCode } = require('./align-crypto');

/* ═══════════════════════════════════════════════════════════════════
 * CREATE
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Create a new invite. Returns the full invite row.
 *
 * If a pending invite already exists for this email, it is auto-revoked
 * before creating the new one (one pending invite per email).
 *
 * @param {Function} dbRun  — server's dbRun wrapper
 * @param {Function} dbGet  — server's dbGet wrapper
 * @param {Object}   opts
 * @param {string}   opts.email        — invitee email (required)
 * @param {string}   opts.name         — invitee display name (required)
 * @param {string}   opts.role         — 'user' | 'admin' (default 'user')
 * @param {string}   opts.project_id   — target project (optional)
 * @param {string}   opts.project_role — role in project (default 'member')
 * @param {string}   opts.created_by   — user ID of the admin creating this
 * @param {number}   opts.expires_days — TTL in days (optional, no expiry if unset)
 */
function createInvite(dbRun, dbGet, opts) {
  const email = (opts.email || '').toLowerCase().trim();
  const name  = (opts.name  || '').trim();
  if (!email || !name) throw new Error('email and name are required');
  if (!opts.created_by) throw new Error('created_by is required');

  // Auto-revoke any existing pending invite for this email
  const existing = dbGet(
    "SELECT id FROM invites WHERE email = ? AND status = 'pending'", email
  );
  if (existing) {
    dbRun("UPDATE invites SET status = 'revoked' WHERE id = ?", existing.id);
  }

  const id      = generateToken(16);  // 32-char hex internal ID
  const code    = generateInviteCode(); // 8-char human-friendly
  const now     = new Date().toISOString();
  const expires = opts.expires_days
    ? new Date(Date.now() + opts.expires_days * 86400000).toISOString()
    : null;

  dbRun(
    `INSERT INTO invites (id, code, email, name, role, project_id, project_role,
       created_by, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, code, email, name, opts.role || 'user',
    opts.project_id || null, opts.project_role || 'member',
    opts.created_by, now, expires
  );

  return dbGet('SELECT * FROM invites WHERE id = ?', id);
}

/* ═══════════════════════════════════════════════════════════════════
 * REDEEM
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Redeem an invite. Marks it as redeemed and records who used it.
 * Returns the updated invite, or null if not found / already used / expired.
 *
 * The CALLER is responsible for creating the user account after
 * successful redemption.
 *
 * @returns {Object|null} invite row, or null with a reason in the return shape
 */
function redeemInvite(dbGet, dbRun, code) {
  if (!code) return { error: 'Invite code required' };

  const invite = dbGet("SELECT * FROM invites WHERE code = ? AND status = 'pending'", code.toUpperCase().trim());
  if (!invite) return { error: 'Invalid or already used invite code' };

  // Check expiry
  if (invite.expires_at && invite.expires_at < new Date().toISOString()) {
    dbRun("UPDATE invites SET status = 'expired' WHERE id = ?", invite.id);
    return { error: 'This invite has expired' };
  }

  return invite; // caller redeems by setting used_by + status
}

/**
 * Mark an invite as redeemed by a specific user.
 */
function markRedeemed(dbRun, inviteId, userId) {
  const now = new Date().toISOString();
  dbRun(
    "UPDATE invites SET status = 'redeemed', used_by = ?, redeemed_at = ? WHERE id = ?",
    userId, now, inviteId
  );
  return { redeemed: true };
}

/* ═══════════════════════════════════════════════════════════════════
 * REVOKE
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Revoke a pending invite by code.
 * Returns true if revoked, false if not found or already used.
 */
function revokeInvite(dbGet, dbRun, code) {
  const invite = dbGet("SELECT * FROM invites WHERE code = ?", code.toUpperCase().trim());
  if (!invite) return false;
  if (invite.status !== 'pending') return false;

  dbRun("UPDATE invites SET status = 'revoked' WHERE id = ?", invite.id);
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
 * QUERY
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Get a single invite by code.
 */
function getInvite(dbGet, code) {
  if (!code) return null;
  return dbGet('SELECT * FROM invites WHERE code = ?', code.toUpperCase().trim());
}

/**
 * Get a pending invite by email (for checking if one already exists).
 */
function getPendingInviteByEmail(dbGet, email) {
  if (!email) return null;
  return dbGet(
    "SELECT * FROM invites WHERE email = ? AND status = 'pending'",
    email.toLowerCase().trim()
  );
}

/**
 * List invites with optional filters.
 */
function listInvites(dbAll, filters) {
  filters = filters || {};
  const conditions = [];
  const params = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.project_id) {
    conditions.push('project_id = ?');
    params.push(filters.project_id);
  }
  if (filters.created_by) {
    conditions.push('created_by = ?');
    params.push(filters.created_by);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  return dbAll('SELECT * FROM invites ' + where + ' ORDER BY created_at DESC', ...params);
}

/* ═══════════════════════════════════════════════════════════════════
 * CLEANUP
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Mark all expired pending invites as 'expired'.
 * Call periodically (hourly recommended).
 */
function cleanupExpired(dbRun) {
  dbRun(
    "UPDATE invites SET status = 'expired' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?",
    new Date().toISOString()
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * EXPORTS
 * ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  createInvite,
  redeemInvite,
  markRedeemed,
  revokeInvite,
  getInvite,
  getPendingInviteByEmail,
  listInvites,
  cleanupExpired,
};

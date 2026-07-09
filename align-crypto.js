/*
 * align-crypto.js — Cryptographic helpers for Align PM
 * =====================================================
 * Uses Node.js built-in crypto module. Zero native addons.
 *
 * Passwords:    scrypt (OWASP-recommended parameters)
 * Tokens:       crypto.randomBytes (256-bit)
 * Invite codes: 8-char human-friendly (no I/O/0/1)
 * Comparison:   constant-time via SHA-256 → timingSafeEqual
 *
 * Legacy support: verifyBcrypt() for existing pin_hash logins
 *                  during migration from bcrypt to scrypt.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/* ═══════════════════════════════════════════════════════════════════
 * CONSTANTS (OWASP 2025 recommendations for scrypt)
 * ═══════════════════════════════════════════════════════════════════ */

const SCRYPT_KEYLEN = 64;   // 512-bit derived key
const SCRYPT_N      = 16384; // CPU/memory cost (2^14 — OWASP minimum)
const SCRYPT_R      = 8;    // block size
const SCRYPT_P      = 1;    // parallelism
const SALT_LENGTH   = 32;   // 256-bit salt
const TOKEN_LENGTH  = 32;   // 256-bit tokens (sessions, invites, API keys)
const SCRYPT_MAXMEM = 128 * 16384 * 8 * 2; // ~33.5 MB (N*r*p*128, 2x safety margin)

/* ═══════════════════════════════════════════════════════════════════
 * PASSWORD HASHING (scrypt)
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Hash a password with scrypt + random salt.
 * Returns { hash, salt } — both hex-encoded.
 * Store both in the database.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM
  }).toString('hex');
  return { hash, salt };
}

/**
 * Verify a password against a stored scrypt hash.
 * Constant-time via timingSafeEqual.
 */
function verifyPassword(password, storedHash, storedSalt) {
  if (!password || !storedHash || !storedSalt) return false;
  try {
    const derived = crypto.scryptSync(password, storedSalt, SCRYPT_KEYLEN, {
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM
    });
    const expected = Buffer.from(storedHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch (e) {
    return false;
  }
}

/**
 * Legacy bcrypt verification — for existing pin_hash logins
 * during migration. Once all users are on scrypt, this can be removed.
 */
function verifyBcrypt(password, bcryptHash) {
  if (!password || !bcryptHash) return false;
  try {
    return bcrypt.compareSync(password, bcryptHash);
  } catch (e) {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * TOKENS & CODES
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Generate a cryptographically secure random token.
 * Default: 256-bit (32 bytes) → 64-char hex string.
 * Use for: session tokens, API keys, password reset tokens.
 */
function generateToken(bytes = TOKEN_LENGTH) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generate a human-friendly invite code.
 * 8 characters, uppercase alphanumeric.
 * Excludes I, O, 0, 1 to avoid confusion.
 * ~1 billion possible codes — sufficient for invite use.
 */
function generateInviteCode() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CHARS[bytes[i] % CHARS.length];
  }
  return code;
}

/* ═══════════════════════════════════════════════════════════════════
 * HASHING
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * SHA-256 hash. Returns hex string.
 * Use for: token hashing (store hash, not raw token), integrity checks.
 */
function sha256(data) {
  return crypto.createHash('sha256').update(String(data)).digest('hex');
}

/* ═══════════════════════════════════════════════════════════════════
 * CONSTANT-TIME COMPARISON
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Compare two strings in constant time.
 * Both inputs are SHA-256 hashed first to normalize length,
 * then compared with timingSafeEqual.
 *
 * Use for: token verification, invite code checking,
 * any situation where timing attacks are a concern.
 */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/* ═══════════════════════════════════════════════════════════════════
 * EXPORTS
 * ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  // Password
  hashPassword,
  verifyPassword,
  verifyBcrypt,

  // Tokens
  generateToken,
  generateInviteCode,

  // Hashing
  sha256,

  // Comparison
  constantTimeEqual,

  // Constants (exported for testing / configuration)
  SCRYPT_KEYLEN,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  SCRYPT_MAXMEM,
  SALT_LENGTH,
  TOKEN_LENGTH,
};

/**
 * Unit tests for Align pure functions.
 * Run: npx vitest run tests/unit/
 * No server needed — these test standalone logic.
 */
import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Replicate pure functions from server.js for testing (no dependencies)
// ═══════════════════════════════════════════════════════════════════════════

// --- uid() ---
import crypto from 'crypto';
function uid() {
  return 'a_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// --- nowISO() ---
function nowISO() {
  return new Date().toISOString();
}

// --- esc (HTML escaping) ---
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- safeUser projection ---
function safeUser(u) {
  return {
    id: u.id,
    username: u.username || null,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status || 'active',
    active_project_id: u.active_project_id,
    created_at: u.created_at,
    updated_at: u.updated_at
  };
}

// --- _validateRecord (category-specific validation) ---
function _validateRecord(cat, data) {
  if (!data || typeof data !== 'object') return 'Invalid record data';
  if (!data.title && cat === 'punchlist') return 'Punchlist item requires a title';
  if (!data.title && cat === 'tasks') return 'Task requires a title';
  if (cat === 'punchlist') {
    var validStatuses = ['open', 'in_progress', 'resolved', 'verified'];
    if (data.status && validStatuses.indexOf(data.status) === -1) return 'Invalid status: ' + data.status;
    var validPriorities = ['low', 'medium', 'high', 'critical'];
    if (data.priority && validPriorities.indexOf(data.priority) === -1) return 'Invalid priority: ' + data.priority;
  }
  if (cat === 'daily-logs' && !data.date) return 'Daily log requires a date';
  return null; // valid
}

// --- sessionExpiry ---
function sessionExpiry(days) {
  var d = new Date();
  d.setDate(d.getDate() + (days || 30));
  return d.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('uid()', () => {
  it('generates a string starting with a_', () => {
    const id = uid();
    expect(id).toMatch(/^a_[a-z0-9]+$/);
  });

  it('generates unique IDs on successive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(uid());
    expect(ids.size).toBe(100);
  });

  it('is at least 15 characters long', () => {
    expect(uid().length).toBeGreaterThanOrEqual(15);
  });
});

describe('nowISO()', () => {
  it('returns a valid ISO 8601 string', () => {
    const iso = nowISO();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns current time (within 1 second)', () => {
    const before = Date.now();
    const iso = nowISO();
    const after = Date.now();
    const parsed = new Date(iso).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
  });
});

describe('esc() — HTML escaping', () => {
  it('escapes & to &amp;', () => {
    expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('escapes < and >', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes double quotes', () => {
    expect(esc('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('handles null/undefined safely', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc('')).toBe('');
  });

  it('passes normal text through unchanged', () => {
    expect(esc('Hello World 123')).toBe('Hello World 123');
  });
});

describe('safeUser()', () => {
  it('returns only allowed fields', () => {
    const fullUser = {
      id: 'u1', username: 'alfredo', email: 'alfredo@test.com',
      name: 'Alfredo', role: 'admin', status: 'active',
      active_project_id: 'p1', created_at: '2026-01-01', updated_at: '2026-06-01',
      pin_hash: 'SECRET_SHOULD_NOT_LEAK',
      invite_token: 'TOKEN_SHOULD_NOT_LEAK',
      failed_attempts: 5,
      locked_until: '2026-07-01'
    };
    const safe = safeUser(fullUser);
    expect(safe.pin_hash).toBeUndefined();
    expect(safe.invite_token).toBeUndefined();
    expect(safe.failed_attempts).toBeUndefined();
    expect(safe.locked_until).toBeUndefined();
  });

  it('preserves all allowed fields', () => {
    const user = {
      id: 'u1', username: 'test', email: 'test@test.com',
      name: 'Test', role: 'user', status: 'invited',
      active_project_id: null, created_at: 'now', updated_at: 'now'
    };
    const safe = safeUser(user);
    expect(safe.id).toBe('u1');
    expect(safe.email).toBe('test@test.com');
    expect(safe.role).toBe('user');
    expect(safe.status).toBe('invited');
  });

  it('defaults status to active if missing', () => {
    const user = { id: 'u1', email: 'x@x.com', name: 'X', role: 'user',
      active_project_id: null, created_at: 'now', updated_at: 'now' };
    expect(safeUser(user).status).toBe('active');
  });
});

describe('_validateRecord()', () => {
  it('rejects null/undefined data', () => {
    expect(_validateRecord('punchlist', null)).toBe('Invalid record data');
    expect(_validateRecord('punchlist', undefined)).toBe('Invalid record data');
    expect(_validateRecord('punchlist', 'string')).toBe('Invalid record data');
  });

  it('requires title for punchlist', () => {
    expect(_validateRecord('punchlist', { description: 'no title' })).toBe('Punchlist item requires a title');
    expect(_validateRecord('punchlist', { title: 'Fix crack' })).toBeNull();
  });

  it('requires title for tasks', () => {
    expect(_validateRecord('tasks', { description: 'no title' })).toBe('Task requires a title');
    expect(_validateRecord('tasks', { title: 'Review PR' })).toBeNull();
  });

  it('validates punchlist status values', () => {
    expect(_validateRecord('punchlist', { title: 'x', status: 'open' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', status: 'in_progress' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', status: 'resolved' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', status: 'verified' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', status: 'invalid' })).toBe('Invalid status: invalid');
  });

  it('validates punchlist priority values', () => {
    expect(_validateRecord('punchlist', { title: 'x', priority: 'critical' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', priority: 'high' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', priority: 'medium' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', priority: 'low' })).toBeNull();
    expect(_validateRecord('punchlist', { title: 'x', priority: 'extreme' })).toBe('Invalid priority: extreme');
  });

  it('requires date for daily-logs', () => {
    expect(_validateRecord('daily-logs', { title: 'Monday' })).toBe('Daily log requires a date');
    expect(_validateRecord('daily-logs', { title: 'Monday', date: '2026-06-29' })).toBeNull();
  });

  it('accepts any data for non-validated categories', () => {
    expect(_validateRecord('contacts', { name: 'John' })).toBeNull();
    expect(_validateRecord('files', {})).toBeNull();
  });
});

describe('sessionExpiry()', () => {
  it('returns a date 30 days in the future by default', () => {
    const now = new Date();
    const expiry = new Date(sessionExpiry());
    const diffMs = expiry.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29.9);
    expect(diffDays).toBeLessThan(30.1);
  });

  it('accepts custom day count', () => {
    const now = new Date();
    const expiry = new Date(sessionExpiry(7));
    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });

  it('returns valid ISO string', () => {
    expect(sessionExpiry()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

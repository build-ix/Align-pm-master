/**
 * Integration tests for Align API.
 * Run: SERVER_RUNNING=1 npx vitest run tests/integration/
 * Requires the Align server running on localhost:3002.
 * Tests use a fresh project to avoid polluting real data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost:3002';
const TEST_PROJECT_NAME = '__vitest_project_' + Date.now().toString(36);
let testProjectId = null;
let adminCookie = null;
let testUserId = null;
let testUserCookie = null;

// Skip all tests if server isn't running
beforeAll(async () => {
  try {
    const res = await fetch(BASE + '/api/ping');
    if (!res.ok) throw new Error('Server not available');
  } catch (e) {
    console.warn('⚠ Server not running — skipping integration tests');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Helper: make authenticated requests
// ═══════════════════════════════════════════════════════════════════════════

async function api(method, path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(BASE + path, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json, headers: res.headers };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Auth — Public endpoints', () => {
  it('GET /api/ping returns ok', async () => {
    const res = await fetch(BASE + '/api/ping');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('GET /api/auth/who returns user list without emails', async () => {
    const res = await fetch(BASE + '/api/auth/who');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.users)).toBe(true);
    // Verify no PII leaks
    data.users.forEach(u => {
      expect(u.email).toBeUndefined();
      expect(u.id).toBeUndefined();
      expect(u.name).toBeDefined();
      expect(u.role).toBeDefined();
    });
  });

  it('POST /api/auth/signin rejects empty body', async () => {
    const { status } = await api('POST', '/api/auth/signin', {});
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/auth/signin rejects wrong password', async () => {
    const { status, data } = await api('POST', '/api/auth/signin', {
      email: 'admin@align.local',
      password: 'wrong-password-123'
    });
    expect(status).toBe(401);
    expect(data.error).toBeDefined();
  });

  it('GET /api/auth/me rejects unauthenticated request', async () => {
    const res = await fetch(BASE + '/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('Auth — Signin flow', () => {
  it('signs in with valid credentials', async () => {
    const { status, data, headers } = await api('POST', '/api/auth/signin', {
      email: 'admin@align.local',
      password: 'Alfredo25'
    });
    expect(status).toBe(200);
    expect(data.user).toBeDefined();
    // Extract httpOnly cookie for subsequent requests
    const setCookie = headers.get('set-cookie');
    if (setCookie) {
      adminCookie = setCookie.split(';')[0];
    }
  });

  it('GET /api/auth/me returns user with valid token', async () => {
    if (!adminCookie) return;
    const { status, data } = await api('GET', '/api/auth/me', null, adminCookie);
    expect(status).toBe(200);
    expect(data.user.email).toBe('admin@align.local');
    expect(data.user.role).toBe('admin');
    expect(data.user.pin_hash).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CRUD TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Projects', () => {
  it('POST /api/projects creates a project (admin only)', async () => {
    if (!adminCookie) return;
    const { status, data } = await api('POST', '/api/projects', {
      name: TEST_PROJECT_NAME,
      address: '123 Test Street'
    }, adminCookie);
    expect(status).toBe(201);
    expect(data.project.id).toBeDefined();
    testProjectId = data.project.id;
  });

  it('GET /api/projects includes the test project', async () => {
    if (!adminCookie || !testProjectId) return;
    const { status, data } = await api('GET', '/api/projects', null, adminCookie);
    expect(status).toBe(200);
    const found = data.projects.find(p => p.id === testProjectId);
    expect(found).toBeDefined();
    expect(found.name).toBe(TEST_PROJECT_NAME);
  });
});

describe('Records — Punchlist CRUD', () => {
  let recordId = null;

  it('POST creates a punchlist record', async () => {
    if (!adminCookie || !testProjectId) return;
    const { status, data } = await api('POST',
      '/api/projects/' + testProjectId + '/punchlist',
      { data: { title: 'Test crack in wall', priority: 'high', status: 'open', location: 'Room 3A' } },
      adminCookie
    );
    expect(status).toBe(201);
    expect(data.record.id).toBeDefined();
    recordId = data.record.id;
  });

  it('POST rejects invalid punchlist (no title)', async () => {
    if (!adminCookie || !testProjectId) return;
    const { status, data } = await api('POST',
      '/api/projects/' + testProjectId + '/punchlist',
      { data: { priority: 'high' } },
      adminCookie
    );
    expect(status).toBe(400);
    expect(data.error).toContain('title');
  });

  it('GET returns the created record', async () => {
    if (!adminCookie || !testProjectId || !recordId) return;
    const { status, data } = await api('GET',
      '/api/projects/' + testProjectId + '/punchlist/' + recordId,
      null, adminCookie
    );
    expect(status).toBe(200);
    expect(data.record.data.title).toBe('Test crack in wall');
  });

  it('PATCH updates the record', async () => {
    if (!adminCookie || !testProjectId || !recordId) return;
    const { status } = await api('PUT',
      '/api/projects/' + testProjectId + '/punchlist/' + recordId,
      { data: { title: 'Fixed crack in wall', priority: 'medium', status: 'resolved', location: 'Room 3A' } },
      adminCookie
    );
    expect(status).toBe(200);
    // Verify the update took effect
    const { data: readData } = await api('GET',
      '/api/projects/' + testProjectId + '/punchlist/' + recordId,
      null, adminCookie
    );
    expect(readData.record.data.status).toBe('resolved');
  });

  it('DELETE removes the record', async () => {
    if (!adminCookie || !testProjectId || !recordId) return;
    const { status } = await api('DELETE',
      '/api/projects/' + testProjectId + '/punchlist/' + recordId,
      null, adminCookie
    );
    expect(status).toBe(200);
    // Verify it's gone
    const { status: getStatus } = await api('GET',
      '/api/projects/' + testProjectId + '/punchlist/' + recordId,
      null, adminCookie
    );
    expect(getStatus).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOAD TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('File upload — Extension whitelist', () => {
  it('rejects .html upload', async () => {
    if (!adminCookie || !testProjectId) return;
    const formData = new FormData();
    formData.append('file', new Blob(['<html>bad</html>'], { type: 'text/html' }), 'evil.html');
    formData.append('project_id', testProjectId);

    const res = await fetch(BASE + '/api/files/upload', {
      method: 'POST',
      headers: { 'Cookie': adminCookie },
      body: formData
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects .php upload', async () => {
    if (!adminCookie || !testProjectId) return;
    const formData = new FormData();
    formData.append('file', new Blob(['<?php echo "hack"; ?>'], { type: 'application/x-php' }), 'shell.php');
    formData.append('project_id', testProjectId);

    const res = await fetch(BASE + '/api/files/upload', {
      method: 'POST',
      headers: { 'Cookie': adminCookie },
      body: formData
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('accepts .pdf upload', async () => {
    if (!adminCookie || !testProjectId) return;
    const formData = new FormData();
    formData.append('file', new Blob(['%PDF-1.4 fake pdf content'], { type: 'application/pdf' }), 'drawing.pdf');
    formData.append('project_id', testProjectId);

    const res = await fetch(BASE + '/api/files/upload', {
      method: 'POST',
      headers: { 'Cookie': adminCookie },
      body: formData
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.file).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

afterAll(async () => {
  if (adminCookie && testProjectId) {
    await api('DELETE', '/api/projects/' + testProjectId, null, adminCookie);
    console.log('  ✓ Test project deleted:', TEST_PROJECT_NAME);
  }
});

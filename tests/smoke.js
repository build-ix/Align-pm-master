#!/usr/bin/env node
// Align PM smoke test — hits every key endpoint, reports pass/fail
// Run: node tests/smoke.js

const BASE = 'http://localhost:3002';
const CREDS = { email: 'admin@align.local', password: 'Alfredo25' };

let passed = 0, failed = 0, cookie = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (cookie) opts.headers.Cookie = cookie;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}

(async () => {
  console.log('Align PM Smoke Test\n');

  await test('Server ping', async () => {
    const r = await fetch(BASE + '/api/ping');
    const b = await r.json();
    if (!b.ok) throw new Error('not ok');
  });

  await test('Sign in', async () => {
    const r = await api('POST', '/api/auth/signin', CREDS);
    if (r.status !== 200) throw new Error(r.body.error || 'failed');
    if (!r.body.user) throw new Error('no user returned');
  });

  await test('Auth me', async () => {
    const r = await api('GET', '/api/auth/me');
    if (r.status !== 200) throw new Error('not authenticated');
  });

  let projectId;
  await test('List projects', async () => {
    const r = await api('GET', '/api/projects');
    if (!Array.isArray(r.body.projects)) throw new Error('no projects');
    if (r.body.projects.length === 0) throw new Error('no projects');
    projectId = r.body.projects[0].id;
  });

  await test('Get project', async () => {
    const r = await api('GET', `/api/projects/${projectId}`);
    if (r.status !== 200) throw new Error('failed');
  });

  await test('List people', async () => {
    const r = await api('GET', '/api/people');
    if (!Array.isArray(r.body.people)) throw new Error('no people array');
  });

  await test('List members', async () => {
    const r = await api('GET', `/api/projects/${projectId}/members`);
    if (!Array.isArray(r.body.members || r.body.rows)) throw new Error('no members');
  });

  await test('List records (punchlist)', async () => {
    const r = await api('GET', `/api/projects/${projectId}/punchlist`);
    if (!Array.isArray(r.body.records)) throw new Error('no records');
  });

  await test('List contacts', async () => {
    const r = await api('GET', `/api/projects/${projectId}/contacts`);
    if (!Array.isArray(r.body.records)) throw new Error('no records');
  });

  await test('List files', async () => {
    const r = await api('GET', `/api/projects/${projectId}/files`);
    if (r.status !== 200) throw new Error('failed');
  });

  await test('Audit log', async () => {
    const r = await api('GET', `/api/audit/${projectId}`);
    if (!Array.isArray(r.body.entries)) throw new Error('no entries');
  });

  await test('Sign out', async () => {
    const r = await api('POST', '/api/auth/signout');
    if (!r.body.ok) throw new Error('failed');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();

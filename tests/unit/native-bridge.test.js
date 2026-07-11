import { test, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../../align-native-bridge.js'), 'utf8');

function makeLocalStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function loadBridge({ native = true, token = null, responder = null } = {}) {
  const calls = [];
  const localStorage = makeLocalStorage(token ? { 'align-native-token': token, 'align-token': token } : {});
  const realFetch = async (input, init = {}) => {
    calls.push({ input, init });
    if (responder) return responder(input, init);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const xhrs = [];
  class FakeXMLHttpRequest {
    constructor() {
      this.headers = {};
      xhrs.push(this);
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.body = body; }
  }
  const window = {
    Capacitor: native ? { isNativePlatform: () => true, Plugins: {} } : undefined,
    fetch: realFetch,
    XMLHttpRequest: FakeXMLHttpRequest,
    localStorage
  };
  window.window = window;

  vm.runInNewContext(source, {
    window,
    localStorage,
    fetch: realFetch,
    Headers,
    Request,
    Response,
    URL,
    console
  }, { filename: 'align-native-bridge.js' });

  return { window, calls, xhrs, localStorage };
}

test('native project requests reach the public HTTPS API with bearer auth', async () => {
  const { window, calls } = loadBridge({ token: 'native-session-token' });

  await window.fetch('/api/projects', { headers: { 'X-Test': 'yes' } });

  expect(calls).toHaveLength(1);
  expect(calls[0].input).toBe('https://alignprojects.net/api/projects');
  const headers = new Headers(calls[0].init.headers);
  expect(headers.get('Authorization')).toBe('Bearer native-session-token');
  expect(headers.get('X-Test')).toBe('yes');
});

test('native legacy sign-in uses bearer login while preserving the old response shape', async () => {
  const user = { id: 1, username: 'admin', name: 'Al' };
  const { window, calls, localStorage } = loadBridge({
    responder: async () => new Response(JSON.stringify({
      token: 'fresh-native-token',
      user,
      projects: [{ id: 7, name: 'Project' }],
      tiles: ['drawings']
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  });

  const response = await window.fetch('/api/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'secret' })
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].input).toBe('https://alignprojects.net/api/auth/login');
  expect(JSON.parse(calls[0].init.body)).toEqual({ username: 'admin', password: 'secret' });
  expect(localStorage.getItem('align-native-token')).toBe('fresh-native-token');
  expect(localStorage.getItem('align-token')).toBe('fresh-native-token');
  expect(await response.json()).toEqual({ user });
});

test('native legacy sign-out revokes and clears the bearer token', async () => {
  const { window, calls, localStorage } = loadBridge({
    token: 'native-session-token',
    responder: async () => new Response(null, { status: 204 })
  });

  const response = await window.fetch('/api/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].input).toBe('https://alignprojects.net/api/auth/logout');
  expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer native-session-token');
  expect(localStorage.getItem('align-native-token')).toBeNull();
  expect(localStorage.getItem('align-token')).toBeNull();
  expect(await response.json()).toEqual({});
});

test('native XHR uploads reach the public API with bearer auth', () => {
  const { window } = loadBridge({ token: 'native-session-token' });

  const xhr = new window.XMLHttpRequest();
  xhr.open('POST', '/api/files/upload', true);
  xhr.send('form-body');

  expect(xhr.url).toBe('https://alignprojects.net/api/files/upload');
  expect(xhr.headers.Authorization).toBe('Bearer native-session-token');
  expect(xhr.body).toBe('form-body');
});

test('web requests are left unchanged', async () => {
  const { window, calls } = loadBridge({ native: false, token: 'web-token' });

  await window.fetch('/api/projects', { headers: { 'X-Test': 'yes' } });

  expect(calls).toHaveLength(1);
  expect(calls[0].input).toBe('/api/projects');
  expect(new Headers(calls[0].init.headers).get('Authorization')).toBeNull();
});

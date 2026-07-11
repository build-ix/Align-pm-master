import { test, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeElement(extra) {
  return Object.assign({
    value: '',
    disabled: false,
    style: {},
    textContent: '',
    classList: { add() {}, remove() {} },
    addEventListener() {},
    focus() {},
    querySelector() { return null; }
  }, extra || {});
}

async function submittedUrl(capacitor) {
  let submitHandler = null;
  let requestedUrl = null;

  const label = makeElement();
  const elements = {
    'signin-form': makeElement({
      addEventListener(type, handler) {
        if (type === 'submit') submitHandler = handler;
      }
    }),
    'si-email': makeElement({ value: 'admin' }),
    'si-password': makeElement({ value: 'test-password' }),
    'si-email-error': makeElement(),
    'si-pass-error': makeElement(),
    'si-form-error': makeElement(),
    'si-btn': makeElement({ querySelector() { return label; } }),
    'si-spinner': makeElement()
  };

  const document = {
    getElementById(id) { return elements[id] || null; },
    querySelectorAll() { return []; }
  };

  const window = { Capacitor: capacitor };
  window.window = window;

  const sandbox = {
    window,
    document,
    setTimeout(fn) { fn(); },
    fetch(url) {
      requestedUrl = url;
      return Promise.reject(new TypeError('Failed to fetch'));
    }
  };

  const source = fs.readFileSync(path.join(__dirname, '../../signin.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'signin.js' });
  window.SignIn.mount({ innerHTML: '' });
  expect(typeof submitHandler).toBe('function');
  submitHandler({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  return requestedUrl;
}

test('native Capacitor sign-in posts to the public HTTPS API', async () => {
  const url = await submittedUrl({ isNativePlatform: () => true });
  expect(url).toBe('https://alignprojects.net/api/auth/login');
});

test('web sign-in keeps using the same-origin API path', async () => {
  const url = await submittedUrl(undefined);
  expect(url).toBe('/api/auth/login');
});

import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('the production shell loads the professional UI layer last', () => {
  const html = read('index.html');
  const polishLink = html.indexOf('align-polish.css?v=2');
  const moduleCss = html.lastIndexOf('align-procurement.css');

  expect(polishLink).toBeGreaterThan(moduleCss);
});

test('the professional UI layer uses the approved construction identity', () => {
  const css = read('align-polish.css');

  expect(css).toContain('--align-navy: #0e1b2c');
  expect(css).toContain('--align-orange: #e8641b');
  expect(css).toContain('.auth-overlay');
  expect(css).toContain('.app-header');
  expect(css).toContain('.weather-card');
  expect(css).toContain('.essentials-grid');
  expect(css).toContain('.tile-grid');
  expect(css).toContain('.ps-card');
  expect(css).toMatch(/\.auth-signin-btn[\s\S]*?background:\s*var\(--align-action\)/);
  expect(css).toMatch(/\.ess-card-icon[\s\S]*?color:\s*var\(--align-orange-ink\)\s*!important/);
  expect(css).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))');
});

test('the project selector uses the full wordmark and a deliberate empty-image state', () => {
  const script = read('script.js');

  expect(script).toContain('assets/c3-wordmark-light.svg');
  expect(script).toContain('assets/c3-wordmark-dark.svg');
  expect(script).toContain('ps-card-img-empty');
  expect(script).toContain('ps-card-initial');
  expect(script).toContain('ps-card-photo');
  expect(script).not.toContain('background-image:url');
  expect(script).not.toContain('var TILE_COLORS');
});

test('the professional UI layer contains no rejected visual effects', () => {
  const css = read('align-polish.css').toLowerCase();

  expect(css).not.toContain('linear-gradient');
  expect(css).not.toContain('radial-gradient');
  expect(css).not.toMatch(/backdrop-filter:\s*blur/i);
  expect(css).not.toContain('#6366f1');
  expect(css).not.toContain('translatey(-');
  expect(css).not.toMatch(/\.ps-signout-btn\s*\{[^}]*min-height:\s*38px/i);
  expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*?#user-badge-container\s*\{[^}]*min-width:\s*44px/i);
});

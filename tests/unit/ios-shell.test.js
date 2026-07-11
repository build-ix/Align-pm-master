import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const originalAssets = [
  'assets/align-logo-light-v2.png',
  'assets/align-logo-dark-v2.png',
  'assets/align-wordmark-v2.svg',
  'assets/align-wordmark-dark-v2.svg',
  'assets/drafting-bg-v2.png',
  'assets/drafting-bg-dark-v2.png'
];

test('iOS shell keeps the original dashboard, weather, and tile interface', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  expect(html).toContain('id="weather-row"');
  expect(html).toContain('class="tile-grid"');
  expect(html).toContain('id="dashboard"');
  expect(html).toContain('data-section="drawings"');

  for (const replacement of ['router.js', 'signin.js', 'home.js']) {
    expect(html).not.toContain(`src="${replacement}`);
  }
});

test('every original branded shell asset is present', () => {
  for (const relativePath of originalAssets) {
    const fullPath = path.join(root, relativePath);
    expect(fs.existsSync(fullPath), `${relativePath} is missing`).toBe(true);
    expect(fs.statSync(fullPath).size, `${relativePath} is empty`).toBeGreaterThan(100);
  }
});

test('shell references cache-busted branded assets', () => {
  const sources = ['index.html', 'styles.css', 'align-auth.css', 'align-api.js', 'script.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');

  for (const relativePath of originalAssets) {
    expect(sources, `${relativePath} is not referenced`).toContain(relativePath);
  }
});

test('every icon/favicon referenced in index.html exists on disk', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  // Collect all icon-related hrefs in <head>
  const headMatch = html.match(/<head>[\s\S]*?<\/head>/);
  const head = headMatch ? headMatch[0] : '';
  const hrefs = [...head.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/gi)];

  const checked = new Set();
  for (const m of hrefs) {
    const raw = m[1];
    // Resolve relative to root
    const resolved = raw.startsWith('/') ? raw.slice(1) : raw;
    if (checked.has(resolved)) continue;
    checked.add(resolved);
    const fullPath = path.join(root, resolved);
    expect(fs.existsSync(fullPath), `${resolved} (from href="${raw}") is missing`).toBe(true);
    expect(fs.statSync(fullPath).size, `${resolved} is empty`).toBeGreaterThan(100);
  }

  // Guard: we expect at least 2 icons (favicon.png + apple-touch-icon)
  expect(checked.size, 'Expected at least 2 icon references').toBeGreaterThanOrEqual(2);
});

test('changed shell files use a fresh browser cache version', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  // script.js was changed in the approved UI redesign — requires v=62
  for (const file of ['styles.css', 'align-auth.css', 'align-native-bridge.js', 'align-api.js']) {
    expect(html).toContain(`${file}?v=61`);
  }
  expect(html).toContain('script.js?v=62');
});

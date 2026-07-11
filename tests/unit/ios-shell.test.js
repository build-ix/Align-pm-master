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

test('changed shell files use a fresh browser cache version', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const file of ['styles.css', 'align-auth.css', 'align-native-bridge.js', 'align-api.js', 'script.js']) {
    expect(html).toContain(`${file}?v=61`);
  }
});

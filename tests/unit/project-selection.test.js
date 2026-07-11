import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('selecting a project refreshes Essentials after project hydration', () => {
  const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
  const start = source.indexOf('var switcher = window.AlignStorage.switchProject');
  const end = source.indexOf("var so = el.querySelector('#ps-signout')", start);
  const selectionHandler = source.slice(start, end);
  const refreshCalls = selectionHandler.match(/window\._refreshEssentials\(\)/g) || [];

  expect(start).toBeGreaterThan(-1);
  expect(refreshCalls).toHaveLength(2);
});

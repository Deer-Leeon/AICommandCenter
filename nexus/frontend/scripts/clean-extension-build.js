#!/usr/bin/env node
/**
 * clean-extension-build.js
 *
 * Post-build cleanup script for the Chrome Extension distribution.
 * Runs after `vite build --config vite.extension.config.ts`.
 *
 * What it does:
 *  1. Removes source map files (.map) — they expose source code and bloat the package
 *  2. Removes stray service worker artifacts (sw.js, workbox-*.js) — extension pages
 *     cannot register service workers; these are dead weight from the web build
 *  3. Removes .DS_Store and other hidden OS files
 *  4. Verifies that all required files are present
 *  5. Prints the total package size
 *
 * Usage:  node scripts/clean-extension-build.js
 * Called by the `build:extension` npm script automatically.
 */

import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';

const DIST = new URL('../dist-extension', import.meta.url).pathname;

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkDir(dir, fn) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, fn);
    } else {
      fn(full, entry.name);
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function totalSize(dir) {
  let total = 0;
  walkDir(dir, (filePath) => { total += statSync(filePath).size; });
  return total;
}

let removed = 0;
let errors = [];

// ── 1. Remove source maps ─────────────────────────────────────────────────────
walkDir(DIST, (filePath, name) => {
  if (extname(name) === '.map') {
    unlinkSync(filePath);
    console.log(`  ✓ Removed source map: ${name}`);
    removed++;
  }
});

// ── 2. Remove stray service worker / workbox artifacts ────────────────────────
// Extensions cannot register service workers on their own pages; these files
// are artifacts from the standard web build being mixed into the ext build.
walkDir(DIST, (filePath, name) => {
  if (
    name === 'sw.js' ||
    name.startsWith('workbox-') ||
    name === 'registerSW.js'
  ) {
    unlinkSync(filePath);
    console.log(`  ✓ Removed SW artifact: ${name}`);
    removed++;
  }
});

// ── 3. Remove hidden / OS files ───────────────────────────────────────────────
walkDir(DIST, (filePath, name) => {
  if (name === '.DS_Store' || name === 'Thumbs.db' || name.startsWith('._')) {
    unlinkSync(filePath);
    console.log(`  ✓ Removed OS file: ${name}`);
    removed++;
  }
});

// ── 4. Verify required files exist ───────────────────────────────────────────
const REQUIRED = [
  'manifest.json',
  'index.extension.html',
  'ext-init.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

for (const rel of REQUIRED) {
  const full = join(DIST, rel);
  if (!existsSync(full)) {
    errors.push(`  ✗ MISSING required file: ${rel}`);
  } else {
    console.log(`  ✓ Found: ${rel}`);
  }
}

// ── 5. Summary ────────────────────────────────────────────────────────────────
console.log('');
if (removed > 0) console.log(`Removed ${removed} file(s).`);

const size = totalSize(DIST);
const sizeFormatted = formatBytes(size);
const sizeWarning = size > 10 * 1024 * 1024 ? ' ⚠️  EXCEEDS 10 MB Chrome Web Store soft limit' : '';
console.log(`Package size: ${sizeFormatted}${sizeWarning}`);

if (errors.length > 0) {
  console.error('\nBuild verification FAILED:');
  errors.forEach((e) => console.error(e));
  process.exit(1);
} else {
  console.log('\n✅  Extension build is clean and ready for submission.');
}

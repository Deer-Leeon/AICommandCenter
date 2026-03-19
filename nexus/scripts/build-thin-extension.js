#!/usr/bin/env node
/**
 * build-thin-extension.js
 *
 * Packages the contents of chrome-extension-thin/ into a ZIP ready for
 * Chrome Web Store upload.
 *
 * Usage (from the nexus/ root):
 *   npm run build:extension-thin
 *
 * Output:
 *   chrome-extension-thin/nexus-extension-v2.0.0.zip
 */

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'chrome-extension-thin');
const OUT = join(SRC, 'dist');

// ── 1. Clean output directory ─────────────────────────────────────────────────
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

// ── 2. Copy extension files ───────────────────────────────────────────────────
const FILES = ['manifest.json', 'newtab.html', 'redirect.js', 'newtab.js', 'background.js'];
FILES.forEach((f) => {
  const src = join(SRC, f);
  if (!existsSync(src)) {
    console.error(`❌  Missing required file: ${f}`);
    process.exit(1);
  }
  copyFileSync(src, join(OUT, f));
  console.log(`  copied  ${f}`);
});

// ── 3. Copy icons ─────────────────────────────────────────────────────────────
mkdirSync(join(OUT, 'icons'), { recursive: true });
const ICONS = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'];
ICONS.forEach((icon) => {
  const src = join(SRC, 'icons', icon);
  if (!existsSync(src)) {
    console.error(`❌  Missing icon: icons/${icon}`);
    process.exit(1);
  }
  copyFileSync(src, join(OUT, 'icons', icon));
  console.log(`  copied  icons/${icon}`);
});

// ── 4. Create ZIP ─────────────────────────────────────────────────────────────
const zipPath = join(SRC, 'nexus-extension-v2.0.0.zip');
if (existsSync(zipPath)) rmSync(zipPath);

execSync(`cd "${OUT}" && zip -r "${zipPath}" .`);

// ── 5. Clean up dist/ so it cannot be accidentally included if someone
//       manually zips the chrome-extension-thin/ source folder ───────────────
rmSync(OUT, { recursive: true });

// ── 6. Report ─────────────────────────────────────────────────────────────────
const sizeKB = (statSync(zipPath).size / 1024).toFixed(1);

console.log('');
console.log('✅  Thin extension built successfully');
console.log(`📦  Package size: ${sizeKB} KB`);
console.log(`📁  Output: chrome-extension-thin/nexus-extension-v2.0.0.zip`);
console.log('Next steps:');
console.log('  1. Go to chrome.google.com/webstore/devconsole');
console.log('  2. Upload nexus-extension-v2.0.0.zip');
console.log('  3. Paste RESUBMISSION_NOTES.md into the reviewer notes field');
console.log('  4. Submit');

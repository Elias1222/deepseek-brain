#!/usr/bin/env node
/**
 * Inline the vendored three.js build into the 3D brain page so the deliverable
 * is a genuinely standalone single HTML file (works from file://, offline).
 *
 *   node tools/build-3d.mjs           → dist/deepseek-brain-3d.html
 *   node tools/build-3d.mjs --check   → verify the page still references vendor
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(root, 'web', 'brain-3d.html');
const vendorPath = path.join(root, 'web', 'vendor', 'three.global.min.js');
const outDir = path.join(root, 'dist');
const outPath = path.join(outDir, 'deepseek-brain-3d.html');

const SCRIPT_TAG = /<script\b[^>]*src=["'][^"']*three\.global\.min\.js["'][^>]*>\s*<\/script>/i;

if (!fs.existsSync(pagePath)) {
  console.error(`missing page: ${pagePath}`);
  process.exit(1);
}
if (!fs.existsSync(vendorPath)) {
  console.error(`missing vendor build: ${vendorPath}\nrun: node tools/build-global-three.mjs`);
  process.exit(1);
}

const html = fs.readFileSync(pagePath, 'utf8');
if (!SCRIPT_TAG.test(html)) {
  console.error('brain-3d.html does not reference ./vendor/three.global.min.js — nothing to inline');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const bytes = Buffer.byteLength(html);
  console.log(`ok: page ${bytes} bytes, vendor reference present`);
  process.exit(0);
}

const three = fs.readFileSync(vendorPath, 'utf8').replace(/<\/script/gi, '<\\/script');
const standalone = html.replace(SCRIPT_TAG, () => `<script>\n${three}\n</script>`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, standalone);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`built ${path.relative(root, outPath)} (${kb(Buffer.byteLength(standalone))})`);
console.log('open it directly in a browser: file:// works, no server required.');

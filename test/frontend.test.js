import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LAYERS = ['感觉记忆', '工作记忆', '情景记忆', '语义记忆', '程序记忆'];

// A page that must survive being opened from file:// cannot pull anything from the network.
function externalRefs(html) {
  const hits = [];
  for (const re of [/<script[^>]+src=["']([^"']+)/g, /<link[^>]+href=["']([^"']+)/g, /@import\s+url\(["']?([^"')]+)/g]) {
    for (const m of html.matchAll(re)) hits.push(m[1]);
  }
  return hits.filter((href) => /^(https?:)?\/\//i.test(href));
}

test('three.js global build exposes window.THREE', () => {
  const src = read('web/vendor/three.global.min.js');
  assert.ok(src.length > 500_000, 'vendor bundle present');
  assert.ok(src.includes('globalThis.THREE'), 'assigns globalThis.THREE');
  assert.ok(!/^\s*export\s*\{/m.test(src.slice(-400)), 'no ESM export tail');
});

test('dashboard is a single self-contained file that reads the live API', () => {
  const html = read('web/dashboard.html');
  assert.ok(html.length > 60_000);
  assert.deepEqual(externalRefs(html), [], 'no remote scripts/styles');
  assert.ok(html.includes('api/state'), 'polls the state endpoint');
  for (const layer of LAYERS) assert.ok(html.includes(layer), `mentions ${layer}`);
  assert.ok(html.includes('deepseek-brain-export.json'), 'has a JSON export');
});

test('chronicle opens a revision drawer backed by the version chain', () => {
  const html = read('web/dashboard.html');
  assert.ok(html.includes('id="revDrawer"'), 'ships the drawer markup');
  assert.ok(html.includes('api/memories/'), 'reads GET api/memories/:id');
  assert.ok(html.includes('api/conflicts/'), 'restores semantic facts through the conflict endpoint');
  assert.ok(html.includes('恢复此版本'), 'offers the restore action');
  assert.ok(html.includes("method:'PATCH'") || html.includes("method: 'PATCH'"), 'restores episodic facts with PATCH');
});

test('3D page wires three.js + the API and names all five regions', () => {
  const html = read('web/brain-3d.html');
  assert.ok(html.length > 40_000);
  assert.ok(html.includes('vendor/three.global.min.js'), 'loads the vendored three.js');
  assert.ok(html.includes('api/state'), 'reads the live API');
  assert.ok(html.includes('pointerdown'), 'uses pointer events');
  for (const layer of LAYERS) assert.ok(html.includes(layer), `names ${layer}`);
  assert.deepEqual(externalRefs(html), [], 'no CDN fallback required');
});

test('inline scripts of both pages parse as classic JavaScript', async () => {
  const vm = await import('node:vm');
  for (const page of ['web/dashboard.html', 'web/brain-3d.html']) {
    const html = read(page);
    const tags = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    // Data blocks (application/json, text/template, importmap) are not JavaScript.
    const blocks = tags
      .filter(([, attrs]) => !/\bsrc=/.test(attrs) && !/type=["'](?:application\/json|text\/template|importmap|application\/ld\+json)["']/i.test(attrs))
      .map(([, , code]) => code);
    assert.ok(blocks.length > 0, `${page} has inline script`);
    blocks.forEach((code, index) => {
      // Compile only: vm.Script throws on syntax errors without executing the app.
      new vm.Script(code, { filename: `${page}#script${index}` });
    });
  }
});

test('single-file 3D build inlines three.js and needs no vendor file', (t) => {
  const distPath = path.join(ROOT, 'dist', 'deepseek-brain-3d.html');
  if (!fs.existsSync(distPath)) {
    t.skip('run `node tools/build-3d.mjs` to produce dist/deepseek-brain-3d.html');
    return;
  }
  const html = fs.readFileSync(distPath, 'utf8');
  assert.ok(!html.includes('three.global.min.js'), 'three.js is inlined, not linked');
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external script tags remain');
  assert.ok(html.length > 700_000, 'bundle contains the three.js payload');
  assert.ok(html.includes('api/state'), 'still talks to the live API when served');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';
import { createHandler } from '../lib/server.js';

async function withServer(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-http-'));
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-web-'));
  fs.writeFileSync(path.join(webRoot, 'dashboard.html'), '<!doctype html><title>dashboard</title>');
  fs.writeFileSync(path.join(webRoot, 'brain-3d.html'), '<!doctype html><title>brain3d</title>');
  fs.mkdirSync(path.join(webRoot, 'vendor'));
  fs.writeFileSync(path.join(webRoot, 'vendor', 'three.js'), 'window.THREE={};');
  const memory = await new MemorySystem({ dataDir, demoSeed: true }).init();
  const handler = createHandler({ memory, webRoot, base: '/deepseek-brain' });
  const server = http.createServer((req, res) => handler.handle(req, res, '/deepseek-brain'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/deepseek-brain`;
  try {
    return await fn({ origin, memory, dataDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function get(origin, route, init) {
  const res = await fetch(`${origin}${route}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

test('GET /api/state returns the front-end contract', async () => {
  await withServer(async ({ origin }) => {
    const res = await get(origin, '/api/state');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.json.ok, true);
    assert.ok(Array.isArray(res.json.episodic));
    assert.ok(Array.isArray(res.json.working.stack));
    assert.ok(res.json.stats.total > 0);
    assert.ok(res.json.regions.episodic.count > 0);
  });
});

test('POST /api/remember writes and reflects in state', async () => {
  await withServer(async ({ origin }) => {
    const before = (await get(origin, '/api/state')).json.stats.total;
    const created = await get(origin, '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: 'episodic', event: '和张伟复盘 3D 大脑', importance: 5, participants: ['张伟'] }),
    });
    assert.equal(created.status, 200);
    assert.equal(created.json.ok, true);
    const after = (await get(origin, '/api/state')).json.stats.total;
    assert.equal(after, before + 1);

    const semantic = await get(origin, '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: 'semantic', subject: '用户', relation: '职业', object: '设计师', importance: 4 }),
    });
    assert.equal(semantic.json.ok, true);
    const corrected = await get(origin, '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: 'semantic', subject: '用户', relation: '职业', object: '产品设计师', importance: 5 }),
    });
    assert.equal(corrected.json.corrected.length, 1);
  });
});

test('POST /api/forget archives and 404s unknown ids', async () => {
  await withServer(async ({ origin, memory }) => {
    const id = memory.episodic[0].id;
    const ok = await get(origin, '/api/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.archived, id);
    const missing = await get(origin, '/api/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'nope' }),
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not-found');
  });
});

test('export endpoints serve json and markdown downloads', async () => {
  await withServer(async ({ origin }) => {
    const json = await get(origin, '/api/export.json');
    assert.equal(json.status, 200);
    assert.match(json.headers.get('content-disposition'), /deepseek-brain-export\.json/);
    assert.ok(json.json.episodic.length > 0);
    const md = await get(origin, '/api/snapshot.md');
    assert.equal(md.status, 200);
    assert.ok(md.text.includes('# DeepSeek Brain'));
  });
});

test('static pages, vendor files and OPTIONS preflight', async () => {
  await withServer(async ({ origin }) => {
    const dashboard = await get(origin, '/dashboard.html');
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.text.includes('dashboard'));
    const brain = await get(origin, '/brain-3d.html');
    assert.equal(brain.status, 200);
    const vendor = await get(origin, '/vendor/three.js');
    assert.equal(vendor.status, 200);
    assert.match(vendor.headers.get('content-type'), /javascript/);
    const preflight = await fetch(`${origin}/api/remember`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');
  });
});

test('unknown routes and traversal attempts are refused', async () => {
  await withServer(async ({ origin }) => {
    const missing = await get(origin, '/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'no-route');
    const traversal = await get(origin, '/vendor/../../etc/passwd');
    assert.ok([403, 404].includes(traversal.status));
  });
});

test('invalid bodies produce structured errors, not crashes', async () => {
  await withServer(async ({ origin }) => {
    const bad = await get(origin, '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.ok, false);
    const unknownLayer = await get(origin, '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: 'nowhere' }),
    });
    assert.equal(unknownLayer.status, 400);
  });
});

test('sleep and decay endpoints report their work', async () => {
  await withServer(async ({ origin }) => {
    const slept = await get(origin, '/api/sleep', { method: 'POST' });
    assert.equal(slept.status, 200);
    assert.equal(slept.json.ok, true);
    assert.ok(slept.json.report);
    const decayed = await get(origin, '/api/decay', { method: 'POST' });
    assert.equal(decayed.json.ok, true);
    assert.equal(typeof decayed.json.forgotten, 'number');
  });
});

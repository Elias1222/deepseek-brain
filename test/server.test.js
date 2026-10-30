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

test('state exposes derived salience for every layer', async () => {
  await withServer(async ({ origin }) => {
    const res = await get(origin, '/api/state');
    const { episodic, semantic, procedural } = res.json;
    assert.ok(episodic.length > 0 && semantic.length > 0 && procedural.length > 0);
    for (const item of [...episodic, ...semantic, ...procedural]) {
      assert.equal(typeof item.ageDays, 'number');
      assert.ok(item.ageDays >= 0);
      assert.equal(typeof item.salience, 'number');
      assert.ok(item.salience >= 0 && item.salience <= 1, `salience out of range: ${item.salience}`);
    }
    const pinned = episodic.filter((it) => it.importance >= 4);
    assert.ok(pinned.every((it) => it.salience > 0.3), 'pinned memories stay visible');
  });
});

test('time travel requests recompute episodic strength at the given instant', async () => {
  await withServer(async ({ origin }) => {
    const now = (await get(origin, '/api/state')).json;
    const past = await get(origin, '/api/state?at=-10d');
    assert.equal(past.status, 200);
    assert.ok(past.json.at < now.at);
    const key = (state) => new Map(state.episodic.map((it) => [it.id, it.strength]));
    const nowMap = key(now);
    // 10 days in the past the same memory is fresher, so its strength is higher;
    // 30 days in the future it has decayed further. Pinned items never fade.
    for (const item of past.json.episodic) {
      const reference = nowMap.get(item.id);
      if (reference === undefined || item.importance >= 4) continue;
      assert.ok(item.strength > reference, `${item.id} should be fresher 10 days ago`);
    }
    const future = await get(origin, '/api/state?at=%2B30d');
    assert.equal(future.status, 200);
    // the server evaluates "+30d" against its own clock, a few ms after ours
    assert.ok(Math.abs(future.json.at - (now.at + 30 * 86_400_000)) < 5000, '"+30d" resolves into the future');
    const ahead = await get(origin, `/api/state?at=${now.at + 30 * 86_400_000}`);
    const aheadMap = key(ahead.json);
    for (const item of ahead.json.episodic) {
      const reference = nowMap.get(item.id);
      if (reference === undefined || item.importance >= 4) continue;
      assert.ok(item.strength < reference, `${item.id} should be weaker 30 days ahead`);
    }
    const iso = new Date(now.at - 86_400_000).toISOString();
    const byIso = await get(origin, `/api/state?at=${encodeURIComponent(iso)}`);
    assert.equal(byIso.json.at, Date.parse(iso));
    const garbage = await get(origin, '/api/state?at=not-a-date');
    assert.equal(garbage.status, 200);
    assert.ok(Math.abs(garbage.json.at - now.at) < 5000, 'unparsable "at" falls back to now');
  });
});

test('POST /api/recall returns ranked hits with score parts', async () => {
  await withServer(async ({ origin }) => {
    const res = await get(origin, '/api/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '张伟 会议 排期', topK: 4 }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(Array.isArray(res.json.hits));
    assert.ok(res.json.hits.length > 0, 'demo brain should recall something');
    assert.ok(res.json.hits.length <= 4);
    const first = res.json.hits[0];
    assert.ok(['sensory', 'working', 'episodic', 'semantic', 'procedural'].includes(first.layer));
    for (const part of ['keyword', 'importance', 'freshness']) {
      assert.equal(typeof first.parts[part], 'number', `missing part ${part}`);
    }
    assert.ok(res.json.tookMs >= 0);
    const empty = await get(origin, '/api/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '   ' }),
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error.code, 'missing-query');
  });
});

test('forgetInDays is the honest forecast of the crossing instant', async () => {
  await withServer(async ({ origin }) => {
    const created = await get(origin, '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: 'episodic', event: '一条即将被遗忘的小事', importance: 1 }),
    });
    assert.equal(created.status, 200);
    const id = created.json.item.id;
    const state = (await get(origin, '/api/state')).json;
    assert.equal(state.forgetThreshold, 0.5);
    assert.equal(state.pinnedImportance, 4);
    const item = state.episodic.find((it) => it.id === id);
    // importance 1 crosses 0.5 after ln(1/0.5)/0.05 = 13.86 days
    assert.ok(Math.abs(item.forgetInDays - 13.86) < 0.2, `unexpected forecast ${item.forgetInDays}`);
    assert.equal(item.pinned, false);
    const pinnedItem = state.episodic.find((it) => it.pinned);
    assert.ok(pinnedItem, 'demo brain has at least one pinned memory');
    assert.equal(pinnedItem.forgetInDays, null);
    const later = (await get(origin, '/api/state?at=%2B10d')).json;
    const travelled = later.episodic.find((it) => it.id === id);
    assert.ok(Math.abs(travelled.forgetInDays - 3.86) < 0.2, 'ten days later only 3.86 days remain');
  });
});

test('activity log records cognition and can be polled incrementally', async () => {
  await withServer(async ({ origin }) => {
    const first = await get(origin, '/api/activity?since=0');
    assert.equal(first.status, 200);
    assert.equal(first.json.ok, true);
    const baseSeq = first.json.seq;
    await get(origin, '/api/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '张伟 会议' }),
    });
    const after = await get(origin, '/api/activity', { method: 'GET' });
    assert.ok(after.json.seq > baseSeq, 'sequence must advance');
    const recalled = after.json.events.filter((e) => e.kind === 'recall');
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0].query, '张伟 会议');
    assert.ok(recalled[0].hits.length > 0);
    const later = await get(origin, '/api/remember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layer: 'semantic', subject: '用户', relation: '书名', object: '神经漫游者', importance: 4 }),
    });
    assert.equal(later.status, 200);
    const tail = await get(origin, `/api/activity?since=${after.json.seq}`);
    assert.equal(tail.json.events.length, 1);
    assert.equal(tail.json.events[0].kind, 'remember');
    assert.equal(tail.json.events[0].layer, 'semantic');
    const state = await get(origin, '/api/state');
    assert.equal(state.json.activitySeq, tail.json.seq);
    assert.equal(state.json.lastEvent.id, tail.json.events[0].id);
  });
});

test('parseAt understands relative, epoch and ISO forms', async () => {
  const { parseAt } = await import('../lib/server.js');
  const now = Date.parse('2026-10-30T12:00:00.000Z');
  assert.equal(parseAt(null, now), now);
  assert.equal(parseAt('-2d', now), now - 2 * 86_400_000);
  assert.equal(parseAt('-3h', now), now - 3 * 3_600_000);
  assert.equal(parseAt('2026-10-01T00:00:00.000Z', now), Date.parse('2026-10-01T00:00:00.000Z'));
  assert.equal(parseAt(String(now - 1000), now), now - 1000);
  assert.equal(parseAt('nonsense', now), now);
});

import test from 'node:test';
import assert from 'node:assert/strict';

/* 归档区端点：列出 → 取回 → 再列出。用真实 MemorySystem + createHandler，和 server.test.js 同构。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';
import { createHandler } from '../lib/server.js';

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-archive-'));
  const memory = await new MemorySystem({ dataDir, demoSeed: false }).init();
  memory.remember({ layer: 'episodic', event: '和张伟在望京开会', participants: ['张伟'], place: '望京', importance: 4 });
  const dropped = memory.remember({ layer: 'episodic', event: '周末去奥森公园跑步', place: '奥森公园', importance: 2 }).item;
  memory.forget(dropped.id);
  const handler = createHandler({ memory, webRoot: '.', version: 'test' });
  const server = (await import('node:http')).createServer((req, res) => handler.handle(req, res, '/deepseek-brain'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/deepseek-brain`;
  return { memory, server, origin, dropped };
}

const get = (origin, p, init) => fetch(origin + p, init).then(async (res) => ({ status: res.status, json: await res.json() }));

test('GET /api/archive lists archived rows and POST /api/archive/:id/restore brings one back', async () => {
  const { server, origin, dropped } = await boot();
  try {
    const listed = await get(origin, '/api/archive');
    assert.equal(listed.status, 200);
    assert.equal(listed.json.ok, true);
    assert.equal(listed.json.total, 1);
    assert.equal(listed.json.byLayer.episodic, 1);
    assert.equal(listed.json.items[0].id, dropped.id);
    assert.equal(listed.json.items[0].reason, 'manual');

    const filtered = await get(origin, '/api/archive?q=' + encodeURIComponent('奥森') + '&layer=episodic');
    assert.equal(filtered.json.total, 1, 'keyword + layer filter works');
    const miss = await get(origin, '/api/archive?q=' + encodeURIComponent('没有这个词'));
    assert.equal(miss.json.total, 0);

    const restored = await get(origin, `/api/archive/${dropped.id}/restore`, { method: 'POST' });
    assert.equal(restored.status, 200);
    assert.equal(restored.json.layer, 'episodic');
    assert.equal(restored.json.item.event, '周末去奥森公园跑步');
    assert.ok(restored.json.title.includes('奥森'));

    const after = await get(origin, '/api/archive');
    assert.equal(after.json.total, 0, 'restored row leaves the archive');

    const missing = await get(origin, '/api/archive/ep_nope/restore', { method: 'POST' });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not-found');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

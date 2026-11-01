import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-digest-'));

test('the export carries a readable digest of recent activity', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir }).init();
  memory.activity.push('recall', { query: '张伟 会议', hits: [{ id: 'a' }, { id: 'b' }], took: 12 }, 1000);
  memory.activity.push('remember', { id: 'ep_1', layer: 'episodic' }, 2000);

  const exported = memory.exportJson();
  assert.ok(exported.activity, 'activity block exists');
  assert.equal(exported.activity.seq, 2);
  assert.equal(exported.activity.events.length, 2);
  assert.equal(exported.activity.events[0].kind, 'recall');
  assert.match(exported.activity.events[0].detail, /张伟 会议/);
  assert.match(exported.activity.events[0].detail, /2 命中/);
  assert.equal(exported.activity.events[1].kind, 'remember');
});

test('the markdown snapshot lists the recent activity but marks it as context, not memory', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir }).init();
  memory.activity.push('recall', { query: '支付 评审', hits: [], took: 3 }, 1000);

  const text = memory.snapshotMarkdown();
  assert.match(text, /## 最近活动 · 进程日志/);
  assert.match(text, /支付 评审/);
  assert.match(text, /导入时会忽略它/);
});

test('activity does not leak into the memory counts', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir, demoSeed: false }).init();
  const before = memory.exportJson();
  memory.activity.push('recall', { query: 'x', hits: [] }, 1000);
  const after = memory.exportJson();
  assert.equal(after.episodic.length, before.episodic.length);
  assert.equal(after.semantic.length, before.semantic.length);
  assert.equal(after.procedural.length, before.procedural.length);
});

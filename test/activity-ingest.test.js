import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';
import { Store } from '../lib/store.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ingest-'));

test('ingest pushes only the events the reader has not seen yet', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir }).init();
  const seen = [];
  memory.activity.subscribe((event) => seen.push(event.seq));

  memory.activity.ingest([
    { seq: 1, kind: 'recall', ts: 1, query: 'a' },
    { seq: 2, kind: 'recall', ts: 2, query: 'b' },
  ]);
  assert.deepEqual(seen, [1, 2], 'both new events were pushed to subscribers');
  assert.equal(memory.activity.seq, 2);

  /* 同样的两行再来一次：一条也不该重复推 */
  const again = memory.activity.ingest([
    { seq: 1, kind: 'recall', ts: 1, query: 'a' },
    { seq: 2, kind: 'recall', ts: 2, query: 'b' },
  ]);
  assert.equal(again, 0);
  assert.deepEqual(seen, [1, 2]);
});

test('a read-only instance pushes the owner events through its own subscribers', async () => {
  const dir = tempDir();
  const owner = await new MemorySystem({ dataDir: dir }).init();
  owner.activity.push('recall', { query: '持有者的第一句', hits: [] }, 1000);

  fs.writeFileSync(
    path.join(dir, 'brain.lock'),
    JSON.stringify({ pid: process.ppid, at: Date.now(), host: 'x' }),
  );
  const reader = await new MemorySystem({ dataDir: dir }).init();
  assert.equal(reader.readOnly, true);

  const pushed = [];
  reader.activity.subscribe((event) => pushed.push(event.query || event.kind));

  /* 持有者又查了一次：只读实例读盘追平，并把这条推给它的订阅者 */
  owner.activity.push('recall', { query: '持有者的第二句', hits: [] }, 2000);
  reader.syncActivityFromDisk();

  assert.equal(reader.activity.seq, 2);
  assert.ok(pushed.includes('持有者的第二句'), 'subscribers see the owner event');
  assert.ok(!pushed.includes('持有者的第一句'), 'the already-seen event is not replayed');
});

test('ingest keeps the ring buffer bounded', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir, activityLimit: 20 }).init();
  const many = [];
  for (let i = 1; i <= 60; i++) many.push({ seq: i, kind: 'recall', ts: i, query: 'q' + i });
  memory.activity.ingest(many);
  assert.equal(memory.activity.events.length, 20);
  assert.equal(memory.activity.seq, 60);
  assert.equal(memory.activity.events[19].seq, 60);
});

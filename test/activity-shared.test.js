import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';
import { Store } from '../lib/store.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brain-shared-'));
}

test('the activity log is written to the data dir and read back', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir }).init();
  memory.activity.push('recall', { query: '共享日志', hits: [] }, 1000);
  memory.activity.push('remember', { id: 'ep_x', layer: 'episodic' }, 2000);

  const store = new Store(dir);
  const read = store.readActivity({ limit: 10 });
  assert.equal(read.length, 2);
  assert.equal(read[0].kind, 'recall');
  assert.equal(read[0].query, '共享日志');
  assert.equal(read[1].seq, 2);
});

test('a second process inherits the owner activity stream', async () => {
  const dir = tempDir();
  const owner = await new MemorySystem({ dataDir: dir }).init();
  owner.activity.push('recall', { query: '张伟 会议', hits: [] }, 1000);
  owner.activity.push('recall', { query: '支付 评审', hits: [] }, 1500);

  /* 伪造「另一个进程正持有锁」，让第二个实例只能只读 */
  const lockFile = path.join(dir, 'brain.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, at: Date.now(), host: 'x' }));

  const reader = await new MemorySystem({ dataDir: dir }).init();
  assert.equal(reader.readOnly, true, 'the second instance is read-only');
  assert.equal(reader.activity.seq, 2, 'it knows the owner had already written two events');
  const carried = reader.activity.since(0, { limit: 10 });
  assert.equal(carried.length, 2);
  assert.equal(carried[1].query, '支付 评审');

  /* 只读实例不写盘：事件只进内存 */
  reader.activity.push('observe', { text: '只读' }, 3000);
  const onDisk = new Store(dir).readActivity({ limit: 10 });
  assert.equal(onDisk.length, 2, 'the read-only instance did not append');
});

test('activity.jsonl is capped so it cannot grow without bound', () => {
  const dir = tempDir();
  const store = new Store(dir);
  for (let i = 1; i <= 12; i++) {
    store.appendActivity({ seq: i, kind: 'recall', ts: i }, { max: 5 });
  }
  const read = store.readActivity({ limit: 50 });
  assert.equal(read.length, 5);
  assert.equal(read[read.length - 1].seq, 12);
});

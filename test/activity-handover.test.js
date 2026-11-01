import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';
import { Store } from '../lib/store.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-handover-'));

test('a handover re-attaches the activity tail so new events reach the disk', async () => {
  const dir = tempDir();
  const lockFile = path.join(dir, 'brain.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, at: Date.now(), host: 'x' }));

  const memory = await new MemorySystem({ dataDir: dir, handoverMs: 60 }).init();
  assert.equal(memory.readOnly, true, 'starts read-only');

  fs.rmSync(lockFile, { force: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(memory.readOnly, false, 'took over after the holder vanished');

  memory.activity.push('recall', { query: '接管之后', hits: [] }, Date.now());
  const onDisk = new Store(dir).readActivity({ limit: 5 });
  assert.equal(onDisk.length, 1, 'events written after takeover are persisted');
  assert.equal(onDisk[0].query, '接管之后');
});

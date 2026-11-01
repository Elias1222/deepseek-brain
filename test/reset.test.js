import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';
import { Store } from '../lib/store.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-reset-'));

test('resetAll clears every layer, the archive and the activity stream', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir, demoSeed: true }).init();
  memory.remember({ layer: 'episodic', event: '重置前的一条', importance: 3 });
  memory.forget(memory.episodic[0].id);
  memory.activity.push('recall', { query: '重置前', hits: [] }, Date.now());
  const before = memory.stats.boot.count;

  const report = memory.resetAll();
  assert.ok(report.cleared.episodic > 0, 'there was something to clear');
  assert.equal(memory.episodic.length, 0);
  assert.equal(memory.semantic.items.length, 0);
  assert.equal(memory.procedural.items.length, 0);
  assert.equal(memory.archive.length, 0);
  assert.equal(memory.activity.events.length, 1, 'only the reset event remains');
  assert.equal(memory.activity.events[0].kind, 'reset');
  assert.equal(memory.stats.counters.forgotten, 0);
  assert.equal(before, 1);
  assert.equal(memory.stats.boot.count, 1, 'a reset starts the generation count over');
  assert.equal(memory.stats.boot.previous, null);
});

test('resetAll leaves empty structures on disk instead of stale memories', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir, demoSeed: true }).init();
  memory.resetAll();

  const store = new Store(dir);
  assert.equal(store.read('episodic.json', { items: [] }).data.items.length, 0);
  assert.equal(store.read('archive.json', { items: [] }).data.items.length, 0);
  assert.equal(store.readActivity({ limit: 10 }).length, 1, 'only the reset line in activity.jsonl');

  const again = await new MemorySystem({ dataDir: dir }).init();
  assert.equal(again.episodic.length, 0, 'a fresh process sees an empty brain');
});

test('resetAll writes a pre-reset snapshot you can go back to', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir, demoSeed: true }).init();
  memory.remember({ layer: 'episodic', event: '清空前的最后一条', importance: 5 });

  const report = memory.resetAll();
  assert.ok(report.snapshot, 'a snapshot path is reported');
  assert.ok(fs.existsSync(report.snapshot), 'the snapshot file exists');
  const md = fs.readFileSync(report.snapshot, 'utf8');
  assert.match(md, /清空前的最后一条/, 'the snapshot keeps the memory that was about to be lost');
  assert.equal(memory.episodic.length, 0);
});

test('resetAll can skip the snapshot when you really mean it', async () => {
  const dir = tempDir();
  const memory = await new MemorySystem({ dataDir: dir, demoSeed: true }).init();
  const report = memory.resetAll({ snapshot: false });
  assert.equal(report.snapshot, undefined);
});

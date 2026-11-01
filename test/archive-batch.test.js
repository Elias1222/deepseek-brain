import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';

async function makeMemory() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-batch-'));
  return new MemorySystem({ dataDir, demoSeed: false }).init();
}

test('restoreArchivedMany reports what moved and what was missing', async () => {
  const memory = await makeMemory();
  const a = memory.remember({ layer: 'episodic', event: '周一复盘', importance: 3 }).item;
  const b = memory.remember({ layer: 'procedural', rule: '先给结论', importance: 3 }).item;
  memory.forget(a.id);
  memory.forget(b.id);
  assert.equal(memory.archiveList().total, 2);

  const result = memory.restoreArchivedMany([a.id, b.id, 'ep_missing']);
  assert.equal(result.restored.length, 2);
  assert.deepEqual(result.missing, ['ep_missing']);
  assert.equal(result.restored[0].layer, 'episodic');
  assert.equal(result.restored[1].layer, 'procedural');
  assert.equal(memory.archiveList().total, 0, 'both left the archive');
  assert.ok(memory.episodic.some((it) => it.id === a.id));
  assert.ok(memory.procedural.items.some((it) => it.id === b.id));
});

test('undoRestore puts a just-restored memory back into the archive', async () => {
  const memory = await makeMemory();
  const one = memory.remember({ layer: 'episodic', event: '季度评审改到周四', importance: 3 }).item;
  memory.forget(one.id);
  memory.restoreArchived(one.id);
  assert.ok(memory.episodic.some((it) => it.id === one.id));

  const undone = memory.undoRestore(one.id);
  assert.equal(undone.layer, 'episodic');
  assert.equal(undone.title, '季度评审改到周四');
  assert.ok(!memory.episodic.some((it) => it.id === one.id), 'gone from the layer again');
  const archived = memory.archiveList();
  assert.equal(archived.total, 1);
  assert.equal(archived.items[0].reason, 'undo', 'the archive records why it came back');

  const again = memory.undoRestore(one.id);
  assert.equal(again, null, 'undo is one-shot');
});

test('undoRestore on a semantic fact re-hides it without touching the active value', async () => {
  const memory = await makeMemory();
  const old = memory.remember({ layer: 'semantic', subject: '用户', relation: '职业', object: '设计师', importance: 3 }).item;
  memory.remember({ layer: 'semantic', subject: '用户', relation: '职业', object: '产品设计师', importance: 5 });
  memory.semantic.forget(old.id);
  memory.restoreArchived(old.id);
  assert.equal(memory.semantic.items.find((it) => it.id === old.id).status, 'corrected');

  const undone = memory.undoRestore(old.id);
  assert.equal(undone.layer, 'semantic');
  assert.equal(memory.semantic.items.find((it) => it.id === old.id).status, 'archived');
  const active = memory.semantic.items.filter((it) => it.status === 'active' && it.relation === '职业');
  assert.equal(active.length, 1);
  assert.equal(active[0].object, '产品设计师', 'active fact survives the undo');
});

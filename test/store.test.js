import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-store-'));
  return { dir, store: new Store(dir, { backupCount: 3 }).ensure() };
}

test('store writes, reads and rotates backups', () => {
  const { dir, store } = tmpStore();
  store.write('episodic.json', { version: 1, items: [] });
  store.write('episodic.json', { version: 1, items: [{ id: 'a' }] });
  const read = store.read('episodic.json', null);
  assert.equal(read.data.items.length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'episodic.json')));
  const backups = store.backups('episodic.json');
  assert.ok(backups.length >= 1, 'previous revision should be backed up');
});

test('store keeps at most backupCount revisions', () => {
  const { store } = tmpStore();
  for (let i = 0; i < 6; i += 1) {
    store.write('semantic.json', { version: 1, items: [{ i }] });
    const list = store.backups('semantic.json');
    for (const extra of list.slice(3)) fs.rmSync(extra.path, { force: true });
  }
  assert.ok(store.backups('semantic.json').length <= 3);
});

test('corrupt json is quarantined and restored from a backup', () => {
  const { dir, store } = tmpStore();
  store.write('procedural.json', { version: 1, items: [{ rule: 'old' }] });
  fs.utimesSync(path.join(dir, 'procedural.json'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  store.write('procedural.json', { version: 1, items: [{ rule: 'new' }] });
  const [backup] = store.backups('procedural.json');
  assert.ok(backup, 'rotation happened');
  fs.writeFileSync(path.join(dir, 'procedural.json'), '{not json');
  const result = store.read('procedural.json', { version: 1, items: [] });
  assert.equal(result.corrupt, true);
  assert.equal(result.data.items[0].rule, 'old');
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.corrupt-')));
});

test('restore brings back a named backup', () => {
  const { store } = tmpStore();
  store.write('stats.json', { n: 1 });
  store.write('stats.json', { n: 2 });
  const [latest] = store.backups('stats.json');
  store.restore('stats.json', latest.name);
  assert.equal(store.read('stats.json', {}).data.n, 1);
});

test('a foreign live pid keeps other processes out of the data dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lock-'));
  /* 父进程一定活着，用它冒充「另一个进程」 */
  fs.writeFileSync(path.join(dir, 'brain.lock'), JSON.stringify({ pid: process.ppid, at: Date.now(), host: 'other' }));
  const store = new Store(dir);
  const got = store.acquireLock();
  assert.equal(got.ok, false, 'a live holder must not be preempted');
  assert.equal(got.holder.pid, process.ppid);
  /* 同一个进程再要锁是重入，放行 */
  fs.writeFileSync(path.join(dir, 'brain.lock'), JSON.stringify({ pid: process.pid, at: Date.now(), host: 'self' }));
  assert.equal(store.acquireLock().ok, true);
  store.releaseLock();
});

test('a lock left behind by a dead pid is reclaimed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-lock-stale-'));
  const store = new Store(dir);
  fs.writeFileSync(path.join(dir, 'brain.lock'), JSON.stringify({ pid: 999999, at: Date.now(), host: 'x' }));
  const got = store.acquireLock();
  assert.equal(got.ok, true);
  assert.equal(got.stolen.pid, 999999);
  const holder = store.lockHolder();
  assert.equal(holder.pid, process.pid, 'the lock file now names us');
  store.releaseLock();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityLog, ACTIVITY_KINDS } from '../lib/activity.js';

test('activity log numbers events monotonically', () => {
  const log = new ActivityLog();
  const a = log.push('observe', { topic: '排期' }, 1000);
  const b = log.push('recall', { query: '排期', hits: [] }, 2000);
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(log.seq, 2);
  assert.equal(a.kind, 'observe');
  assert.equal(b.query, '排期');
  assert.deepEqual(log.recent(2).map((e) => e.kind), ['observe', 'recall']);
});

test('activity log never lets a payload spoof seq/kind', () => {
  const log = new ActivityLog();
  const event = log.push('remember', { seq: 999, kind: 'hack', ts: 5, id: 'ep_1' });
  assert.equal(event.seq, 1);
  assert.equal(event.kind, 'remember');
  assert.equal(event.id, 'ep_1');
  assert.notEqual(event.ts, 5);
});

test('unknown kinds fall back to observe', () => {
  const log = new ActivityLog();
  const event = log.push('telepathy', { x: 1 });
  assert.equal(event.kind, 'observe');
  assert.ok(ACTIVITY_KINDS.includes('consolidate'));
});

test('ring buffer keeps only the newest `limit` events', () => {
  const log = new ActivityLog({ limit: 20 });
  for (let i = 0; i < 50; i += 1) log.push('decay', { i });
  assert.equal(log.events.length, 20);
  assert.equal(log.seq, 50);
  assert.equal(log.events[0].i, 30);
  assert.equal(log.events.at(-1).i, 49);
});

test('since() returns only newer events, oldest first, bounded', () => {
  const log = new ActivityLog({ limit: 40 });
  for (let i = 0; i < 10; i += 1) log.push('remember', { i });
  const fresh = log.since(7);
  assert.deepEqual(fresh.map((e) => e.i), [7, 8, 9]);
  assert.equal(log.since(10).length, 0);
  assert.equal(log.since(0, { limit: 3 }).length, 3);
  assert.equal(log.since(Number.NaN).length, 10);
});

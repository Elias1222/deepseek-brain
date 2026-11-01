import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityLog } from '../lib/activity.js';

test('subscribers receive every new event, and can unsubscribe', () => {
  const log = new ActivityLog({ limit: 20 });
  const seen = [];
  const off = log.subscribe((ev) => seen.push(ev.seq + ':' + ev.kind));
  assert.equal(log.subscriberCount, 1);

  log.push('observe', { text: '一' });
  log.push('remember', { id: 'ep_1' });
  assert.deepEqual(seen, ['1:observe', '2:remember']);

  off();
  assert.equal(log.subscriberCount, 0);
  log.push('forget', { id: 'ep_1' });
  assert.deepEqual(seen, ['1:observe', '2:remember'], 'nothing arrives after unsubscribe');
});

test('a throwing subscriber does not stop the others or the write', () => {
  const log = new ActivityLog({ limit: 20 });
  const good = [];
  log.subscribe(() => { throw new Error('boom'); });
  log.subscribe((ev) => good.push(ev.kind));

  const event = log.push('recall', { query: '测试' });
  assert.equal(event.seq, 1);
  assert.deepEqual(good, ['recall']);
  assert.equal(log.recent(1)[0].kind, 'recall');
});

test('replay after reconnect covers exactly the missed window', () => {
  const log = new ActivityLog({ limit: 20 });
  log.push('observe', { text: 'a' });
  log.push('observe', { text: 'b' });
  const cursor = log.seq;
  log.push('remember', { id: 'ep_1' });
  log.push('remember', { id: 'ep_2' });

  const missed = log.since(cursor);
  assert.equal(missed.length, 2);
  assert.deepEqual(missed.map((e) => e.id), ['ep_1', 'ep_2']);
  assert.equal(log.since(log.seq).length, 0, 'nothing to replay when caught up');
});

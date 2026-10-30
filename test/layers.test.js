import test from 'node:test';
import assert from 'node:assert/strict';
import { SensoryBuffer, estimateImportance, extractEntities, shouldRemember } from '../lib/sensory.js';
import { WorkingMemory, detectTopic, isSmallTalk } from '../lib/working.js';
import { createEpisodic, decay, strengthOf } from '../lib/episodic.js';
import { SemanticMemory } from '../lib/semantic.js';
import { ProceduralMemory } from '../lib/procedural.js';
import { consolidate } from '../lib/consolidation.js';
import { recall } from '../lib/retrieval.js';
import { displayWidth, renderBrain } from '../lib/render.js';
import { toMarkdown } from '../lib/snapshot.js';

test('sensory extracts people, times, places, emotions', () => {
  const e = extractEntities('明天下午三点和张伟在望京开会，有点焦虑');
  assert.deepEqual(e.people, ['张伟']);
  assert.ok(e.times.some((t) => t.includes('明天')));
  assert.ok(e.places.includes('望京'));
  assert.deepEqual(e.emotions, ['焦虑']);
  assert.ok(e.valence < 0);
});

test('sensory buffer drops expired traces and respects capacity', () => {
  const buf = new SensoryBuffer({ capacity: 3, ttlMs: 2000 });
  const t0 = 1_000_000;
  buf.ingest('你好', t0);
  buf.ingest('嗯', t0);
  buf.ingest('今天天气不错，随便聊聊', t0);
  assert.equal(buf.items.length, 3);
  assert.equal(buf.sweep(t0 + 2001).length, 3);
  assert.equal(buf.items.length, 0);
  buf.ingest('a', t0);
  buf.ingest('b', t0);
  buf.ingest('c', t0);
  buf.ingest('d', t0);
  assert.equal(buf.items.length, 3);
  assert.equal(buf.items[0].text, 'b');
});

test('attention gate rejects greetings and accepts facts', () => {
  assert.equal(shouldRemember('你好').keep, false);
  assert.equal(shouldRemember('嗯').keep, false);
  assert.equal(shouldRemember('明天下午三点和张伟在望京开会').keep, true);
  assert.ok(estimateImportance('明天下午三点和张伟在望京开会', extractEntities('明天下午三点和张伟在望京开会')) >= 4);
});

test('working memory keeps a bounded LIFO topic stack', () => {
  const wm = new WorkingMemory({ capacity: 4 });
  for (const t of ['A', 'B', 'C', 'D', 'E']) wm.push(t);
  assert.equal(wm.stack.length, 4);
  assert.equal(wm.peek().title, 'E');
  wm.push('B');
  assert.equal(wm.peek().title, 'B');
  assert.equal(wm.stack.length, 4);
  wm.pop();
  assert.equal(wm.peek().title, 'E');
});

test('topic detection prefers content words', () => {
  assert.ok(detectTopic('我们明天讨论记忆衰减的算法').includes('记忆'));
  assert.equal(detectTopic('项目排期'), '项目排期');
});

test('greetings never take a topic slot', () => {
  assert.equal(isSmallTalk('你好！'), true);
  assert.equal(isSmallTalk('好的。'), true);
  assert.equal(isSmallTalk('明天三点和张伟开会'), false);
  const wm = new WorkingMemory({ capacity: 4 });
  wm.push('项目排期');
  // observe() skips push for small talk, so the real focus stays on top
  if (!isSmallTalk('嗯')) wm.push(detectTopic('嗯'));
  assert.equal(wm.peek().title, '项目排期');
});

test('episodic strength follows exponential decay and pinning', () => {
  const now = Date.UTC(2026, 0, 10);
  const item = createEpisodic({ event: '会议', importance: 4, ts: new Date(now - 10 * 86_400_000).toISOString() });
  const s = strengthOf(item, 0.05, now);
  assert.ok(Math.abs(s - 4 * Math.exp(-0.5)) < 0.01);
  const { forgotten } = decay([item], { lambda: 0.5, threshold: 0.5, now });
  assert.equal(forgotten.length, 0, 'importance>=4 is never forgotten');
  const weak = createEpisodic({ event: '小事', importance: 1, ts: new Date(now - 30 * 86_400_000).toISOString() });
  const second = decay([weak], { lambda: 0.5, threshold: 0.5, now });
  assert.equal(second.forgotten.length, 1);
  assert.ok(second.forgotten[0].strength < 0.5);
});

test('semantic memory merges aliases and keeps corrected history', () => {
  const sem = new SemanticMemory();
  sem.add({ subject: '用户', relation: '职业', object: '设计师', importance: 4 });
  const { corrected } = sem.add({ subject: '用户', relation: '职业', object: '产品设计师', importance: 5 });
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].status, 'corrected');
  const history = sem.history('用户', '职业');
  assert.equal(history.length, 2);
  assert.equal(history[0].object, '产品设计师');
  sem.add({ subject: '张总', relation: '身份', object: '项目经理', importance: 4 });
  sem.mergeAlias('张总', '张伟');
  assert.equal(sem.resolve('张总'), '张伟');
  const dup = sem.add({ subject: '张伟', relation: '身份', object: '项目经理' });
  assert.equal(dup.duplicate, true);
});

test('procedural memory deduplicates rules and grows strength on use', () => {
  const pro = new ProceduralMemory();
  pro.add({ rule: '回答先给结论' });
  const again = pro.add({ rule: '回答先给结论。' });
  assert.equal(again.duplicate, true);
  assert.equal(pro.items.length, 1);
  const before = pro.items[0].strength;
  pro.touch(pro.items[0].id);
  assert.ok(pro.items[0].strength >= before);
});

test('consolidation promotes important memories and digests weak ones', () => {
  const now = Date.UTC(2026, 2, 1);
  const old = (days, importance, event) =>
    createEpisodic({ event, importance, ts: new Date(now - days * 86_400_000).toISOString() });
  const items = [
    old(10, 5, '重要会议'),
    old(10, 1, '吃了面包'),
    old(10, 1, '买了一杯咖啡'),
    old(0.1, 3, '刚刚发生'),
  ];
  const result = consolidate(items, { lambda: 0.3, threshold: 0.5, now, minAgeHours: 6 });
  assert.equal(result.report.migrated, 1);
  assert.equal(result.report.pruned, 2);
  assert.equal(result.report.digests, 1);
  assert.ok(result.items.some((it) => it.source === 'consolidated'));
});

test('retrieval ranks keyword matches and reports score parts', () => {
  const now = Date.now();
  const state = {
    lambda: 0.05,
    now,
    episodic: [
      createEpisodic({ event: '和张伟讨论排期', importance: 5, ts: new Date(now - 86_400_000).toISOString() }),
      createEpisodic({ event: '买了猫粮', importance: 2, ts: new Date(now - 86_400_000).toISOString() }),
    ],
    semantic: [],
    procedural: [],
    working: [],
    sensory: [],
  };
  const result = recall(state, '张伟 排期');
  assert.ok(result.hits.length >= 1);
  assert.ok(result.hits[0].title.includes('张伟'));
  assert.ok(result.hits[0].parts.keyword > 0);
  assert.ok(typeof result.hits[0].score === 'number');
});

test('ascii brain renders aligned frames with all five layers', () => {
  const now = Date.now();
  const text = renderBrain({
    lambda: 0.05,
    now,
    working: [{ id: 'w1', title: '项目排期', ts: new Date(now).toISOString() }],
    episodic: [{ id: 'e1', event: '会议延期', importance: 4, strength: 3.4, ts: new Date(now).toISOString() }],
    semantic: [{ id: 's1', subject: '用户', relation: '职业', object: '设计师', status: 'active' }],
    procedural: [{ id: 'p1', rule: '先给结论', strength: 3 }],
    sensory: [{ id: 'x1', text: '明天三点开会', entities: { people: ['张伟'], times: ['明天'], places: [] } }],
    stats: { forgotten: 2, consolidated: 1 },
  });
  for (const label of ['工作记忆', '情景记忆', '语义记忆', '程序记忆', '感觉记忆', '记忆健康面板']) {
    assert.ok(text.includes(label), `missing section ${label}`);
  }
  const widths = text.split('\n').filter((line) => line.startsWith('│')).map((line) => displayWidth(line));
  assert.ok(widths.every((w) => w === widths[0]), 'ASCII table rows should share one display width');
});

test('markdown snapshot contains every section and is portable', () => {
  const md = toMarkdown({
    lambda: 0.05,
    now: Date.now(),
    episodic: [createEpisodic({ event: '会议延期', importance: 4, detail: '细节' })],
    semantic: [{ id: 's1', subject: '用户', relation: '职业', object: '设计师', status: 'active', importance: 4, ts: new Date().toISOString() }],
    procedural: [{ id: 'p1', rule: '先给结论', importance: 3, strength: 3, hits: 1, ts: new Date().toISOString() }],
    stats: { forgotten: 1, consolidated: 2 },
    aliases: { 张总: '张伟' },
  });
  assert.ok(md.startsWith('# DeepSeek Brain'));
  assert.ok(md.includes('## 语义记忆'));
  assert.ok(md.includes('## 情景记忆'));
  assert.ok(md.includes('## 程序记忆'));
  assert.ok(md.includes('已修正') || md.includes('有效'));
});

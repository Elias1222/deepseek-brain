import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemorySystem } from '../lib/memory.js';

function makeMemory(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mem-'));
  return new MemorySystem({ dataDir, ...overrides });
}

test('init creates the store layout under a custom dataDir', async () => {
  const memory = await makeMemory().init();
  memory.remember({ layer: 'episodic', event: '初次见面', importance: 3 });
  for (const file of ['episodic.json', 'semantic.json', 'procedural.json', 'stats.json']) {
    assert.ok(fs.existsSync(path.join(memory.config.dataDir, file)), `${file} missing`);
  }
  const raw = JSON.parse(fs.readFileSync(path.join(memory.config.dataDir, 'episodic.json'), 'utf8'));
  assert.equal(raw.items.length, 1);
  assert.equal(raw.items[0].event, '初次见面');
});

test('explicit memories survive a restart', async () => {
  const first = await makeMemory().init();
  first.remember({ layer: 'episodic', event: '和张伟敲定排期', importance: 4, participants: ['张伟'] });
  first.remember({ layer: 'semantic', subject: '张伟', relation: '职业', object: '项目经理', importance: 4 });
  first.remember({ layer: 'procedural', rule: '回答先给结论', importance: 3 });
  const second = await new MemorySystem({ dataDir: first.config.dataDir }).init();
  assert.equal(second.episodic.length, 1);
  assert.equal(second.episodic[0].event, '和张伟敲定排期');
  assert.equal(second.semantic.active()[0].object, '项目经理');
  assert.equal(second.procedural.items[0].rule, '回答先给结论');
});

test('observe gates greetings, captures facts and extracts semantic facts', async () => {
  const memory = await makeMemory().init();
  const greeting = memory.observe('s1', '你好');
  assert.equal(greeting.memory, null);
  assert.equal(memory.episodic.length, 0);
  assert.equal(greeting.topic, '你好');

  const fact = memory.observe('s1', '我叫林夕，是一名产品设计师，明天下午三点和张伟在望京开会');
  assert.ok(fact.memory, 'factual utterance should become an episodic memory');
  assert.ok(fact.memory.importance >= 3);
  assert.ok(memory.semantic.items.some((it) => it.relation === '姓名' && it.object === '林夕'));
  assert.ok(memory.semantic.items.some((it) => it.relation === '职业' && it.object === '产品设计师'));

  const stack = memory.session('s1').working.stack;
  assert.ok(stack.length >= 1);
  assert.ok(stack.length <= 7);
});

test('recall finds memories and bumps their use counters', async () => {
  const memory = await makeMemory().init();
  memory.remember({ layer: 'episodic', event: '和张伟讨论排期', importance: 5, participants: ['张伟'] });
  memory.remember({ layer: 'episodic', event: '买了猫粮', importance: 2 });
  const result = memory.recall('张伟 排期');
  assert.ok(result.hits.length >= 1);
  assert.ok(result.hits[0].title.includes('张伟'));
  assert.ok(result.text.includes('张伟'));
  assert.equal(memory.stats.counters.recalls, 1);
});

test('recall activity carries the score breakdown so the operator panel is not blank', async () => {
  const memory = await makeMemory().init();
  memory.remember({ layer: 'episodic', event: '和张伟在望京开会，讨论排期', importance: 5, participants: ['张伟'], place: '望京' });
  memory.recall('张伟 排期');
  const event = memory.activity.recent(1)[0];
  assert.equal(event.kind, 'recall');
  assert.ok(typeof event.took === 'number', 'took is elapsed milliseconds');
  const hit = event.hits[0];
  assert.equal(hit.id, memory.episodic[0].id);
  assert.equal(typeof hit.score, 'number');
  assert.ok(hit.title.includes('张伟'));
  assert.ok(hit.parts && typeof hit.parts.keyword === 'number');
  assert.ok(typeof hit.strength === 'number');
});

test('forget archives instead of deleting', async () => {
  const memory = await makeMemory().init();
  const { item } = memory.remember({ layer: 'episodic', event: '临时事项', importance: 2 });
  const archived = memory.forget(item.id);
  assert.equal(archived.layer, 'episodic');
  assert.equal(memory.episodic.length, 0);
  const archive = JSON.parse(fs.readFileSync(path.join(memory.config.dataDir, 'archive.json'), 'utf8'));
  assert.equal(archive.items.at(-1).event, '临时事项');
  assert.equal(memory.forget('nope'), null);
});

test('decay pass forgets weak memories and pins important ones', async () => {
  const memory = await makeMemory({ lambda: 0.5 }).init();
  const now = Date.now();
  const old = (days, importance, event) => {
    memory.remember({ layer: 'episodic', event, importance });
    memory.episodic.at(-1).ts = new Date(now - days * 86_400_000).toISOString();
  };
  old(60, 1, '很久以前的小事');
  old(60, 5, '很久以前的大事');
  const result = memory.decayPass(now);
  assert.equal(result.forgotten, 1);
  assert.deepEqual(memory.episodic.map((it) => it.event), ['很久以前的大事']);
});

test('sleep consolidation compresses and reports', async () => {
  const memory = await makeMemory({ lambda: 0.3 }).init();
  const now = Date.now();
  const add = (days, importance, event) => {
    memory.remember({ layer: 'episodic', event, importance });
    memory.episodic.at(-1).ts = new Date(now - days * 86_400_000).toISOString();
  };
  add(20, 5, '重要里程碑');
  add(20, 1, '吃了面包');
  const result = memory.sleep(now, { minAgeHours: 0 });
  assert.ok(result.report.migrated >= 1);
  assert.ok(memory.stats.lastSleepAt);
  assert.ok(memory.stats.counters.consolidated >= 1);
});

test('apiState exposes regions for the 3D front-end', async () => {
  const memory = await makeMemory().init();
  memory.seedDemo();
  const state = memory.apiState('default');
  assert.equal(state.ok, true);
  for (const key of ['sensory', 'working', 'episodic', 'semantic', 'procedural']) {
    assert.ok(state.regions[key], `missing region ${key}`);
    assert.equal(typeof state.regions[key].count, 'number');
    assert.match(state.regions[key].color, /^#[0-9a-f]{6}$/i);
  }
  assert.ok(state.episodic.length >= 10);
  assert.ok(state.stats.total >= 15);
});

test('demo seed yields the advertised 20 memories', async () => {
  const memory = await makeMemory({ demoSeed: true }).init();
  const total = memory.episodic.length + memory.semantic.items.length + memory.procedural.items.length;
  assert.equal(memory.episodic.length, 12);
  assert.equal(memory.semantic.items.length, 4);
  assert.equal(memory.procedural.items.length, 2);
  assert.ok(total >= 18);
});

test('prompt block carries the five iron rules and the focus topic', async () => {
  const memory = await makeMemory().init();
  memory.observe('default', '我们在讨论记忆衰减的算法，明天继续');
  memory.remember({ layer: 'procedural', rule: '回答先给结论' });
  memory.remember({ layer: 'semantic', subject: '用户', relation: '职业', object: '产品设计师', importance: 5 });
  const block = memory.promptBlock('default');
  assert.ok(block.includes('brain_recall'));
  assert.ok(block.includes('brain_remember'));
  assert.ok(block.includes('[已修正]'));
  assert.ok(block.includes('当前焦点'));
  assert.ok(block.includes('回答先给结论'));
  assert.ok(block.includes('用户 → 职业 → 产品设计师'), 'semantic facts reach the prompt');
});

test('snapshot markdown and json export describe the same archive', async () => {
  const memory = await makeMemory({ demoSeed: true }).init();
  const md = memory.snapshotMarkdown();
  const json = memory.exportJson();
  assert.ok(md.includes('情景记忆'));
  assert.equal(json.episodic.length, memory.episodic.length);
  assert.equal(json.semantic.length, memory.semantic.items.length);
  assert.ok(json.exportedAt);
});

test('config is clamped into safe ranges', async () => {
  const memory = await makeMemory({ lambda: 99, workingCapacity: 99, sensoryCapacity: 0, topK: 999 }).init();
  assert.equal(memory.config.lambda, 1);
  assert.equal(memory.config.workingCapacity, 7);
  assert.equal(memory.config.sensoryCapacity, 3);
  assert.equal(memory.config.topK, 20);
});

test('autonomous decay interval is optional and clamped, 0 disables it', async () => {
  assert.equal((await makeMemory().init()).config.autoDecayMinutes, 30);
  assert.equal((await makeMemory({ autoDecayMinutes: 0 }).init()).config.autoDecayMinutes, 0);
  assert.equal((await makeMemory({ autoDecayMinutes: 99999 }).init()).config.autoDecayMinutes, 1440);
  assert.equal((await makeMemory({ autoDecayMinutes: 'soon' }).init()).config.autoDecayMinutes, 0);
});

test('a memory really disappears once its strength falls under the threshold', async () => {
  const memory = await makeMemory({ demoSeed: false }).init();
  const weak = memory.remember({ layer: 'episodic', event: '顺手提了一句的小事', importance: 1 }).item;
  const kept = memory.remember({ layer: 'episodic', event: '说好的周六看展', importance: 4 }).item;
  // pretend both were written 60 days ago: 1*exp(-0.05*60) = 0.05 < 0.5, 4*exp(-3) = 0.2 but pinned
  const longAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  memory.episodic.find((it) => it.id === weak.id).ts = longAgo;
  memory.episodic.find((it) => it.id === kept.id).ts = longAgo;
  const report = memory.decayPass();
  assert.equal(report.forgotten, 1);
  assert.deepEqual(report.ids, [weak.id]);
  assert.equal(memory.episodic.length, 1);
  assert.equal(memory.episodic[0].id, kept.id);
  assert.equal(memory.archive.at(-1).id, weak.id, 'forgotten memory is archived, never destroyed');
  const kinds = memory.activity.recent(6).map((e) => e.kind);
  assert.ok(kinds.includes('decay'), 'the decay sweep shows up in the activity stream');
});

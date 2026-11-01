import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFacts, learnGenders } from '../lib/extract.js';
import { MemorySystem } from '../lib/memory.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brain-pronoun-'));
}

test('learnGenders reads the evidence out of a sentence', () => {
  const got = learnGenders('张伟，他下周来；李雪说她也在');
  const map = Object.fromEntries(got.map((g) => [g.name, g.gender]));
  assert.equal(map['张伟'], 'm');
  assert.equal(map['李雪'], 'f');
});

test('a cross-sentence pronoun binds only when gender evidence matches', () => {
  const context = { people: [{ name: '李雪', gender: 'f' }] };
  const bound = extractFacts('她是我的老板', { context });
  assert.equal(bound.facts.length, 1);
  assert.equal(bound.facts[0].subject, '李雪');
  assert.equal(bound.facts[0].boundFrom, 'context');
  assert.ok(bound.facts[0].importance <= 3, 'inferred facts must not carry full weight');

  const mismatched = extractFacts('她是我的老板', { context: { people: [{ name: '张伟', gender: 'm' }] } });
  assert.equal(mismatched.facts.length, 0);
  assert.equal(mismatched.unbound[0].reason, 'no-gender-evidence');
});

test('observe learns gender from one turn and uses it on the next', async () => {
  const memory = await new MemorySystem({ dataDir: tempDir() }).init();

  await memory.observe('default', '李雪，她是我同事');
  assert.equal(memory.genders.get('李雪'), 'f');

  const second = await memory.observe('default', '她昨天把我的方案改完了，她是我的老板');
  const hit = second.facts.find((f) => f.object === '老板');
  assert.ok(hit, 'the second turn should produce a 老板 fact');
  assert.equal(hit.subject, '李雪');
  assert.equal(hit.boundFrom, 'context');
});

test('without any gender evidence the pronoun stays unbound', async () => {
  const memory = await new MemorySystem({ dataDir: tempDir() }).init();
  await memory.observe('default', '张伟下周来');
  const res = await memory.observe('default', '她是我的老板');
  assert.equal(res.facts.length, 0);
  assert.equal(res.unbound.length, 1);
  assert.equal(res.unbound[0].pronoun, '她');
  assert.equal(memory.semantic.items.length, 0, 'nothing is written when the pronoun is unresolved');
});

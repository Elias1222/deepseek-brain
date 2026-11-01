import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFacts } from '../lib/extract.js';

const facts = (text) => extractFacts(text).facts;
const pairs = (text) => facts(text).map((f) => `${f.subject}|${f.relation}|${f.object}`);

test('a self introduction yields name and job in one pass', () => {
  assert.deepEqual(pairs('我叫林夕，是一名产品设计师'), [
    '用户|姓名|林夕',
    '用户|职业|产品设计师',
  ]);
});

test("a third party's job is not recorded as the user's", () => {
  assert.deepEqual(pairs('李雪是老师'), []);
  assert.deepEqual(pairs('张伟是同事'), ['张伟|身份|同事']);
});

test('family members are linked by name', () => {
  assert.deepEqual(pairs('我妈叫李雪'), ['妈|姓名|李雪']);
});

test('quantifiers stay out of the object', () => {
  assert.deepEqual(pairs('我养了一只猫'), ['用户|宠物|猫']);
  assert.deepEqual(pairs('我养了一只橘猫'), ['用户|宠物|橘猫']);
});

test('questions never become facts', () => {
  assert.deepEqual(facts('你是设计师吗'), []);
  assert.deepEqual(facts('我住在北京吗？'), []);
});

test('place, age and preferences are separate relations', () => {
  assert.deepEqual(pairs('我住在北京'), ['用户|居住地|北京']);
  assert.deepEqual(pairs('我今年28岁'), ['用户|年龄|28']);
  assert.deepEqual(pairs('我喜欢黑咖啡'), ['用户|喜欢|黑咖啡']);
  assert.deepEqual(pairs('我不喜欢开会'), ['用户|不喜欢|开会']);
});

test('reminders go to procedural memory instead of the fact table', () => {
  const out = extractFacts('记住：回答先给结论');
  assert.deepEqual(out.facts, []);
  assert.equal(out.rules.length, 1);
  assert.equal(out.rules[0].rule, '回答先给结论');
});

test('pronouns and filler never land in an object', () => {
  assert.deepEqual(facts('我喜欢这个'), []);
  assert.deepEqual(facts(''), []);
});

test('the same fact is not emitted twice in one sentence', () => {
  const out = facts('我是产品设计师，也是产品设计师');
  assert.equal(out.length, 1);
});

test('a pronoun subject is bound to the person named earlier in the sentence', () => {
  assert.deepEqual(pairs('张伟说他下周来，他是我的同事'), ['张伟|身份|同事']);
});

test('a pronoun with no antecedent is dropped, not guessed', () => {
  const out = extractFacts('她是我的老板');
  assert.deepEqual(out.facts, []);
  assert.equal(out.unbound.length, 1);
  assert.equal(out.unbound[0].pronoun, '她');
});

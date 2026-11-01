import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DEEPSEEK_BRAIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-plugin-env-'));

const plugin = await import('../lib/index.js');

const ALLOWED_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples']);
const ALLOWED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function assertSchema(node, trail = 'schema') {
  assert.ok(node && typeof node === 'object', `${trail} must be an object`);
  for (const [key, value] of Object.entries(node)) {
    assert.ok(ALLOWED_KEYWORDS.has(key), `${trail} uses unsupported keyword "${key}"`);
    if (key === 'type') assert.ok(ALLOWED_TYPES.has(value), `${trail} has unsupported type ${value}`);
    if (key === 'properties') {
      for (const [name, child] of Object.entries(value)) assertSchema(child, `${trail}.properties.${name}`);
    }
    if (key === 'items') assertSchema(value, `${trail}.items`);
    if (key === 'oneOf') value.forEach((child, i) => assertSchema(child, `${trail}.oneOf[${i}]`));
  }
}

function fakeContext() {
  const tools = new Map();
  const contexts = [];
  const listeners = new Map();
  const injections = [];
  const effects = [];
  const ctx = {
    tools: { register: (definition) => tools.set(definition.name, definition) },
    systemPrompt: { context: (definition) => contexts.push(definition) },
    on: (event, handler) => listeners.set(event, handler),
    inject: (deps, callback) => {
      injections.push(deps);
      return callback({
        effect: (fn) => effects.push(fn),
        webServer: {
          register: () => () => {},
          getOrigin: () => 'http://127.0.0.1:58400',
        },
      });
    },
    effect: (fn) => effects.push(fn),
  };
  const dispose = () => {
    for (const fn of effects.splice(0)) {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanup();
    }
  };
  return { ctx, tools, contexts, listeners, injections, effects, dispose };
}

async function boot(config = {}) {
  const fake = fakeContext();
  const instance = plugin.apply(fake.ctx, { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'brain-boot-')), ...config });
  await instance.ready;
  return { ...fake, memory: instance.memory };
}

test('plugin exports the cordis contract', () => {
  assert.equal(plugin.name, 'deepseek-brain');
  assert.deepEqual(plugin.inject, ['tools', 'systemPrompt']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers seven tools with DSH-supported schemas', async () => {
  const fake = await boot();
  try {
    assert.equal(fake.contexts.length, 1);
    assert.equal(fake.contexts[0].order, 130);
    assert.equal(fake.contexts[0].interpolate, false);
    assert.ok(fake.listeners.has('session/event'));
    assert.ok(fake.injections.some((deps) => deps.includes('webServer')));

    const expected = [
      'brain_remember',
      'brain_recall',
      'brain_visualize',
      'brain_update',
      'brain_forget',
      'brain_history',
      'brain_conflicts',
      'brain_restore',
      'brain_import',
      'brain_prune_conflicts',
      'brain_sleep',
      'brain_snapshot',
      'brain_dashboard',
    ];
    assert.deepEqual([...fake.tools.keys()].sort(), [...expected].sort());
    for (const definition of fake.tools.values()) {
      assert.ok(definition.description.length > 20, `${definition.name} needs a model-facing description`);
      assert.equal(typeof definition.execute, 'function');
      assert.equal(definition.output.schema.type, 'object');
      assertSchema(definition.parameters ?? { type: 'object' });
      assertSchema(definition.output.schema);
      assert.equal(typeof definition.output.render, 'function');
      assert.equal(definition.output.render({}, { text: 'ok' }), 'ok');
    }
  } finally {
    fake.dispose();
  }
});

test('tools work end to end through the fake context', async () => {
  const fake = await boot();
  const exec = { agent: { session: { id: 'session-1' } } };
  try {
    const remembered = await fake.tools.get('brain_remember').execute(
      { layer: 'episodic', event: '和张伟确认了 3D 大脑方案', importance: 5, participants: ['张伟'] },
      exec,
    );
    assert.match(remembered.text, /已写入情景记忆/);

    const recalled = await fake.tools.get('brain_recall').execute({ query: '3D 大脑 方案', topK: 5 }, exec);
    assert.match(recalled.text, /3D/);

    const visualized = await fake.tools.get('brain_visualize').execute({}, exec);
    assert.match(visualized.text, /工作记忆/);
    assert.match(visualized.text, /记忆健康面板/);

    const snapshot = await fake.tools.get('brain_snapshot').execute({ format: 'markdown' }, exec);
    assert.match(snapshot.text, /已导出 Markdown 记忆档案/);

    const dashboard = await fake.tools.get('brain_dashboard').execute({}, exec);
    assert.match(dashboard.text, /dashboard\.html/);
    assert.match(dashboard.text, /brain-3d\.html/);

    const slept = await fake.tools.get('brain_sleep').execute({ minAgeHours: 0 }, exec);
    assert.ok(slept.text.length > 0);
  } finally {
    fake.dispose();
  }
});

test('unknown memory ids are reported, not thrown', async () => {
  const fake = await boot();
  try {
    const result = await fake.tools.get('brain_forget').execute({ id: 'does-not-exist' });
    assert.match(result.text, /未找到/);
  } finally {
    fake.dispose();
  }
});

test('session/event captures user messages into memory', async () => {
  const fake = await boot();
  try {
    const handler = fake.listeners.get('session/event');
    handler({ id: 'sess-9' }, { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '明天下午三点和张伟在望京开会' }] } });
    handler({ id: 'sess-9' }, { type: 'assistant/message', data: { role: 'assistant', content: [] } });
    assert.equal(fake.memory.episodic.length, 1);
    assert.ok(fake.memory.session('sess-9').working.stack.length >= 1);
  } finally {
    fake.dispose();
  }
});

test('system prompt block is generated for a session', async () => {
  const fake = await boot();
  try {
    const block = fake.contexts[0].text({ agent: { session: { id: 'session-x' } } });
    assert.ok(block.includes('brain_recall'));
    assert.ok(block.includes('铁律'));
  } finally {
    fake.dispose();
  }
});

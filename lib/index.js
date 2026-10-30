import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemorySystem, VERSION } from './memory.js';
import { createHandler } from './server.js';

export const name = 'deepseek-brain';
export const inject = ['tools', 'systemPrompt'];

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const BASE = '/deepseek-brain';

const TEXT_OUTPUT = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render: (_args, value) => value.text,
};

const LAYER_ENUM = ['episodic', 'semantic', 'procedural'];

function sessionIdOf(exec) {
  return exec?.agent?.session?.id ?? 'default';
}

function errorText(error) {
  return `操作失败：${error?.message ?? String(error)}`;
}

/** Extract plain text from a session `user/message` event payload. */
function messageText(event) {
  const data = event?.data;
  if (!data) return '';
  if (typeof data.text === 'string') return data.text;
  const content = data.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

export function apply(ctx, config = {}) {
  const memory = new MemorySystem(config);
  const ready = memory.init().catch((error) => {
    memory.warnings.push(`initialisation failed: ${error?.message ?? error}`);
    throw error;
  });
  const awaitReady = () => ready;

  let standalone = null;
  let webOrigin = null;

  ctx.effect(() => () => {
    if (standalone) standalone.server.close();
  });

  // --- tools ---------------------------------------------------------------
  ctx.tools.register({
    name: 'brain_remember',
    description:
      'Write a durable memory into the persistent brain. Use layer "episodic" for time-stamped events (who/when/where/emotion/importance), ' +
      '"semantic" for durable facts as subject→relation→object (names, jobs, preferences, plans), "procedural" for rules and habits that should ' +
      'become default behaviour. Call this whenever the user states a name, date, promise, preference or correction instead of relying on the transcript.',
    parameters: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: LAYER_ENUM, description: 'Which memory layer stores it.' },
        event: { type: 'string', description: 'episodic: what happened, one short sentence.' },
        participants: { type: 'array', items: { type: 'string' }, description: 'episodic: people involved.' },
        place: { type: 'string', description: 'episodic: where it happened.' },
        emotion: { type: 'string', description: 'episodic: emotional tone, e.g. 焦虑 / 兴奋.' },
        detail: { type: 'string', description: 'episodic: extra detail, will be compressed during sleep consolidation.' },
        importance: { type: 'integer', description: '1-5; ≥4 is never forgotten, ≤2 decays away.' },
        subject: { type: 'string', description: 'semantic: entity, e.g. 用户 or 张伟.' },
        relation: { type: 'string', description: 'semantic: relation, e.g. 职业 / 喜欢 / 生日.' },
        object: { type: 'string', description: 'semantic: value, e.g. 产品设计师.' },
        rule: { type: 'string', description: 'procedural: the rule or habit to remember.' },
        ts: { type: 'string', description: 'optional ISO timestamp (defaults to now).' },
      },
      required: ['layer'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      try {
        await awaitReady();
        const result = memory.remember(args);
        return { text: `${result.text}\n记忆文件：${memory.config.dataDir}` };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_recall',
    description:
      'Search the persistent brain before answering anything that may depend on past context. Ranks by keyword match + importance + time decay ' +
      '(and optional vector recall). Returns the best K memories with a transparent score breakdown. Never claim to remember something this tool did not return.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in natural language or keywords.' },
        topK: { type: 'integer', description: 'How many memories to return (1-20, default 6).' },
        layers: { type: 'array', items: { type: 'string', enum: ['sensory', 'working', 'episodic', 'semantic', 'procedural'] }, description: 'Restrict layers.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const result = memory.recall(args.query, { sessionId: sessionIdOf(exec), topK: args.topK, layers: args.layers });
        return { text: result.text };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_visualize',
    description: 'Render the current brain as an ASCII map: working-memory topic stack, recent episodic memories with strength, semantic triples, procedural rules, sensory buffer, plus a health panel (totals, new this week, forgotten/compressed, active topics).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: TEXT_OUTPUT,
    async execute(_args, exec) {
      try {
        await awaitReady();
        return { text: memory.visualize(sessionIdOf(exec)) };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_forget',
    description: 'Archive one memory by id (soft delete: it moves to archive.json and can be inspected later, never physically deleted).',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory id from brain_recall / brain_visualize.' } },
      required: ['id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      try {
        await awaitReady();
        const result = memory.forget(args.id);
        if (!result) return { text: `未找到 id 为 ${args.id} 的记忆。` };
        return { text: `已归档 ${result.layer} 记忆 ${args.id}（保留在 archive.json，可复查）。` };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_sleep',
    description: 'Run sleep-like consolidation now: promote important memories to long-term, compress low-value detail, fold weak memories into daily digests, and prune what has decayed below threshold. Returns a migration report.',
    parameters: {
      type: 'object',
      properties: { minAgeHours: { type: 'number', description: 'Only consolidate memories older than this (default 0 for a manual run).' } },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      try {
        await awaitReady();
        const decayed = memory.decayPass();
        const result = memory.sleep(Date.now(), { minAgeHours: args.minAgeHours ?? 0 });
        const decayLine = decayed.forgotten ? `衰减清理 ${decayed.forgotten} 条；` : '';
        return { text: `${decayLine}${result.text}` };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_snapshot',
    description: 'Export the complete memory archive. format "markdown" writes a human-readable portable archive (snapshot file path returned); "json" returns the machine-readable export used for cross-device migration.',
    parameters: {
      type: 'object',
      properties: { format: { type: 'string', enum: ['markdown', 'json'], description: 'Default markdown.' } },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const sid = sessionIdOf(exec);
        if (args.format === 'json') {
          const data = memory.exportJson(sid);
          const file = memory.store.writeExport('export.json', `${JSON.stringify(data, null, 2)}\n`);
          return { text: `已导出 JSON 档案：${file}（${data.episodic.length} 条情景 / ${data.semantic.length} 条语义 / ${data.procedural.length} 条程序）` };
        }
        const md = memory.snapshotMarkdown(sid);
        const file = memory.store.writeSnapshot('snapshot', md);
        const preview = md.split('\n').slice(0, 12).join('\n');
        return { text: `已导出 Markdown 记忆档案：${file}\n\n${preview}\n…（完整内容见文件）` };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_dashboard',
    description: 'Start (or reuse) the local memory dashboard server and return its URL. The dashboard has a timeline view, a knowledge-graph view, a decay heatmap and a link to the 3D brain. When DSH has a web server the dashboard is served by it; otherwise a standalone loopback server is started.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: TEXT_OUTPUT,
    async execute() {
      try {
        await awaitReady();
        if (webOrigin) return { text: dashboardText(webOrigin) };
        const started = await startStandalone();
        return { text: dashboardText(started) };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  // --- system prompt -------------------------------------------------------
  ctx.systemPrompt.context({
    name: 'deepseek-brain',
    order: 130,
    interpolate: false,
    text: (context) => {
      if (!memory.ready || !memory.config.promptInjection) return '';
      try {
        return memory.promptBlock(context?.agent?.session?.id ?? 'default');
      } catch {
        return '';
      }
    },
  });

  // --- capture user messages into the sensory → episodic pipeline ----------
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'user/message') return;
    const text = messageText(event);
    if (!text.trim()) return;
    const sid = session?.id ?? 'default';
    try {
      memory.observe(sid, text);
    } catch (error) {
      memory.warnings.push(`observe failed: ${error?.message ?? error}`);
    }
    if (memory.config.idleConsolidationHours > 0) {
      try {
        memory.maybeSleepIdle();
      } catch {
        /* consolidation is best-effort */
      }
    }
  });

  // --- optional HTTP surface on DSH's own web server -----------------------
  ctx.inject(['webServer'], (scoped) => {
    const handler = createHandler({ memory, webRoot: WEB_ROOT, base: BASE });
    scoped.effect(() => {
      const disposer = scoped.webServer.register({
        kind: 'prefix',
        path: BASE,
        handler: (req, res) => handler.handle(req, res, BASE),
      });
      const origin = typeof scoped.webServer.getOrigin === 'function' ? scoped.webServer.getOrigin() : null;
      if (origin) webOrigin = `${origin}${BASE}/`;
      return () => {
        webOrigin = null;
        return disposer;
      };
    });
  });

  async function startStandalone() {
    if (standalone) return standalone.url;
    const handler = createHandler({ memory, webRoot: WEB_ROOT, base: BASE });
    const server = http.createServer((req, res) => handler.handle(req, res, BASE));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    standalone = { server, url: `http://127.0.0.1:${port}${BASE}/`, dashboard: `http://127.0.0.1:${port}${BASE}/dashboard.html`, brain3d: `http://127.0.0.1:${port}${BASE}/brain-3d.html` };
    return standalone.url;
  }

  function dashboardText(url) {
    const base = url.endsWith('/') ? url : `${url}/`;
    return [
      `记忆仪表盘已就绪：${base}dashboard.html`,
      `3D 记忆大脑：${base}brain-3d.html`,
      `JSON API：${base}api/state`,
      `数据目录：${memory.config.dataDir}`,
      `版本：${VERSION}`,
    ].join('\n');
  }

  return { memory, ready };
}

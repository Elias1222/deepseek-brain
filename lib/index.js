import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
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
    async execute(args, exec) {
      try {
        await awaitReady();
        const result = memory.remember(args, Date.now(), sessionIdOf(exec));
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
    name: 'brain_update',
    description:
      'Edit an existing memory in place (importance, wording, place, emotion, participants, semantic object, procedural rule). Never deletes: the item keeps its id and history, and the change is logged as an edit event.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory id from brain_recall / brain_visualize.' },
        importance: { type: 'integer', description: 'New importance 1-5.' },
        event: { type: 'string', description: 'New wording for an episodic event.' },
        detail: { type: 'string', description: 'New detail text.' },
        place: { type: 'string', description: 'New place.' },
        emotion: { type: 'string', description: 'New emotion label.' },
        object: { type: 'string', description: 'For a semantic fact: the new object (the old value is kept as [已修正]).' },
        rule: { type: 'string', description: 'For a procedural rule: the new wording.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const { id, ...patch } = args;
        const result = memory.update(id, patch, Date.now(), sessionIdOf(exec));
        if (!result) return { text: `未找到 id 为 ${id} 的记忆。` };
        if (result.changed.length === 0) return { text: `记忆 ${id} 没有需要修改的字段。` };
        const head = `已修订 ${result.layer} 记忆 ${id}：${result.changed.join('、')}`;
        const corrected = result.corrected?.length ? `；旧值已标记 [已修正]（${result.corrected.length} 条）` : '';
        return { text: `${head}${corrected}。` };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_history',
    description:
      'Show the version chain of one memory: every earlier wording / importance the item ever had, oldest first, with the current version last. Use it when the user asks "what did I say before" or wants to roll back a specific version.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory id from brain_recall / brain_visualize.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const chain = memory.historyOf(args.id);
        if (!chain) return { text: `未找到 id 为 ${args.id} 的记忆。` };
        const rows = chain.versions.map((ver) => {
          const when = ver.ts ? new Date(ver.ts).toISOString().slice(0, 16).replace('T', ' ') : '—';
          const body = Object.entries(ver.fields)
            .filter(([, value]) => value !== '' && value != null && !(Array.isArray(value) && value.length === 0))
            .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('/') : value}`)
            .join(' · ');
          return `v${ver.v} ${when} ${ver.current ? '[当前]' : ver.status === 'corrected' ? '[已修正]' : ''} ${truncate(body, 220)}`;
        });
        return {
          text: [
            `${chain.layer} ${chain.id} · ${truncate(chain.title, 60)} · 共 ${chain.versions.length} 版`,
            ...rows,
            '（历史版本只保留可编辑字段；要回到某一版用 brain_update 传回它的字段，语义事实用 brain_restore。）',
          ].join('\n'),
        };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_conflicts',
    description:
      'List every semantic fact that was corrected: the stale value, the value that replaced it, and the time of correction. Each entry can be rolled back with brain_restore.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: TEXT_OUTPUT,
    async execute() {
      try {
        await awaitReady();
        const items = memory.conflicts();
        if (items.length === 0) return { text: '没有冲突记录：语义库里没有任何事实被修正过。' };
        const lines = items.slice(0, 24).map((it, i) => {
          const now = it.current ? it.current.object : '（无替代值）';
          return `${i + 1}. ${it.subject} → ${it.relation}：旧「${it.object}」→ 现「${now}」，修订于 ${it.correctedAt ?? '未知'}`;
        });
        return { text: [`冲突复核：共 ${items.length} 条`, ...lines].join('\n') };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_prune_conflicts',
    description:
      'Archive stale corrected facts so a single slot stops piling up old values. Groups by subject/relation and keeps the newest N per slot (default 1). Archived entries move to archive.json — nothing is erased. Use dryRun to preview the count first.',
    parameters: {
      type: 'object',
      properties: {
        keep: { type: 'integer', description: 'How many corrected versions to keep per subject/relation slot (0-20, default 1).' },
        subject: { type: 'string', description: 'Restrict to one subject of the fact triple.' },
        relation: { type: 'string', description: 'Restrict to one relation of the fact triple.' },
        dryRun: { type: 'boolean', description: 'Only report what would be archived; change nothing.' },
      },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const report = memory.pruneConflicts({
          subject: typeof args.subject === 'string' && args.subject.trim() ? args.subject.trim() : null,
          relation: typeof args.relation === 'string' && args.relation.trim() ? args.relation.trim() : null,
          keep: Number.isFinite(args.keep) ? args.keep : 1,
          dryRun: Boolean(args.dryRun),
          sessionId: sessionIdOf(exec),
        });
        if (report.groups === 0) return { text: '没有可清理的废弃事实：语义库里没有被修正过的事实。' };
        const head = report.dryRun
          ? `预演：${report.groups} 个槽位，每个保留最近 ${report.keep} 条，将归档 ${report.removed} 条（未写入）`
          : `已归档 ${report.removed} 条废弃事实，涉及 ${report.groups} 个槽位，每个槽位保留最近 ${report.keep} 条；archive.json 里可查`;
        const lines = report.byGroup
          .filter((g) => g.removed > 0)
          .slice(0, 10)
          .map((g) => `- ${g.key}：保留 ${g.kept} 条，归档 ${g.removed} 条`);
        return { text: [head, ...lines].join('\n') };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_restore',
    description:
      'Roll back one corrected semantic fact: the old value becomes active again and the current value is marked [已修正]. Nothing is deleted — the history stays.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id of the corrected fact, from brain_conflicts.' } },
      required: ['id'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const result = memory.restoreSemantic(args.id, Date.now(), sessionIdOf(exec));
        if (!result) return { text: `未找到被修正的事实 ${args.id}。` };
        const f = result.restored;
        const replaced = result.replaced ? `；原当前值「${result.replaced.object}」已转为 [已修正]` : '';
        return { text: `已恢复：${f.subject} → ${f.relation} → ${f.object}${replaced}。` };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_import',
    description:
      'Merge an exported archive (the JSON produced by /api/export.json or brain_snapshot with format=json) into this brain. Additive only: identical ids, triples and rules are skipped, existing memories are never overwritten.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Filesystem path to the exported JSON archive.' },
        json: { type: 'string', description: 'Inline archive JSON, if you do not have it on disk.' },
      },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        let payload = null;
        if (typeof args.json === 'string' && args.json.trim()) {
          payload = JSON.parse(args.json);
        } else if (typeof args.path === 'string' && args.path.trim()) {
          const raw = await readFile(args.path.trim(), 'utf8');
          payload = JSON.parse(raw);
        }
        if (!payload) return { text: '需要 path 或 json 其中之一。' };
        const report = memory.importArchive(payload, Date.now(), sessionIdOf(exec));
        return {
          text: `已并入：情景 ${report.episodic} 条、语义 ${report.semantic} 条、程序 ${report.procedural} 条；跳过 ${report.skipped} 条（重复或无效）。`,
        };
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
    async execute(args, exec) {
      try {
        await awaitReady();
        const result = memory.forget(args.id, Date.now(), sessionIdOf(exec));
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
    async execute(args, exec) {
      try {
        await awaitReady();
        const decayed = memory.decayPass(Date.now(), sessionIdOf(exec));
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
    name: 'brain_archive',
    description:
      'Look inside the archive (forgotten, pruned and manually archived memories). Without id it lists them with archive time and reason, filtered by query/layer; with id it restores that one into its original layer so it takes part in recall and decay again.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Keyword filter (optional).' },
        layer: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'Restrict to one layer (optional).' },
        limit: { type: 'integer', description: 'How many rows to return, 1-200, default 40.' },
        id: { type: 'string', description: 'Restore this id instead of listing.' },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restore several ids at once (batch). Missing ids are reported back, not treated as errors.',
        },
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const batch = Array.isArray(args?.ids) ? args.ids.filter((x) => typeof x === 'string' && x.trim()) : [];
        if (batch.length) {
          const result = memory.restoreArchivedMany(batch, Date.now(), sessionIdOf(exec));
          const lines = [`批量取回：成功 ${result.restored.length} 条${result.missing.length ? ` · 缺失 ${result.missing.length} 条` : ''}`];
          for (const it of result.restored) lines.push(`· [${it.layer}] ${it.title} · ${it.id}`);
          for (const miss of result.missing) lines.push(`· 归档区里没有 ${miss}`);
          return { text: lines.join('\n') };
        }
        const idToRestore = typeof args?.id === 'string' ? args.id.trim() : '';
        if (idToRestore) {
          const restored = memory.restoreArchived(idToRestore, Date.now(), sessionIdOf(exec));
          if (!restored) return { text: `归档区里没有 ${idToRestore}。` };
          const it = restored.item;
          const title =
            restored.layer === 'episodic'
              ? it.event
              : restored.layer === 'procedural'
                ? it.rule
                : `${it.subject} → ${it.relation} → ${it.object}`;
          return { text: `已取回 → ${restored.layer}：${title}` };
        }

        const result = memory.archiveList({ query: args?.query ?? '', layer: args?.layer ?? null, limit: args?.limit ?? 40 });
        if (!result.total) return { text: '归档区是空的：没有遗忘、没有清理、也没有被手动归档的记忆。' };

        const lines = [
          `归档区 · 共 ${result.total} 条（情景 ${result.byLayer.episodic} / 语义 ${result.byLayer.semantic} / 程序 ${result.byLayer.procedural}）`,
        ];
        for (const it of result.items.slice(0, 12)) {
          const when = it.archivedAt ? String(it.archivedAt).slice(0, 16).replace('T', ' ') : '—';
          lines.push(`· ${when} [${it.layer}] ${it.title} · 原因 ${it.reason} · ${it.id}`);
        }
        if (result.total > 12) lines.push(`（还有 ${result.total - 12} 条，用 query / limit 继续查）`);
        lines.push('取回：brain_archive { id }，或批量 brain_archive { ids: [..] }');
        return { text: lines.join('\n') };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

  ctx.tools.register({
    name: 'brain_reset',
    description: '把这座大脑清空成空白（记忆、归档、活动流、计数器一起归零），用于从零开始。必须显式传 confirm:"reset"；清空后仍会写入空结构并记一条 reset 事件，所以不会留下“删了但还在”的错觉。',
    parameters: {
      type: 'object',
      properties: {
        confirm: { type: 'string', description: '写 reset 才会执行，防止误触' },
        snapshot: { type: 'boolean', description: '清空前是否先存一份 Markdown 快照（默认 true）' },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const memory = await ready;
      if (!args || args.confirm !== 'reset') {
        return { text: '未执行：需要 confirm: "reset" 才会清空。' };
      }
      const report = memory.resetAll({ snapshot: args.snapshot !== false });
      const c = report.cleared;
      return {
        text: [
          '已清空：情景 ' + c.episodic + ' · 语义 ' + c.semantic + ' · 程序 ' + c.procedural +
            ' · 归档 ' + c.archive + ' · 活动 ' + c.activity,
          report.snapshot ? '已留底：' + report.snapshot : '未留底（snapshot:false）',
          '新世代：' + (report.boot && report.boot.id) + '（第 ' + (report.boot && report.boot.count) + ' 次启动）',
        ].join('\n'),
      };
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

  // --- autonomous forgetting: the brain decays even when nobody asks -------
  if (memory.config.autoDecayMinutes > 0) {
    ctx.effect(() => {
      const timer = setInterval(() => {
        try {
          memory.decayPass();
        } catch (error) {
          memory.warnings.push(`auto decay failed: ${error?.message ?? error}`);
        }
      }, memory.config.autoDecayMinutes * 60_000);
      if (typeof timer.unref === 'function') timer.unref();
      return () => clearInterval(timer);
    });
  }

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
      `状态 / 活动流 / 检索：${base}api/state · ${base}api/activity · ${base}api/recall`,
      `时间旅行：${base}api/state?at=-3d（负数回看、正数预演）`,
      `数据目录：${memory.config.dataDir}`,
      `当前事件序号：#${memory.activity.seq}`,
      `版本：${VERSION}`,
    ].join('\n');
  }

  return { memory, ready };
}

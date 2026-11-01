const fs = require('fs');
const base = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain';
let n = 0;
function patch(file, edits) {
  const p = base + '/' + file;
  let t = fs.readFileSync(p, 'utf8');
  for (const [a, b, tag] of edits) {
    if (t.includes(b)) continue;
    if (!t.includes(a)) { console.error('MISS ' + tag + ' in ' + file); process.exit(1); }
    t = t.replace(a, b);
    n++;
  }
  fs.writeFileSync(p, t);
}

/* 1) 活动流：新增 reset 类型 + 真正清空（连 seq 一起） */
patch('lib/activity.js', [
  ["  'import',\n]);", "  'import',\n  'reset',\n]);", 'kind'],
  [
    `  clear() {
    this.events = [];
  }`,
    `  clear() {
    this.events = [];
  }

  /** 彻底清空：事件与序号一起归零（用于「空白大脑」重置）。 */
  reset() {
    this.events = [];
    this.seq = 0;
  }`,
    'reset',
  ],
]);

/* 2) Store：把 activity.jsonl 清空 */
patch('lib/store.js', [
  [
    `  /** 读回最近 limit 条活动事件（解析失败的行直接跳过）。 */`,
    `  /** 清空活动日志文件（重置时用）。 */
  clearActivity() {
    this.ensure();
    fs.writeFileSync(this.file('activity.jsonl'), '', 'utf8');
  }

  /** 读回最近 limit 条活动事件（解析失败的行直接跳过）。 */`,
    'clear-activity',
  ],
]);

/* 3) MemorySystem.resetAll */
patch('lib/memory.js', [
  [
    `  /** 只读实例：把持有者刚写下的事件追平（每次读活动流时调，代价是一次文件读）。 */`,
    `  /**
   * 空白大脑：把五层记忆、归档、活动流、计数器一起清掉，并记一次新世代。
   * 记忆文件照样落盘（清空后的空结构），所以不会留下「删了但还在」的错觉。
   */
  resetAll({ now = Date.now(), sessionId = 'default' } = {}) {
    const report = {
      episodic: this.episodic.length,
      semantic: this.semantic.items.length,
      procedural: this.procedural.items.length,
      archive: this.archive.length,
      activity: this.activity.events.length,
    };
    this.episodic = [];
    this.semantic.items = [];
    this.semantic.aliases = {};
    this.procedural.items = [];
    this.archive = [];
    this.sessions = new Map();
    this.stats = EMPTY_STATS();
    this.activity.reset();
    this.store.clearActivity();
    this.stampBoot(now);
    this.wireActivity();
    this.activity.push('reset', { sessionId, cleared: report }, now);
    this.persist();
    this.reindexVectors();
    return { cleared: report, boot: this.stats.boot };
  }

  /** 只读实例：把持有者刚写下的事件追平（每次读活动流时调，代价是一次文件读）。 */`,
    'reset-fn',
  ],
]);

/* 4) 服务端：POST /api/reset（必须带 confirm） */
patch('lib/server.js', [
  [
    `      if (method === 'GET' && route === '/api/health') {`,
    `      if (method === 'POST' && route === '/api/reset') {
        const body = await readJson(req);
        if (!body || body.confirm !== 'reset') {
          return fail(res, 400, 'missing-confirm', "POST /api/reset needs {\\"confirm\\":\\"reset\\"}");
        }
        const report = memory.resetAll({ now: Date.now() });
        return json(res, 200, { ok: true, ...report });
      }
      if (method === 'GET' && route === '/api/health') {`,
    'route',
  ],
]);

console.log('patched', n);

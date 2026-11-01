const fs = require('fs');
const base = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain';

/* ── README ── */
{
  const p = base + '/README.md';
  let t = fs.readFileSync(p, 'utf8');
  const pairs = [
    ['| `brain_prune_conflicts` | 每个槽位只留最近 N 条旧值，其余软归档到 `archive.json`（先给预演） | `keep` `subject` `relation` `dryRun` |',
     '| `brain_prune_conflicts` | 每个槽位只留最近 N 条旧值，其余软归档到 `archive.json`（先给预演） | `keep` `subject` `relation` `dryRun` |\n| `brain_archive` | 查归档区（遗忘 / 清理 / 手动归档）并取回其中一条 | `query` `layer` `limit` `id` |'],
    ['GET  /api/export.json GET /api/snapshot.md       GET /api/conflicts',
     'GET  /api/export.json GET /api/snapshot.md       GET /api/conflicts\nGET  /api/archive?q=&layer=&limit=                GET /api/memories/:id'],
    ['POST /api/conflicts/prune               # 每槽留 N 条旧值，其余软归档（keep / dryRun）',
     'POST /api/conflicts/prune               # 每槽留 N 条旧值，其余软归档（keep / dryRun）\nPOST /api/archive/:id/restore           # 从归档区取回，回到原来的层'],
    ['| `test/plugin.test.js` | cordis 契约、13 个工具 schema 只使用 DSH 支持的 JSON Schema 子集、端到端工具调用、`session/event` 捕获、prompt 注入 |',
     '| `test/plugin.test.js` | cordis 契约、14 个工具 schema 只使用 DSH 支持的 JSON Schema 子集、端到端工具调用、`session/event` 捕获、prompt 注入 |'],
    ['│   ├── index.js              # 插件入口：13 个工具 + prompt 注入 + 事件捕获 + Web 挂载 + 自主遗忘定时器',
     '│   ├── index.js              # 插件入口：14 个工具 + prompt 注入 + 事件捕获 + Web 挂载 + 自主遗忘定时器'],
    ['- **编年史 CHRONICLE**：等宽表格虚拟滚动，',
     '- **编年史 CHRONICLE**：右上角「归档区」按钮打开归档抽屉——遗忘、清理、手动归档的记忆都在里面，可按关键词与层级筛，点「取回」就回到原来的层继续参与检索与衰减。等宽表格虚拟滚动，'],
    ['![纤维追踪 · 废弃事实面板](docs/screenshots/dash-deprecated.png)',
     '![纤维追踪 · 废弃事实面板](docs/screenshots/dash-deprecated.png)\n\n![编年史 · 归档区抽屉](docs/screenshots/dash-archive.png)'],
  ];
  for (const [a, b] of pairs) {
    if (!t.includes(a)) { console.error('MISS README:', a.slice(0, 42)); process.exit(1); }
    t = t.replace(a, b);
  }
  fs.writeFileSync(p, t);
  console.log('readme ok');
}

/* ── API.md ── */
{
  const p = base + '/docs/API.md';
  let t = fs.readFileSync(p, 'utf8');
  const anchor = '`POST /api/import` — 把另一台设备导出的档案';
  if (!t.includes(anchor)) { console.error('MISS api anchor'); process.exit(1); }
  const block = `\`GET /api/archive?q=&layer=&limit=\` — 归档区：\`archive.json\` 里的条目与「状态为 archived 的语义事实」合并视图。

\`\`\`jsonc
{ "ok": true, "total": 2,
  "byLayer": { "episodic": 1, "semantic": 0, "procedural": 1 },
  "items": [ { "id": "ep_...", "layer": "episodic", "title": "季度评审改到周四上午",
               "body": "", "importance": 3, "ts": "…", "archivedAt": "…",
               "reason": "manual", "source": "archive.json", "score": 0 } ] }
\`\`\`

\`reason\` 三态：\`manual\`（手动归档 / 遗忘）、\`superseded\`（被新说法取代后清理）、\`decay\`（衰减扫除）。

\`POST /api/archive/:id/restore\` — 取回一条。情景与程序回到各自层；
语义事实若槽位已有生效值，会回到「已修正」的位置（\`supersededBy\` 指向当前生效值），不会抢走生效位。

\`\`\`jsonc
// → { "ok": true, "layer": "episodic", "item": { … }, "title": "季度评审改到周四上午" }
// 找不到 → 404 { "ok": false, "error": { "code": "not-found" } }
\`\`\`

` + anchor;
  t = t.replace(anchor, block);
  fs.writeFileSync(p, t);
  console.log('api ok');
}

/* ── EXAMPLES.md ── */
{
  const p = base + '/docs/EXAMPLES.md';
  let t = fs.readFileSync(p, 'utf8');
  const anchor = '# 6) 换一台机器：把另一份 export 并进来，只做加法，重复的跳过';
  if (!t.includes(anchor)) { console.error('MISS examples anchor'); process.exit(1); }
  const block = `# 5c) 忘掉的东西去哪了：归档区能查也能取回
curl -s 'http://127.0.0.1:7799/deepseek-brain/api/archive?q=评审' | jq '{total, items: [.items[] | {id, layer, title, reason}]}'
curl -s -X POST 'http://127.0.0.1:7799/deepseek-brain/api/archive/ep_abc123/restore'
# → {"ok":true,"layer":"episodic","title":"季度评审改到周四上午"}  ← 它又参与检索与衰减了

` + anchor;
  t = t.replace(anchor, block);
  fs.writeFileSync(p, t);
  console.log('examples ok');
}

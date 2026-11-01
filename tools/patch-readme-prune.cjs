const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/README.md';
let t = fs.readFileSync(p, 'utf8');
const pairs = [
  ['- **纤维追踪 TRACTOGRAPHY**：力导向的语义纤维束，主体/客体分级着色，`[已修正]` 用虚线束；右侧实体档案按度数排序，点实体列出它的全部事实。',
   '- **纤维追踪 TRACTOGRAPHY**：力导向的语义纤维束，主体/客体分级着色，`[已修正]` 用虚线束；右侧实体档案按度数排序，点实体列出它的全部事实；再下方是**废弃事实面板**——按「主体 → 关系」聚合被修正的旧值，每个槽位保留最近 1 条，多出来的点一下就软归档到 `archive.json`（可先看「可归档 K 条」再动手）。'],
  ['| `test/plugin.test.js` | cordis 契约、12 个工具 schema 只使用 DSH 支持的 JSON Schema 子集、端到端工具调用、`session/event` 捕获、prompt 注入 |',
   '| `test/plugin.test.js` | cordis 契约、13 个工具 schema 只使用 DSH 支持的 JSON Schema 子集、端到端工具调用、`session/event` 捕获、prompt 注入 |'],
  ['│   ├── index.js              # 插件入口：12 个工具 + prompt 注入 + 事件捕获 + Web 挂载 + 自主遗忘定时器',
   '│   ├── index.js              # 插件入口：13 个工具 + prompt 注入 + 事件捕获 + Web 挂载 + 自主遗忘定时器'],
  ['![编年史 · 版本链抽屉](docs/screenshots/dash-revisions.png)',
   '![编年史 · 版本链抽屉](docs/screenshots/dash-revisions.png)\n\n![纤维追踪 · 废弃事实面板](docs/screenshots/dash-deprecated.png)'],
];
for (const [a, b] of pairs) {
  if (!t.includes(a)) { console.error('MISS:', a.slice(0, 40)); process.exit(1); }
  t = t.replace(a, b);
}
fs.writeFileSync(p, t);
console.log('ok');

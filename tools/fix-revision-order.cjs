const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/memory.js';
let t = fs.readFileSync(p, 'utf8');

// recordVersion 接受「编辑前的字段」快照
t = t.replace(
  `  recordVersion(item, now, changed) {
    if (!item.history) item.history = [];
    item.version = item.version ?? (item.history.length + 1);
    item.history.push({ v: item.version, ts: nowIso(now), fields: MemorySystem.snapshotFields(item), changed: [...changed] });`,
  `  recordVersion(item, now, changed, beforeFields) {
    if (!item.history) item.history = [];
    item.version = item.version ?? (item.history.length + 1);
    item.history.push({
      v: item.version,
      ts: nowIso(now),
      fields: beforeFields ?? MemorySystem.snapshotFields(item),
      changed: [...changed],
    });`,
);

// 情景：先取编辑前快照
t = t.replace(
  `    const epi = this.episodic.find((it) => it.id === idToEdit);
    if (epi) {`,
  `    const epi = this.episodic.find((it) => it.id === idToEdit);
    if (epi) {
      const before = MemorySystem.snapshotFields(epi);`,
);
t = t.replace('      this.recordVersion(epi, now, changed);', '      this.recordVersion(epi, now, changed, before);');

// 程序：同样
t = t.replace(
  `    const pro = this.procedural.items.find((it) => it.id === idToEdit);
    if (pro) {`,
  `    const pro = this.procedural.items.find((it) => it.id === idToEdit);
    if (pro) {
      const beforePro = MemorySystem.snapshotFields(pro);`,
);
t = t.replace('      this.recordVersion(pro, now, changed);', '      this.recordVersion(pro, now, changed, beforePro);');

fs.writeFileSync(p, t);
console.log('ok', t.length);

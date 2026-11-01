const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/memory.js';
let t = fs.readFileSync(p, 'utf8');

/* ── 1) 快照助手：只采集「可被编辑的字段」，避免把派生量写进历史 ── */
const helpers = `  /** 一条记忆的可编辑表面：历史版本只保存这些字段，派生量（strength 等）永不入档。 */
  static snapshotFields(item) {
    if (!item) return {};
    if (Array.isArray(item.participants) || typeof item.event === 'string') {
      return {
        event: item.event, detail: item.detail ?? '', place: item.place ?? '',
        emotion: item.emotion ?? '', participants: [...(item.participants ?? [])],
        importance: item.importance,
      };
    }
    if (typeof item.rule === 'string') {
      return { rule: item.rule, strength: item.strength, importance: item.importance };
    }
    return { object: item.object, importance: item.importance };
  }

  /** 编辑前把旧值压成 vN 快照；item.version 缺省视为 1。 */
  recordVersion(item, now, changed) {
    if (!item.history) item.history = [];
    item.version = item.version ?? (item.history.length + 1);
    item.history.push({ v: item.version, ts: nowIso(now), fields: MemorySystem.snapshotFields(item), changed: [...changed] });
    item.version += 1;
    /* 历史只留最近 20 版：仪器要能追溯，但不该变成档案库 */
    if (item.history.length > 20) item.history.splice(0, item.history.length - 20);
  }

`;
const anchor = '  update(idToEdit, patch = {}, now = Date.now(), sessionId = \'default\') {';
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }
t = t.replace(anchor, helpers + anchor);

/* ── 2) 情景：改之前记快照 ── */
const epiOld = `      if (changed.length === 0) return { layer: 'episodic', item: this.decorateEpisodic(epi, now), changed };
      epi.editedAt = nowIso(now);
      epi.revisions = (epi.revisions ?? 0) + 1;`;
const epiNew = `      if (changed.length === 0) return { layer: 'episodic', item: this.decorateEpisodic(epi, now), changed };
      this.recordVersion(epi, now, changed);
      epi.editedAt = nowIso(now);
      epi.revisions = (epi.revisions ?? 0) + 1;`;
if (!t.includes(epiOld)) { console.error('MISS epi'); process.exit(1); }
t = t.replace(epiOld, epiNew);

/* ── 3) 程序：同样记快照 ── */
const proOld = `      if (changed.length === 0) return { layer: 'procedural', item: pro, changed };
      pro.editedAt = nowIso(now);`;
const proNew = `      if (changed.length === 0) return { layer: 'procedural', item: pro, changed };
      this.recordVersion(pro, now, changed);
      pro.editedAt = nowIso(now);`;
if (!t.includes(proOld)) { console.error('MISS pro'); process.exit(1); }
t = t.replace(proOld, proNew);

fs.writeFileSync(p, t);
console.log('ok', t.length);

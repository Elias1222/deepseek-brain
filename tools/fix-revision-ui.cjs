const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

/* 1) 修正 loadHistory 的占位版本：用当前记录种一版 v1，而不是塞 null */
const oldSeed = `    APP.history[rec.id] = { at: rec.editedAt, versions: [{ v: 1, ts: rec.ts, fields: rec.raw && rec.raw.history ? null : null, current: true, status: 'current' }] };`;
const newSeed = `    APP.history[rec.id] = { at: rec.editedAt, versions: [{
      v: 1, ts: rec.ts, current: true, status: 'current',
      fields: demoFieldsOf(rec),
    }] };`;
if (!t.includes(oldSeed)) { console.error('MISS seed'); process.exit(1); }
t = t.replace(oldSeed, newSeed);

/* 2) 从模型记录里抽一份「可编辑字段」，给演示模式与降级路径共用 */
const anchor = '  /* 版本链：按 id 取一次，之后只在该条被编辑时失效 */';
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }
const helper = `  /* 模型记录 → 可编辑字段（与 lib/memory.js 的 snapshotFields 同构） */
  function demoFieldsOf(rec) {
    if (!rec) return {};
    if (rec.layer === 'episodic') {
      var raw = rec.raw || {};
      return {
        event: rec.title, detail: raw.detail || '', place: raw.place || '',
        emotion: raw.emotion || '', participants: raw.participants || [], importance: rec.importance,
      };
    }
    if (rec.layer === 'procedural') return { rule: rec.title, strength: rec.strength, importance: rec.importance };
    return { object: rec.title, importance: rec.importance };
  }

  /* 演示模式没有服务端：本地把上一版压进链里，语义与在线保持一致 */
  function demoPushVersion(id, fields) {
    if (!APP.history) APP.history = {};
    var bag = APP.history[id];
    if (!bag) return;
    bag.versions.forEach(function (v) { v.current = false; v.status = v.status === 'corrected' ? 'corrected' : 'past'; });
    bag.versions.push({ v: bag.versions.length + 1, ts: new Date().toISOString(), current: true, status: 'current', fields: fields });
  }

`;
t = t.replace(anchor, helper + anchor);

/* 3) 演示模式下改重要度时也压一版 */
const oldDemo = `    applyDemoTime();
    renderGauges();
    refreshHighlight();
  }`;
const newDemo = `    demoPushVersion(id, { importance: importance });
    applyDemoTime();
    renderGauges();
    refreshHighlight();
  }`;
if (!t.includes(oldDemo)) { console.error('MISS demoEdit'); process.exit(1); }
t = t.replace(oldDemo, newDemo);

fs.writeFileSync(p, t);
console.log('ok', t.length);

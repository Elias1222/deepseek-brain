const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

/* 选同一条记忆时不要重置版本选中：轮询会重渲染面板，否则用户刚点开的 v1 会被弹回当前版 */
const oldSel = `  function selectEngram(rec) {
    if (!rec) return;
    APP.selected = rec.id;`;
const newSel = `  function selectEngram(rec) {
    if (!rec) return;
    var samePick = APP.selected === rec.id;
    APP.selected = rec.id;`;
if (!t.includes(oldSel)) { console.error('MISS sel'); process.exit(1); }
t = t.replace(oldSel, newSel);

const oldReset = "    setStatus('EYEPIECE · ' + REGION[rec.layer].label, '#' + escapeHTML(rec.id), '');\n    APP.viewVer = null;\n    loadHistory(rec);";
const newReset = "    setStatus('EYEPIECE · ' + REGION[rec.layer].label, '#' + escapeHTML(rec.id), '');\n    if (!samePick) APP.viewVer = null;\n    loadHistory(rec);";
if (!t.includes(oldReset)) { console.error('MISS reset'); process.exit(1); }
t = t.replace(oldReset, newReset);

/* loadHistory 拿到新链后，若选中的版本已不存在则回退到当前版 */
const oldAssign = `      APP.history[rec.id] = { at: rec.editedAt, versions: res.versions };
      renderGauges();`;
const newAssign = `      APP.history[rec.id] = { at: rec.editedAt, versions: res.versions };
      if (APP.viewVer != null && !res.versions.some(function (x) { return x.v === APP.viewVer; })) APP.viewVer = null;
      renderGauges();`;
if (!t.includes(oldAssign)) { console.error('MISS assign'); process.exit(1); }
t = t.replace(oldAssign, newAssign);

fs.writeFileSync(p, t);
console.log('ok', t.length);

const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

const start = t.indexOf('  function demoEditImportance(id, importance) {');
const end = t.indexOf('  function doForget() {');
if (start < 0 || end < 0 || end < start) { console.error('MISS span', start, end); process.exit(1); }

const neu = `  /* 离线演示改重要度：写回 APP.demoRaw（applyDemoTime 的唯一来源），再重建模型 */
  function demoEditImportance(id, importance) {
    var raw = APP.demoRaw;
    if (!raw) return;
    var buckets = [raw.episodic, raw.semantic, raw.procedural];
    ['episodic', 'semantic', 'procedural'].forEach(function (k) {
      if (raw[k] && raw[k].items) buckets.push(raw[k].items);
    });
    var hit = false;
    buckets.forEach(function (list) {
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) { list[i].importance = importance; hit = true; }
      }
    });
    if (!hit) return;
    applyDemoTime();
    renderGauges();
    refreshHighlight();
  }

`;
t = t.slice(0, start) + neu + t.slice(end);
fs.writeFileSync(p, t);
console.log('ok', t.length);

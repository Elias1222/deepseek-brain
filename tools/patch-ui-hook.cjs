const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
const a = '  window.__rhythmRedraw = function () { renderRhythm(); };';
const b = `  window.__rhythmRedraw = function () { renderRhythm(); };
  /* 调试钩子：一次性重绘左栏时间轴三件套（历史行 / 节奏条 / 关联图） */
  window.__uiRedraw = function () { renderHistory(); renderRhythm(); renderGraphPanel(); };`;
if (!t.includes(a)) { console.error('MISS'); process.exit(1); }
t = t.replace(a, b);
fs.writeFileSync(p, t);
console.log('ok');

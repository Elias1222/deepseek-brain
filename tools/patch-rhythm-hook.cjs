const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
const a = '  function renderRhythm() {';
const b = '  window.__rhythmRedraw = function () { renderRhythm(); };\n\n  function renderRhythm() {';
if (!t.includes(a)) { console.error('MISS'); process.exit(1); }
t = t.replace(a, b);
fs.writeFileSync(p, t);
console.log('ok');

const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

// wireRevisions 只挂在 renderSliceCoupled 里，而初始渲染走的是别的路径 → 改为「打开抽屉时惰性绑定」
const oldOpen = `function revOpen(id, layer, title){
  REV.id = id;`;
if (!t.includes(oldOpen)) { console.error('MISS open'); process.exit(1); }
t = t.replace(oldOpen, `function revOpen(id, layer, title){
  wireRevisions();
  REV.id = id;`);

fs.writeFileSync(p, t);
console.log('ok');

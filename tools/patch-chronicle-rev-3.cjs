const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

const oldHead = `function wireRevisions(){
  $('revClose').addEventListener('click', revClose);`;
if (!t.includes(oldHead)) { console.error('MISS'); process.exit(1); }

const newHead = `function wireRevisions(){
  if(window.__dashRev) return;            /* 只绑一次：本函数会被 renderSliceCoupled 反复调用 */
  window.__dashRev = { REV: REV, open: revOpen, render: revRender };
  $('revClose').addEventListener('click', revClose);`;

t = t.replace(oldHead, newHead);
fs.writeFileSync(p, t);
console.log('ok');

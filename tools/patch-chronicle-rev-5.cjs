const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

// 1) 行可点击的视觉提示
const rowCss = '.tl-row:hover{background:rgba(230,224,210,.025)}';
if (!t.includes(rowCss)) throw new Error('row css missing');
t = t.replace(rowCss, rowCss + '\n.tl-row{cursor:pointer}\n.tl-row:hover .tl-title{color:var(--paper)}');

// 2) 视图说明里点明「点行看修订史」
const note = '逐条记忆的等宽台账 · 强度按当前切片计算 · 删除为两步归档';
if (!t.includes(note)) throw new Error('note missing');
t = t.replace(note, '逐条记忆的等宽台账 · 强度按当前切片计算 · 点任意行看它的版本链 · 删除为两步归档');

fs.writeFileSync(p, t);
console.log('ok', t.length);

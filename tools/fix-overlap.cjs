const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/memory.js';
let t = fs.readFileSync(p, 'utf8');
const a = '.map((it) => ({ ...it, score: overlapScore(`${it.title} ${it.body}`, tokens) }))';
const b = '.map((it) => ({ ...it, score: overlapScore(tokens, tokenize(`${it.title} ${it.body}`)) }))';
if (!t.includes(a)) { console.error('MISS'); process.exit(1); }
t = t.replace(a, b);
fs.writeFileSync(p, t);
console.log('ok');

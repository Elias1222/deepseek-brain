const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');
const a = "var KIND = { observe:'观察', recall:'检索', remember:'写入', correct:'修正', forget:'归档', consolidate:'巩固', decay:'衰减' };";
const b = "var KIND = { observe:'观察', recall:'检索', remember:'写入', correct:'修正', forget:'归档', consolidate:'巩固', decay:'衰减', edit:'修订', import:'合并', prune:'清理', travel:'切片', sleep:'睡眠' };";
if (!t.includes(a)) { console.error('MISS kind map'); process.exit(1); }
t = t.replace(a, b);
fs.writeFileSync(p, t);
console.log('ok');

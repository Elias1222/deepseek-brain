const fs = require('node:fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

const anchor = '    var host = document.querySelector(".board") || document.body;';
if (!t.includes(anchor)) { console.error('MISS'); process.exit(1); }

/* 窄屏时左栏是抽屉，滑杆会跟着藏起来；宽屏才放左栏，窄屏塞进底部 dock */
const repl = [
  '    var narrow = window.innerWidth < 820;',
  '    var host = narrow',
  '      ? (document.querySelector(".dock") || document.body)',
  '      : (document.querySelector(".board") || document.body);',
].join('\n');

t = t.replace(anchor, repl);
fs.writeFileSync(p, t);
console.log('ok');

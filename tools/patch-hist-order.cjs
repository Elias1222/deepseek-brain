const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 控件提到列表上方：列表自己滚动，节奏条与滑杆永远在第一屏 */
sub(`      '<ol id="histList"></ol>' +
      '<div class="rhythm"><div id="rhythmBox"></div></div>' +
      '<div class="scrub"><input type="range" id="histRange" min="0" max="11" step="0.02" value="0" aria-label="检索史时间轴"><span id="histPos">最近</span></div>';`,
`      '<div class="rhythm"><div id="rhythmBox"></div></div>' +
      '<div class="scrub"><input type="range" id="histRange" min="0" max="11" step="0.02" value="0" aria-label="检索史时间轴"><span id="histPos">最近</span></div>' +
      '<ol id="histList"></ol>';`, 'hist-order');

sub(`.hist .rhythm { margin-top: 8px; }`,
`.hist #histList { max-height: 104px; overflow-y: auto; overscroll-behavior: contain; }
.hist .rhythm { margin-top: 6px; }`, 'hist-scroll');

fs.writeFileSync(p, t);
console.log('patched', n);

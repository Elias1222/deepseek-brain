const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 关联图改挂在舞台上（左下角浮卡），不再挤在左栏里被裁掉 */
sub(`.hist .gph { margin-top: 8px; border-top: 1px dashed var(--line, rgba(230,224,210,.14)); padding-top: 8px; }
.hist .gph svg { display: block; width: 100%; height: auto; }
.hist .gph .cap { font: 9px/1.5 var(--mono); color: var(--dim, #7c7a70); margin-top: 4px; }
.hist .gph .delta { font: 9px/1.6 var(--mono); margin-top: 2px; font-variant-numeric: tabular-nums; }
.hist .gph .delta em { font-style: normal; color: #7fb06a; }
.hist .gph .delta i { font-style: normal; color: #c8482e; }
.hist .gph .delta b { font-weight: 500; color: var(--paper-3, #b9b3a4); }`,
`/* 关联图：舞台左下角的浮卡，压在标本之上但不抢焦点 */
.hist .gph { margin-top: 8px; border-top: 1px dashed var(--line, rgba(230,224,210,.14)); padding-top: 8px; }
.stageGraph { position: absolute; left: 14px; bottom: 14px; width: 244px; z-index: 3;
  padding: 8px 10px 6px; background: rgba(9,10,12,.78); border: 1px solid var(--line, rgba(230,224,210,.14));
  backdrop-filter: blur(3px); pointer-events: none; }
.stageGraph .hd { display: flex; justify-content: space-between; align-items: baseline;
  font: 9px/1 var(--mono); letter-spacing: .18em; color: var(--dim, #7c7a70); text-transform: uppercase; }
.stageGraph .hd b { font-weight: 500; color: var(--paper-3, #b9b3a4); letter-spacing: .1em; }
.stageGraph svg { display: block; width: 100%; height: auto; }
.stageGraph .cap { font: 9px/1.5 var(--mono); color: var(--dim, #7c7a70); margin-top: 2px; }
.stageGraph .delta { font-style: normal; font-variant-numeric: tabular-nums; }
.stageGraph .delta em { font-style: normal; color: #7fb06a; }
.stageGraph .delta i { font-style: normal; color: #c8482e; }
.stageGraph .delta b { font-weight: 500; color: var(--paper-3, #b9b3a4); }`, 'graph-css2');

sub(`      '<ol id="histList"></ol>' +
      '<div class="gph"><div id="graphBox"></div></div>';`,
`      '<ol id="histList"></ol>';`, 'graph-dom-remove');

/* 建舞台浮卡 */
sub(`  APP.graphIdx = 0;`,
`  function ensureStageGraph() {
    if (document.getElementById('stageGraph')) return;
    var stage = $('stage');
    if (!stage) return;
    var box = document.createElement('div');
    box.className = 'stageGraph';
    box.id = 'stageGraph';
    box.innerHTML = '<div class="hd"><b>关联图</b><span>查询 → 命中</span></div><div id="graphBox"></div>';
    stage.appendChild(box);
  }

  APP.graphIdx = 0;`, 'graph-stage');

sub(`  function renderGraphPanel() {
    var host = document.getElementById('graphBox');`,
`  function renderGraphPanel() {
    ensureStageGraph();
    var host = document.getElementById('graphBox');`, 'graph-ensure-stage');

fs.writeFileSync(p, t);
console.log('patched', n);

const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

/* 1) 把误塞进 histPush 的 ensureStageGraph 摘出来 */
const bad = `    function ensureStageGraph() {
    if (document.getElementById('stageGraph')) return;
    var stage = $('stage');
    if (!stage) return;
    var box = document.createElement('div');
    box.className = 'stageGraph';
    box.id = 'stageGraph';
    box.innerHTML = '<div class="hd"><b>关联图</b><span>查询 → 命中</span></div><div id="graphBox"></div>';
    stage.appendChild(box);
  }

  APP.graphIdx = 0;
    renderHistory();`;
const good = `    APP.graphIdx = 0;
    renderHistory();`;
if (!t.includes(bad)) { console.error('MISS bad block'); process.exit(1); }
t = t.replace(bad, good);

/* 2) 在模块作用域里正式定义（放在 renderGraphPanel 之前） */
const anchor = `  function renderGraphPanel() {`;
const def = `  function ensureStageGraph() {
    if (document.getElementById('stageGraph')) return;
    var stage = $('stage');
    if (!stage) return;
    var box = document.createElement('div');
    box.className = 'stageGraph';
    box.id = 'stageGraph';
    box.innerHTML = '<div class="hd"><b>关联图</b><span>查询 → 命中</span></div><div id="graphBox"></div>';
    stage.appendChild(box);
  }

  function renderGraphPanel() {`;
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }
t = t.replace(anchor, def);

fs.writeFileSync(p, t);
console.log('ok');

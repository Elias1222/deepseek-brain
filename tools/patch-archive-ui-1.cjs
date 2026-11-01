const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

/* ── 1) CSS：归档抽屉（复用 revdrawer 的定位与外观，只加列表行样式） ── */
const cssAnchor = '/* ── deprecated facts ────────────────────────────────────────── */';
if (!t.includes(cssAnchor)) throw new Error('css anchor');
const css = `/* ── archive drawer ──────────────────────────────────────────── */
.arc-q{display:flex;gap:6px;margin:2px 0 8px}
.arc-q input{flex:1;min-width:0;padding:6px 8px;font:11px/1.4 var(--mono);color:var(--paper);
  background:rgba(230,224,210,.04);border:1px solid var(--line);border-radius:0}
.arc-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.arc-chip{padding:3px 7px;font:10px/1.2 var(--mono);letter-spacing:.06em;color:var(--paper-3);
  background:transparent;border:1px solid var(--line);border-radius:0;cursor:pointer}
.arc-chip.on{color:var(--ink);background:var(--paper);border-color:var(--paper)}
.arc-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:start;
  padding:7px 2px;border-bottom:1px solid rgba(230,224,210,.06)}
.arc-row .when{font:9px/1.5 var(--mono);color:var(--paper-4);white-space:nowrap}
.arc-row .what b{display:block;font-size:11px;font-weight:500;color:var(--paper);line-height:1.45}
.arc-row .what i{font-style:normal;font:9px/1.5 var(--mono);color:var(--paper-4)}
.arc-row .btn{flex:none;padding:3px 7px;font-size:9px}
.arc-empty{padding:10px 2px;font:10px/1.7 var(--mono);color:var(--paper-4)}

`;
t = t.replace(cssAnchor, css + cssAnchor);

/* ── 2) DOM：编年史工具栏加「归档区」按钮 ── */
const btnAnchor = `        <button class="btn btn-ghost" type="button" id="tlReset">重置</button>`;
if (!t.includes(btnAnchor)) throw new Error('reset button anchor');
t = t.replace(btnAnchor, btnAnchor + `\n        <button class="btn btn-ghost" type="button" id="arcOpen">归档区</button>`);

/* ── 3) DOM：抽屉本体（放在 revDrawer 之后） ── */
const drawerAnchor = `      <aside class="revdrawer" id="revDrawer" hidden aria-label="记忆修订史" aria-hidden="true">`;
if (!t.includes(drawerAnchor)) throw new Error('drawer anchor');
const drawer = `      <aside class="revdrawer" id="arcDrawer" hidden aria-label="归档区" aria-hidden="true">
        <div class="rev-hd">
          <div class="t"><b>归档区</b><i>ARCHIVE</i></div>
          <button class="x" id="arcClose" type="button" aria-label="关闭">×</button>
        </div>
        <div class="rev-body">
          <p class="rev-lede">遗忘、清理与手动归档的记忆都在这里。取回之后它重新参与检索与衰减；语义槽位已被占用时，它回到「已修正」的位置。</p>
          <div class="arc-q">
            <input type="text" id="arcQuery" placeholder="搜事件 / 地点 / 三元组" aria-label="归档区检索">
            <button class="btn btn-ghost" id="arcGo" type="button">检索</button>
          </div>
          <div class="arc-chips" id="arcChips">
            <button class="arc-chip on" data-layer="" type="button">全部</button>
            <button class="arc-chip" data-layer="episodic" type="button">情景</button>
            <button class="arc-chip" data-layer="semantic" type="button">语义</button>
            <button class="arc-chip" data-layer="procedural" type="button">程序</button>
          </div>
          <div id="arcList"><p class="arc-empty">读取中…</p></div>
        </div>
        <div class="rev-foot">
          <span class="rev-st" id="arcSt">—</span>
        </div>
      </aside>
` + drawerAnchor;
t = t.replace(drawerAnchor, drawer);

fs.writeFileSync(p, t);
console.log('ok');

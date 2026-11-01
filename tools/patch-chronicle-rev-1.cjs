// 给观测仪「编年史」加版本链抽屉：点行 → 右侧抽屉列出 v1…vN，可查看字段并恢复某一版。
const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

/* ── 1) CSS ─────────────────────────────────────────────────── */
const cssAnchor = "/* ── decay ───────────────────────────────────────────────────── */";
if (!t.includes(cssAnchor)) throw new Error('css anchor missing');
const css = `/* ── revisions drawer ────────────────────────────────────────── */
.revdrawer{position:fixed;top:0;right:0;bottom:0;width:min(432px,94vw);z-index:70;
  background:linear-gradient(180deg,var(--ink-3),var(--ink));border-left:1px solid var(--line-2);
  display:flex;flex-direction:column;box-shadow:-28px 0 64px rgba(0,0,0,.6);
  transform:translateX(100%);transition:transform .22s cubic-bezier(.4,0,.2,1)}
.revdrawer.on{transform:translateX(0)}
.revdrawer[hidden]{display:none}
.rev-hd{display:flex;align-items:flex-start;gap:10px;padding:13px 15px;border-bottom:1px solid var(--line)}
.rev-hd .t{flex:1;min-width:0}
.rev-hd b{display:block;font-family:var(--serif);font-size:15px;font-weight:600;color:var(--paper);
  line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rev-hd i{display:block;margin-top:3px;font-style:normal;font-size:9px;letter-spacing:.16em;
  color:var(--paper-4);text-transform:uppercase}
.rev-hd .x{flex:none;width:26px;height:26px;border:1px solid var(--line);background:none;color:var(--paper-2);
  font:12px/1 var(--mono);cursor:pointer;border-radius:2px}
.rev-hd .x:hover{border-color:var(--cinnabar);color:var(--cinnabar-2)}
.rev-body{flex:1;overflow:auto;padding:12px 15px 18px}
.rev-lede{font-size:10px;line-height:1.7;color:var(--paper-4);margin:0 0 10px}
.rev-chips{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 12px}
.rev-chip{font:10px/1 var(--mono);letter-spacing:.04em;padding:5px 7px;border:1px solid var(--line);
  background:none;color:var(--paper-3);cursor:pointer;border-radius:2px;white-space:nowrap}
.rev-chip:hover{border-color:var(--line-3);color:var(--paper)}
.rev-chip.on{border-color:var(--celadon);color:var(--paper);background:rgba(123,159,154,.14)}
.rev-chip.cur::after{content:" 当前";color:var(--celadon)}
.rev-chip.cor::after{content:" 已修正";color:var(--paper-4)}
.rev-fields{display:grid;grid-template-columns:78px minmax(0,1fr);gap:1px;border-top:1px solid var(--line)}
.rev-fields dt,.rev-fields dd{margin:0;padding:6px 0;border-bottom:1px solid rgba(230,224,210,.06);
  font-size:11px;line-height:1.55}
.rev-fields dt{color:var(--paper-4);font-size:9px;letter-spacing:.13em;text-transform:uppercase;font-family:var(--mono)}
.rev-fields dd{color:var(--paper-2);word-break:break-word}
.rev-foot{display:flex;align-items:center;gap:8px;padding:11px 15px;border-top:1px solid var(--line);flex-wrap:wrap}
.rev-st{flex:1;min-width:120px;font:10px/1.5 var(--mono);color:var(--paper-4)}
.rev-st.ok{color:var(--celadon)}
.rev-st.bad{color:var(--cinnabar-2)}

`;
t = t.replace(cssAnchor, css + cssAnchor);

/* ── 2) DOM ─────────────────────────────────────────────────── */
const domAnchor = "</section>";
const sectionStart = t.indexOf('<section class="view" id="view-chronicle"');
const sectionEnd = t.indexOf(domAnchor, sectionStart);
if (sectionStart < 0 || sectionEnd < 0) throw new Error('chronicle section missing');
const drawer = `  <aside class="revdrawer" id="revDrawer" hidden aria-label="记忆修订史" aria-hidden="true">
    <div class="rev-hd">
      <div class="t"><b id="revTitle">—</b><i id="revMeta">REVISIONS</i></div>
      <button class="x" id="revClose" type="button" aria-label="关闭">×</button>
    </div>
    <div class="rev-body">
      <p class="rev-lede" id="revLede">读 api/memories/:id 的版本链。点任一版看它当时的字段；「恢复此版本」会再压一版，不覆盖历史。</p>
      <div class="rev-chips" id="revChips"></div>
      <dl class="rev-fields" id="revFields"></dl>
    </div>
    <div class="rev-foot">
      <span class="rev-st" id="revSt">未选中版本</span>
      <button class="btn btn-ghost" id="revRestore" type="button" hidden>恢复此版本</button>
    </div>
  </aside>
`;
t = t.slice(0, sectionEnd) + drawer + t.slice(sectionEnd);

fs.writeFileSync(p, t);
console.log('css+dom ok', t.length);

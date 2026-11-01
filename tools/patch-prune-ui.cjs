const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

/* 1) CSS：废弃事实块（贴在实体档案下方） */
const cssAnchor = '/* ── revisions drawer ────────────────────────────────────────── */';
if (!t.includes(cssAnchor)) throw new Error('css anchor');
const css = `/* ── deprecated facts ────────────────────────────────────────── */
.depr{flex:0 0 auto;max-height:42%;display:flex;flex-direction:column;min-height:132px;
  border-top:1px solid var(--line);margin-top:2px}
.depr-body{flex:1;overflow:auto;min-height:0;padding:4px 2px 2px}
.depr-empty{padding:8px 2px;font-size:10px;line-height:1.7;color:var(--paper-4)}
.depr-row{display:flex;align-items:center;gap:6px;padding:5px 2px;border-bottom:1px solid rgba(230,224,210,.06)}
.depr-row .who{flex:1;min-width:0;font-size:10px;color:var(--paper-2);line-height:1.45}
.depr-row .who b{color:var(--paper);font-weight:500}
.depr-row .who em{font-style:normal;color:var(--paper-4)}
.depr-row .n{flex:none;font:10px/1 var(--mono);color:var(--cinnabar-2)}
.depr-row .btn{flex:none;padding:3px 6px;font-size:9px}
.depr-foot{display:flex;align-items:center;gap:6px;padding:6px 2px 2px;border-top:1px solid rgba(230,224,210,.08)}
.depr-foot .st{flex:1;min-width:0;font:9px/1.5 var(--mono);color:var(--paper-4)}
.depr-foot .st.ok{color:var(--celadon)}
.depr-foot .st.bad{color:var(--cinnabar-2)}

`;
t = t.replace(cssAnchor, css + cssAnchor);

/* 2) DOM：实体档案面板内追加废弃事实块 */
const factsClose = `          <div class="facts" id="factsBody"><p class="fact-empty">尚未选取节点。<br>点选任一实体，此处列出该实体的全部事实——包括被修正的旧版本与取代链。</p></div>
        </aside>`;
if (!t.includes(factsClose)) throw new Error('facts dom anchor');
t = t.replace(factsClose, `          <div class="facts" id="factsBody"><p class="fact-empty">尚未选取节点。<br>点选任一实体，此处列出该实体的全部事实——包括被修正的旧版本与取代链。</p></div>
          <section class="depr" aria-label="废弃事实">
            <header class="panel-h"><span class="pl">废弃事实</span><span class="en">DEPRECATED</span><span class="lead"></span><span class="meta" id="deprMeta">—</span></header>
            <div class="depr-body" id="deprBody"><p class="depr-empty">读取中…</p></div>
            <div class="depr-foot">
              <span class="st" id="deprSt">每个槽位保留最近 1 条旧值，其余软归档</span>
              <button class="btn btn-ghost" id="deprAll" type="button">全部归档</button>
            </div>
          </section>
        </aside>`);

/* 3) JS：渲染 + 动作 */
const jsAnchor = `function renderFacts(id){`;
if (!t.includes(jsAnchor)) throw new Error('js anchor');
const js = `/* ── deprecated facts ───────────────────────────────────────── */
var DEPR = { groups: [], removable: 0, busy: false };

function deprSetStatus(text, kind){
  var el = $('deprSt');
  if(!el) return;
  el.className = 'st' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function deprGroupsFromState(state){
  var sem = (state && state.semantic) || [];
  var map = {};
  sem.forEach(function(f){
    if(f.status !== 'corrected') return;
    var key = f.subject + ' → ' + f.relation;
    if(!map[key]) map[key] = { key: key, subject: f.subject, relation: f.relation, corrected: [], current: null };
    map[key].corrected.push(f);
  });
  sem.forEach(function(f){
    if(f.status !== 'active') return;
    var key = f.subject + ' → ' + f.relation;
    if(map[key]) map[key].current = f;
  });
  return Object.keys(map).map(function(k){ return map[k]; })
    .sort(function(a, b){ return b.corrected.length - a.corrected.length; });
}

function renderDeprecated(){
  var body = $('deprBody');
  if(!body) return;

  if(S.mode === 'demo'){
    var groups = deprGroupsFromState(stateOf());
    DEPR.groups = groups;
    DEPR.removable = groups.reduce(function(s, g){ return s + Math.max(0, g.corrected.length - 1); }, 0);
    $('deprMeta').textContent = groups.length + ' 槽位 · 演示';
    if(!groups.length){
      body.innerHTML = '<p class="depr-empty">演示样本里没有被修正的事实。</p>';
      $('deprAll').disabled = true;
      deprSetStatus('离线演示：清理动作不可用', '');
      return;
    }
    body.innerHTML = groups.map(function(g){
      return '<div class="depr-row"><span class="who"><b>' + esc(g.key) + '</b> <em>现「' + esc(g.current ? g.current.object : '无生效值') + '」</em></span>' +
        '<span class="n">' + g.corrected.length + ' 条</span></div>';
    }).join('');
    $('deprAll').disabled = true;
    deprSetStatus('离线演示：清理需要宿主服务', '');
    return;
  }

  api('api/conflicts').then(function(data){
    DEPR.groups = data.groups || [];
    DEPR.removable = data.removable || 0;
    $('deprMeta').textContent = DEPR.groups.length + ' 槽位 · 可归档 ' + DEPR.removable + ' 条';
    $('deprAll').disabled = DEPR.removable === 0;
    if(!DEPR.groups.length){
      body.innerHTML = '<p class="depr-empty">没有废弃事实：语义库里没有任何事实被修正过。</p>';
      deprSetStatus('无可归档项', 'ok');
      return;
    }
    body.innerHTML = DEPR.groups.map(function(g){
      var can = Math.max(0, g.corrected.length - 1);
      var btn = can > 0
        ? '<button class="btn btn-ghost" type="button" data-prune="' + esc(g.subject) + '" data-rel="' + esc(g.relation) + '">归档 ' + can + '</button>'
        : '<span class="n" style="color:var(--paper-4)">已收敛</span>';
      return '<div class="depr-row"><span class="who"><b>' + esc(g.key) + '</b> <em>现「' +
        esc(g.current ? g.current.object : '无生效值') + '」· 旧值 ' + g.corrected.length + ' 条</em></span>' +
        '<span class="n">' + can + ' 可归档</span>' + btn + '</div>';
    }).join('');
    deprSetStatus('每个槽位保留最近 1 条旧值，其余软归档', '');
  }).catch(function(err){
    body.innerHTML = '<p class="depr-empty">读取失败：' + esc(err && err.message ? err.message : 'unknown') + '</p>';
    deprSetStatus('读取失败', 'bad');
  });
}

function deprPrune(subject, relation){
  if(DEPR.busy) return;
  DEPR.busy = true;
  deprSetStatus('归档中…', '');
  var payload = { keep: 1 };
  if(subject) payload.subject = subject;
  if(relation) payload.relation = relation;
  api('api/conflicts/prune', { method:'POST', body: payload }).then(function(res){
    DEPR.busy = false;
    deprSetStatus('已归档 ' + res.removed + ' 条 · 留档在 archive.json', 'ok');
    renderDeprecated();
    if(typeof refreshState === 'function') refreshState();
  }).catch(function(err){
    DEPR.busy = false;
    deprSetStatus('归档失败 · ' + (err && err.message ? err.message : 'unknown'), 'bad');
  });
}

function wireDeprecated(){
  var body = $('deprBody');
  if(!body || body.__wired) return;
  body.__wired = true;
  body.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-prune]');
    if(!b) return;
    deprPrune(b.getAttribute('data-prune'), b.getAttribute('data-rel'));
  });
  $('deprAll').addEventListener('click', function(){ deprPrune(null, null); });
}

` + jsAnchor;
t = t.replace(jsAnchor, js);

/* 4) 视图切换时渲染 */
const goAnchor = `    else if(view === 'tractography'){ renderGraph(false); }`;
if (!t.includes(goAnchor)) throw new Error('go anchor');
t = t.replace(goAnchor, `    else if(view === 'tractography'){ renderGraph(false); wireDeprecated(); renderDeprecated(); }`);

fs.writeFileSync(p, t);
console.log('ok', t.length);

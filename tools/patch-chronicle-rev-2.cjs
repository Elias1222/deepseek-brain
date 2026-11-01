// 编年史「版本链抽屉」的 JS 逻辑 + 接线。
const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

/* 1) 逻辑块：插在 renderChronicle 之前 */
const anchor = "function renderChronicle(){ buildTimeline(); }";
if (!t.includes(anchor)) throw new Error('anchor missing');
const logic = `/* ── revisions drawer ───────────────────────────────────────── */
var REV = { id:null, layer:null, title:'', data:null, ver:null, busy:false };

function revIsDemo(){ return S.mode === 'demo'; }

function revFindItem(id){
  var st = S.sliceState || S.base;
  if(!st) return null;
  var groups = [
    ['episodic', st.episodic || []],
    ['semantic', st.semantic || []],
    ['procedural', st.procedural || []],
    ['sensory', st.sensory || []],
    ['working', (st.working && st.working.stack) || []]
  ];
  for(var g = 0; g < groups.length; g++){
    var arr = groups[g][1];
    for(var i = 0; i < arr.length; i++){
      if(arr[i].id === id) return { layer: groups[g][0], item: arr[i] };
    }
  }
  return null;
}

function revFieldsHtml(rec){
  var skip = { id:1, ts:1, layer:1, strength:1, salience:1, forgetInDays:1, pinned:1,
               status:1, hits:1, ageDays:1, current:1, v:1, changed:1, supersededBy:1,
               correctedAt:1, editedAt:1, revisions:1, consolidated:1, tags:1, source:1,
               valence:1, forced:1, detail:1, lastSeen:1, strength0:1 };
  var rows = [];
  Object.keys(rec).forEach(function(k){
    if(skip[k]) return;
    var v = rec[k];
    if(v == null || v === '' || (Array.isArray(v) && !v.length)) return;
    if(typeof v === 'object' && !Array.isArray(v)) return;
    var text = Array.isArray(v) ? v.join('、') : String(v);
    if(k === 'ts' || /At$/.test(k)) text = fmtDateTime(v);
    rows.push('<dt>' + esc(k) + '</dt><dd>' + esc(text) + '</dd>');
  });
  if(rec.detail){
    rows.push('<dt>detail</dt><dd>' + esc(rec.detail) + '</dd>');
  }
  return rows.length ? rows.join('') : '<dt>—</dt><dd>该版没有可显示的字段</dd>';
}

function revSetStatus(text, kind){
  var el = $('revSt');
  el.className = 'rev-st' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function revChipLabel(v){
  var n = 'v' + v.v;
  return n;
}

function revRender(){
  var chips = '', cur = null;

  if(revIsDemo()){
    var found = revFindItem(REV.id);
    if(!found){ revSetStatus('演示模型里找不到这条记忆', 'bad'); return; }
    cur = found.item;
    chips = '<button class="rev-chip on cur" type="button" disabled>v1 当前</button>';
    $('revFields').innerHTML = revFieldsHtml(cur);
    $('revRestore').hidden = true;
    revSetStatus('离线演示 · 写入只改本页内存，没有历史版本', '');
    return;
  }

  var data = REV.data;
  if(!data || !data.versions || !data.versions.length){
    revSetStatus('这条记忆还没有版本记录', '');
    return;
  }
  var versions = data.versions;
  var view = REV.ver != null ? null : versions[versions.length - 1];
  if(REV.ver != null){
    versions.forEach(function(v){ if(v.v === REV.ver) view = v; });
  }
  if(!view) view = versions[versions.length - 1];
  cur = view;

  versions.forEach(function(v){
    var cls = 'rev-chip' + (v.v === view.v ? ' on' : '') + (v.current ? ' cur' : '') +
              (v.status === 'corrected' ? ' cor' : '');
    chips += '<button class="' + cls + '" type="button" data-ver="' + v.v + '">' + revChipLabel(v) + '</button>';
  });
  $('revChips').innerHTML = chips;
  $('revFields').innerHTML = revFieldsHtml(view.fields || {});

  var canRestore = !view.current;
  $('revRestore').hidden = !canRestore;
  if(canRestore){
    revSetStatus('v' + view.v + ' 不是当前生效版 · 可恢复', '');
  } else {
    revSetStatus('v' + view.v + ' 是当前生效版', '');
  }
}

function revOpen(id, layer, title){
  REV.id = id; REV.layer = layer; REV.title = title || id;
  REV.data = null; REV.ver = null;
  $('revTitle').textContent = REV.title;
  $('revTitle').title = REV.title;
  $('revMeta').textContent = 'REVISIONS · ' + (layer || '—') + ' · ' + id;
  $('revChips').innerHTML = '';
  $('revFields').innerHTML = '';
  $('revRestore').hidden = true;
  revSetStatus('读取版本链…', '');
  var d = $('revDrawer');
  d.hidden = false;
  requestAnimationFrame(function(){ d.classList.add('on'); });
  if(revIsDemo()){ revRender(); return; }
  api('api/memories/' + encodeURIComponent(id)).then(function(data){
    if(REV.id !== id) return;
    REV.data = data;
    revRender();
  }).catch(function(err){
    if(REV.id !== id) return;
    revSetStatus('读取失败 · ' + (err && err.message ? err.message : 'unknown'), 'bad');
  });
}

function revClose(){
  var d = $('revDrawer');
  d.classList.remove('on');
  setTimeout(function(){ if(!d.classList.contains('on')) d.hidden = true; }, 240);
  REV.id = null; REV.data = null; REV.ver = null;
}

function revRestoreVersion(){
  if(REV.busy || !REV.data) return;
  var versions = REV.data.versions || [];
  var view = null;
  versions.forEach(function(v){ if(v.v === REV.ver) view = v; });
  if(!view && versions.length) view = versions[versions.length - 1];
  if(!view) return;

  REV.busy = true;
  revSetStatus('正在恢复 v' + view.v + '…', '');

  var done = function(msg){
    REV.busy = false;
    revSetStatus(msg, 'ok');
    return api('api/memories/' + encodeURIComponent(REV.id)).then(function(data){
      REV.data = data;
      REV.ver = null;
      revRender();
      revSetStatus(msg, 'ok');
      if(typeof refresh === 'function') refresh({ quiet:true });
    }).catch(function(){});
  };
  var fail = function(err){
    REV.busy = false;
    revSetStatus('恢复失败 · ' + (err && err.message ? err.message : 'unknown'), 'bad');
  };

  if(REV.data.layer === 'semantic'){
    api('api/conflicts/' + encodeURIComponent(view.id) + '/restore', { method:'POST', body:{} })
      .then(function(){ return done('已恢复 v' + view.v + ' · 旧值回到生效位'); })
      .catch(fail);
    return;
  }

  var patch = {};
  Object.keys(view.fields || {}).forEach(function(k){ patch[k] = view.fields[k]; });
  api('api/memories/' + encodeURIComponent(REV.id), { method:'PATCH', body:patch })
    .then(function(){ return done('已恢复 v' + view.v + ' · 历史另存一版'); })
    .catch(fail);
}

function wireRevisions(){
  $('revClose').addEventListener('click', revClose);
  $('revChips').addEventListener('click', function(e){
    var b = e.target.closest('[data-ver]');
    if(!b) return;
    REV.ver = +b.getAttribute('data-ver');
    revRender();
  });
  $('revRestore').addEventListener('click', revRestoreVersion);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && !$('revDrawer').hidden) revClose();
  });
}

`;
t = t.replace(anchor, logic + anchor);

/* 2) 行点击 → 打开抽屉；放在 tlInner 的删除监听之后 */
const clickAnchor = `  $('tlInner').addEventListener('click', function(e){
    var b = e.target.closest('[data-del]');
    if(!b) return;`;
if (!t.includes(clickAnchor)) throw new Error('click anchor missing');
const rowClick = `  $('tlInner').addEventListener('click', function(e){
    if(e.target.closest('[data-del]')) return;
    var row = e.target.closest('.tl-row');
    if(!row) return;
    var id = row.getAttribute('data-id');
    var layer = row.getAttribute('data-layer');
    var item = TL.rows.filter(function(r){ return r.id === id; })[0];
    revOpen(id, layer, item ? item.title : id);
  });
`;
t = t.replace(clickAnchor, rowClick + clickAnchor);

/* 3) 初始化：wireRevisions 在 init 里调用 */
const initAnchor = "  renderChronicle();";
if (!t.includes(initAnchor)) throw new Error('init anchor missing');
t = t.replace(initAnchor, "  renderChronicle();\n  wireRevisions();");

/* 4) PATCH 需要方法名支持：api() 已按 opts.method 透传，无需改动 */

fs.writeFileSync(p, t);
console.log('js ok', t.length);

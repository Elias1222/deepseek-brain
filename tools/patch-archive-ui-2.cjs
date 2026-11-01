const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/dashboard.html';
let t = fs.readFileSync(p, 'utf8');

const anchor = 'function revClose(){';
if (!t.includes(anchor)) throw new Error('revClose anchor');

const js = `/* ── archive drawer ─────────────────────────────────────────── */
var ARC = { q: '', layer: '', items: [], total: 0, busy: false };

function arcIsDemo(){ return !!(S && S.mode === 'demo'); }

function arcOpen(){
  wireArchive();
  var d = $('arcDrawer');
  d.hidden = false;
  requestAnimationFrame(function(){ d.classList.add('on'); });
  arcLoad();
}

function arcClose(){
  var d = $('arcDrawer');
  d.classList.remove('on');
  setTimeout(function(){ if(!d.classList.contains('on')) d.hidden = true; }, 240);
}

function arcSetStatus(text, kind){
  var el = $('arcSt');
  if(!el) return;
  el.className = 'rev-st' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function arcRowsHtml(items){
  return items.map(function(it){
    var when = it.archivedAt ? String(it.archivedAt).slice(5, 16).replace('T', ' ') : '—';
    var reason = it.reason === 'superseded' ? '被新说法取代' : it.reason === 'decay' ? '衰减遗忘' : '手动归档';
    return '<div class="arc-row">' +
      '<span class="when">' + esc(when) + '</span>' +
      '<span class="what"><b>' + esc(trunc(it.title, 64)) + '</b><i>' + esc(layerLabel(it.layer)) + ' · ' + esc(reason) + ' · ' + esc(it.id) + '</i></span>' +
      '<button class="btn btn-ghost" type="button" data-arc="' + esc(it.id) + '">取回</button>' +
      '</div>';
  }).join('');
}

function arcLoad(){
  var body = $('arcList');
  if(!body) return;
  if(arcIsDemo()){
    body.innerHTML = '<p class="arc-empty">离线演示里没有归档区：归档写在宿主服务的 archive.json 里。</p>';
    arcSetStatus('离线演示 · 只读', '');
    return;
  }
  arcSetStatus('读取归档区…', '');
  var qs = 'api/archive?limit=60';
  if(ARC.q) qs += '&q=' + encodeURIComponent(ARC.q);
  if(ARC.layer) qs += '&layer=' + ARC.layer;
  api(qs).then(function(data){
    ARC.items = data.items || [];
    ARC.total = data.total || 0;
    body.innerHTML = ARC.total
      ? arcRowsHtml(ARC.items)
      : '<p class="arc-empty">归档区是空的：没有遗忘、没有清理，也没有被手动归档的记忆。</p>';
    arcSetStatus('共 ' + ARC.total + ' 条 · 情景 ' + data.byLayer.episodic +
      ' / 语义 ' + data.byLayer.semantic + ' / 程序 ' + data.byLayer.procedural, '');
  }).catch(function(err){
    body.innerHTML = '<p class="arc-empty">读取失败：' + esc(err && err.message ? err.message : 'unknown') + '</p>';
    arcSetStatus('读取失败', 'bad');
  });
}

function arcRestore(id){
  if(ARC.busy) return;
  ARC.busy = true;
  arcSetStatus('取回中…', '');
  api('api/archive/' + encodeURIComponent(id) + '/restore', { method: 'POST' }).then(function(res){
    ARC.busy = false;
    arcSetStatus('已取回 → ' + layerLabel(res.layer) + ' · ' + trunc(res.title || id, 40), 'ok');
    arcLoad();
    if(typeof refreshState === 'function') refreshState();
    if(typeof renderDeprecated === 'function') renderDeprecated();
  }).catch(function(err){
    ARC.busy = false;
    arcSetStatus('取回失败 · ' + (err && err.message ? err.message : 'unknown'), 'bad');
  });
}

function wireArchive(){
  if(window.__arcWired) return;
  window.__arcWired = true;

  $('arcOpen').addEventListener('click', arcOpen);
  $('arcClose').addEventListener('click', arcClose);

  $('arcGo').addEventListener('click', function(){
    ARC.q = $('arcQuery').value.trim();
    arcLoad();
  });
  $('arcQuery').addEventListener('keydown', function(ev){
    if(ev.key === 'Enter'){ ARC.q = $('arcQuery').value.trim(); arcLoad(); }
  });

  $('arcChips').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-layer]');
    if(!b) return;
    ARC.layer = b.getAttribute('data-layer') || '';
    Array.prototype.forEach.call($('arcChips').querySelectorAll('.arc-chip'), function(x){
      x.classList.toggle('on', x === b);
    });
    arcLoad();
  });

  $('arcList').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-arc]');
    if(b) arcRestore(b.getAttribute('data-arc'));
  });

  document.addEventListener('keydown', function(ev){
    if(ev.key === 'Escape' && !$('arcDrawer').hidden) arcClose();
  });
}

` + anchor;

t = t.replace(anchor, js);

/* 首屏绑定：bindNav 里顺手接上（按钮已存在） */
const bindAnchor = '  Array.prototype.forEach.call(document.querySelectorAll(\'.dial-btn, #mnav button, .brand\'), function(b){';
if (!t.includes(bindAnchor)) throw new Error('bindNav anchor');
t = t.replace(bindAnchor, '  wireArchive();\n' + bindAnchor);

fs.writeFileSync(p, t);
console.log('ok');

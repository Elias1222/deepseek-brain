const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* ---------- CSS ---------- */
sub('</style>',
`/* 检索史：左侧栏底部的时间轴 */
.hist { margin-top: 10px; border-top: 1px dashed var(--line, rgba(230,224,210,.14)); padding-top: 8px; }
.hist-hd { display: flex; justify-content: space-between; align-items: baseline;
  font: 9px/1 var(--mono); letter-spacing: .18em; color: var(--dim, #7c7a70); text-transform: uppercase; }
.hist-hd b { font-weight: 500; color: var(--paper-3, #b9b3a4); letter-spacing: .1em; }
.hist ol { list-style: none; margin: 6px 0 0; padding: 0; }
.hist li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 6px;
  align-items: center; padding: 3px 2px; cursor: pointer; border-radius: 1px; }
.hist li:hover { background: rgba(230,224,210,.05); }
.hist li.on { background: rgba(200,72,46,.10); box-shadow: inset 2px 0 0 #c8482e; }
.hist .t { font: 9px/1.4 var(--mono); color: var(--dim, #7c7a70); font-variant-numeric: tabular-nums; }
.hist .q { font-size: 10px; color: var(--paper-2, #cfc9ba); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hist .m { display: flex; gap: 2px; align-items: center; }
.hist .m i { display: block; width: 3px; height: 8px; border-radius: .5px; opacity: .85; }
.hist .empty { font: 9px/1.5 var(--mono); color: var(--dim, #7c7a70); padding: 4px 2px; }
</style>`, 'hist-css');

/* ---------- 状态与记录 ---------- */
sub(`  function relHotKey() {`,
`  /* 检索史：最近 12 次查询，按时间倒序；点一行就重放那次检索的聚光与纤维束 */
  APP.queries = [];
  var HIST_MAX = 12;
  function histPush(q, hits) {
    var text = String(q || '').trim();
    if (!text) return;
    var last = APP.queries[0];
    if (last && last.q === text && (Date.now() - last.at) < 4000) return; /* 同一句话的重复回放不记两次 */
    APP.queries.unshift({
      at: Date.now(),
      q: text,
      hits: (hits || []).map(function (h) {
        return { id: h.id, layer: h.layer, score: num(h.score, 0) };
      }),
    });
    if (APP.queries.length > HIST_MAX) APP.queries.length = HIST_MAX;
    renderHistory();
  }
  function histLayerColors(hits) {
    var seen = {}, out = [];
    (hits || []).forEach(function (h) {
      var key = h.layer || 'episodic';
      if (seen[key]) return;
      seen[key] = 1;
      out.push(key);
    });
    return out;
  }
  function renderHistory() {
    var host = document.getElementById('histList');
    if (!host) return;
    if (!APP.queries.length) {
      host.innerHTML = '<p class="empty">还没有检索记录。</p>';
      return;
    }
    host.innerHTML = APP.queries.map(function (it, i) {
      var t = new Date(it.at);
      var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
      var layers = histLayerColors(it.hits);
      var marks = layers.map(function (k) {
        var c = REGION[k] ? REGION[k].color : '#e6e0d2';
        return '<i style="background:' + c + '" title="' + (REGION[k] ? REGION[k].label : k) + '"></i>';
      }).join('');
      return '<li data-hist="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' +
        '<span class="t">' + hh + '</span>' +
        '<span class="q">' + escapeHTML(it.q) + '</span>' +
        '<span class="m">' + (marks || '<i style="background:#4a4842"></i>') + '</span>' +
        '</li>';
    }).join('');
  }
  function wireHistory() {
    var host = document.getElementById('histList');
    if (!host || host.__wired) return;
    host.__wired = true;
    host.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('li[data-hist]') : null;
      if (!li) return;
      var it = APP.queries[Number(li.getAttribute('data-hist'))];
      if (!it) return;
      Array.prototype.forEach.call(host.querySelectorAll('li'), function (x) { x.classList.remove('on'); });
      li.classList.add('on');
      runRecallPulses(it.hits, 0.85);
      setStatus('重放检索 · ' + truncate(it.q, 18), it.hits.length + ' 命中', '');
    });
  }
  function ensureHistoryPanel() {
    if (document.getElementById('histList')) { wireHistory(); return; }
    var anchor = document.getElementById('heatNote');
    var box = document.createElement('section');
    box.className = 'hist';
    box.innerHTML = '<div class="hist-hd"><b>检索史</b><span>最近 12 次 · 点击重放</span></div>' +
      '<ol id="histList"></ol>';
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    } else if ($('boardSource') && $('boardSource').parentNode) {
      $('boardSource').parentNode.appendChild(box);
    } else return;
    wireHistory();
    renderHistory();
  }

  function relHotKey() {`, 'hist-core');

/* ---------- 事件里记录 ---------- */
sub(`      APP.lastRecallQuery = ev.query || APP.lastRecallQuery;`,
`      APP.lastRecallQuery = ev.query || APP.lastRecallQuery;
      histPush(ev.query, hits);`, 'hist-record');

/* ---------- 渲染时机 ---------- */
sub(`      if (APP.heatDirty) { renderHeatNote(); APP.heatDirty = false; }`,
`      if (APP.heatDirty) { renderHeatNote(); ensureHistoryPanel(); APP.heatDirty = false; }`, 'hist-ensure');

fs.writeFileSync(p, t);
console.log('patched', n);

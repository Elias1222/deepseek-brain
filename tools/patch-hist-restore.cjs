const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 从服务端活动流重建检索史：刷新后不丢，落盘由服务端的进程内日志兜住 */
sub(`  function setConn(live) {`,
`  /* 刷新页面后左栏不该空着：把服务端活动流里的 recall 记录重建成检索史。
     活动流本身是进程内的（不是磁盘），所以能跨刷新、不跨重启——这是刻意取舍。 */
  function loadHistoryFromActivity() {
    return apiGet('api/activity?since=0&limit=200').then(function (res) {
      var events = (res && res.events) || [];
      var list = [];
      events.forEach(function (ev) {
        if (!ev || ev.kind !== 'recall' || !ev.query) return;
        list.push({
          at: ev.ts || Date.now(),
          q: String(ev.query),
          hits: (ev.hits || []).map(function (h) {
            return { id: h.id, layer: h.layer, score: num(h.score, 0), title: h.title || '' };
          }),
        });
      });
      if (!list.length) return;
      list.sort(function (a, b) { return b.at - a.at; });
      /* 与已经收到的事件合并：同一秒同一句只算一条 */
      var seen = {};
      var merged = [];
      APP.queries.concat(list).forEach(function (it) {
        var k = Math.round(it.at / 1000) + '|' + it.q;
        if (seen[k]) return;
        seen[k] = 1;
        merged.push(it);
      });
      merged.sort(function (a, b) { return b.at - a.at; });
      APP.queries = merged.slice(0, HIST_MAX);
      APP.graphIdx = 0;
      var r = document.getElementById('histRange');
      if (r) r.max = String(Math.max(0, APP.queries.length - 1));
      if (typeof window.__uiRedraw === 'function') window.__uiRedraw();
    }).catch(function () {});
  }

  function setConn(live) {`, 'hist-restore-fn');

sub(`    if (live) openEventStream(); else closeEventStream();`,
`    if (live) { openEventStream(); loadHistoryFromActivity(); } else closeEventStream();`, 'hist-restore-call');

fs.writeFileSync(p, t);
console.log('patched', n);

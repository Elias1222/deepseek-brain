const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* ---------- CSS ---------- */
sub('.hist .empty { font: 9px/1.5 var(--mono); color: var(--dim, #7c7a70); padding: 4px 2px; }',
`.hist .empty { font: 9px/1.5 var(--mono); color: var(--dim, #7c7a70); padding: 4px 2px; }
.hist .gph { margin-top: 8px; border-top: 1px dashed var(--line, rgba(230,224,210,.14)); padding-top: 8px; }
.hist .gph svg { display: block; width: 100%; height: auto; }
.hist .gph .cap { font: 9px/1.5 var(--mono); color: var(--dim, #7c7a70); margin-top: 4px; }
.hist .gph .delta { font: 9px/1.6 var(--mono); margin-top: 2px; font-variant-numeric: tabular-nums; }
.hist .gph .delta em { font-style: normal; color: #7fb06a; }
.hist .gph .delta i { font-style: normal; color: #c8482e; }
.hist .gph .delta b { font-weight: 500; color: var(--paper-3, #b9b3a4); }`, 'graph-css');

/* ---------- 关联图 ---------- */
sub(`  function ensureHistoryPanel() {`,
`  /* 查询 → 命中 的关联图：中心是查询，四周是命中，半径按 score；
     再跟「上一次同话题的查询」比一比，多命中了什么、漏了什么。 */
  function queryTokens(q) {
    var s = String(q || '').toLowerCase().replace(/\\s+/g, '');
    var out = {};
    for (var i = 0; i < s.length - 1; i++) out[s.slice(i, i + 2)] = 1;
    if (!s.length) out[s] = 1;
    return out;
  }
  function querySimilar(a, b) {
    var A = queryTokens(a), B = queryTokens(b);
    var ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var hit = 0;
    ka.forEach(function (k) { if (B[k]) hit++; });
    return hit / Math.min(ka.length, kb.length);
  }
  function graphSVG(entry, prev) {
    var W = 262, H = 200, cx = W / 2, cy = H / 2 - 6, R = 68;
    var hits = entry.hits || [];
    var layers = ['sensory', 'working', 'episodic', 'semantic', 'procedural'];
    var prevIds = {};
    if (prev) (prev.hits || []).forEach(function (h) { prevIds[h.id] = 1; });
    var curIds = {};
    hits.forEach(function (h) { curIds[h.id] = 1; });

    /* 按层分组排布：同层的命中挨着，层与层之间留角度 */
    var sorted = hits.slice().sort(function (a, b) {
      var ia = layers.indexOf(a.layer), ib = layers.indexOf(b.layer);
      return ia === ib ? b.score - a.score : ia - ib;
    });
    var nodes = sorted.map(function (h, i) {
      var a = (i / Math.max(1, sorted.length)) * Math.PI * 2 - Math.PI / 2;
      var r = R + (i % 2 ? 12 : 0);
      return {
        id: h.id, layer: h.layer, score: num(h.score, 0),
        x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
        col: REGION[h.layer] ? REGION[h.layer].color : '#e6e0d2',
        isNew: prev ? !prevIds[h.id] : false,
      };
    });

    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="查询与命中的关联图">');
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="rgba(230,224,210,.10)" stroke-width="1"/>');
    nodes.forEach(function (nd) {
      var w = 0.25 + 0.75 * nd.score;
      parts.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + nd.x.toFixed(1) + '" y2="' + nd.y.toFixed(1) +
        '" stroke="' + nd.col + '" stroke-opacity="' + (0.18 + 0.42 * nd.score).toFixed(2) +
        '" stroke-width="' + (0.6 + 1.6 * nd.score * w).toFixed(2) + '"/>');
      var rr = 3 + 5.5 * nd.score;
      parts.push('<circle cx="' + nd.x.toFixed(1) + '" cy="' + nd.y.toFixed(1) + '" r="' + rr.toFixed(2) +
        '" fill="' + nd.col + '" fill-opacity="' + (0.55 + 0.45 * nd.score).toFixed(2) + '"/>');
      if (nd.isNew) {
        parts.push('<circle cx="' + nd.x.toFixed(1) + '" cy="' + nd.y.toFixed(1) + '" r="' + (rr + 3).toFixed(2) +
          '" fill="none" stroke="' + nd.col + '" stroke-opacity=".75" stroke-width="1" stroke-dasharray="2 2"/>');
      }
    });
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="#e6e0d2" fill-opacity=".92"/>');
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="none" stroke="rgba(230,224,210,.35)"/>');
    parts.push('<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" fill="#7c7a70" ' +
      'font-family="ui-monospace,monospace">' + hits.length + ' 命中 · ' + new Set(sorted.map(function (x) { return x.layer; })).size + ' 层</text>');
    parts.push('</svg>');
    return parts.join('');
  }

  function graphDelta(entry, prev) {
    if (!prev) return '<span class="cap">还没有可对比的上一次同话题检索。</span>';
    var prevIds = {}, curIds = {};
    (prev.hits || []).forEach(function (h) { prevIds[h.id] = 1; });
    (entry.hits || []).forEach(function (h) { curIds[h.id] = 1; });
    var added = Object.keys(curIds).filter(function (k) { return !prevIds[k]; }).length;
    var lost = Object.keys(prevIds).filter(function (k) { return !curIds[k]; }).length;
    var kept = Object.keys(curIds).filter(function (k) { return prevIds[k]; }).length;
    return '<span class="cap">对比「' + escapeHTML(truncate(prev.q, 12)) + '」：' +
      '<span class="delta"><em>+' + added + '</em> 新命中 · <i>−' + lost + '</i> 落空 · <b>=' + kept + '</b> 保留</span></span>';
  }

  APP.graphIdx = 0;
  function renderGraphPanel() {
    var host = document.getElementById('graphBox');
    if (!host) return;
    var entry = APP.queries[APP.graphIdx || 0];
    if (!entry) { host.innerHTML = '<span class="cap">还没有检索，图是空的。</span>'; return; }
    /* 找上一次「同话题」的检索（token 相似度 ≥ 0.4） */
    var prev = null;
    for (var i = (APP.graphIdx || 0) + 1; i < APP.queries.length; i++) {
      if (querySimilar(entry.q, APP.queries[i].q) >= 0.4) { prev = APP.queries[i]; break; }
    }
    host.innerHTML = graphSVG(entry, prev) + graphDelta(entry, prev);
  }

  function ensureHistoryPanel() {`, 'graph-core');

/* ---------- 面板里插入图容器 ---------- */
sub(`      '<ol id="histList"></ol>';`,
`      '<ol id="histList"></ol>' +
      '<div class="gph"><div id="graphBox"></div></div>';`, 'graph-dom');

/* ---------- 刷新时机 ---------- */
sub(`    wireHistory();
    renderHistory();
  }`,
`    wireHistory();
    renderHistory();
    renderGraphPanel();
  }`, 'graph-ensure');

sub(`    if (APP.queries.length > HIST_MAX) APP.queries.length = HIST_MAX;
    renderHistory();`,
`    if (APP.queries.length > HIST_MAX) APP.queries.length = HIST_MAX;
    APP.graphIdx = 0;
    renderHistory();
    renderGraphPanel();`, 'graph-push');

/* ---------- 点历史行时切换关联图 ---------- */
sub(`      li.classList.add('on');
      runRecallPulses(it.hits, 0.85);`,
`      li.classList.add('on');
      APP.graphIdx = Number(li.getAttribute('data-hist')) || 0;
      renderGraphPanel();
      runRecallPulses(it.hits, 0.85);`, 'graph-click');

fs.writeFileSync(p, t);
console.log('patched', n);

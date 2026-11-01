const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* CSS：只有命中节点吃指针事件，浮卡本身仍然穿透，不挡标本拖拽 */
sub(`@media (max-width: 900px) { .stageGraph { display: none; } }`,
`@media (max-width: 900px) { .stageGraph { display: none; } }
.stageGraph svg .hit { pointer-events: auto; cursor: crosshair; }
.stageGraph .hov { font: 9px/1.5 var(--mono); color: var(--paper-2, #cfc9ba); margin-top: 2px;
  min-height: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stageGraph .hov b { font-weight: 500; color: #e0846a; }`, 'hover-css');

/* 历史里要留标题，悬停提示才有内容 */
sub(`        return { id: h.id, layer: h.layer, score: num(h.score, 0) };`,
`        return { id: h.id, layer: h.layer, score: num(h.score, 0), title: h.title || '' };`, 'hover-title');

/* 节点加 data-id 与一个更大的透明命中区 */
sub(`      if (nd.isNew) {`,
`      parts.push('<circle class="hit" data-id="' + escapeHTML(nd.id) + '" cx="' + nd.x.toFixed(1) + '" cy="' + nd.y.toFixed(1) +
        '" r="' + Math.max(7, rr + 3).toFixed(2) + '" fill="transparent" pointer-events="auto"/>');
      if (nd.isNew) {`, 'hover-hitarea');

/* 悬停状态与联动 */
sub(`  function renderGraphPanel() {
    ensureStageGraph();
    var host = document.getElementById('graphBox');
    if (!host) return;
    var entry = APP.queries[APP.graphIdx || 0];
    if (!entry) { host.innerHTML = '<span class="cap">还没有检索，图是空的。</span>'; return; }`,
`  /* 悬停联动：图上一点 ↔ 脑里一枚。悬停时把那枚顶到最亮、其余压暗。 */
  APP.hoverId = null;
  function setHoverEngram(id) {
    if (APP.hoverId === id) return;
    APP.hoverId = id || null;
    allEngrams(APP.model).forEach(function (rec) {
      if (rec.inst == null || rec.ghost) return;
      placeEngram(rec, null, 1, null, null);
    });
    var el = document.getElementById('graphHover');
    if (!el) return;
    if (!APP.hoverId) { el.innerHTML = ''; return; }
    var entry = APP.queries[APP.graphIdx || 0];
    var hit = null;
    if (entry) (entry.hits || []).forEach(function (h) { if (h.id === APP.hoverId) hit = h; });
    el.innerHTML = hit
      ? ('<b>' + escapeHTML((REGION[hit.layer] || {}).label || hit.layer) + '</b> · ' +
         escapeHTML(hit.title || hit.id) + ' · ' + num(hit.score, 0).toFixed(2))
      : '';
  }
  function wireGraphHover() {
    var host = document.getElementById('graphBox');
    if (!host || host.__hwired) return;
    host.__hwired = true;
    host.addEventListener('mouseover', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('.hit') : null;
      if (el) setHoverEngram(el.getAttribute('data-id'));
    });
    host.addEventListener('mouseout', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('.hit') : null;
      if (el && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.hit'))) setHoverEngram(null);
    });
    host.addEventListener('mouseleave', function () { setHoverEngram(null); });
  }

  function renderGraphPanel() {
    ensureStageGraph();
    var host = document.getElementById('graphBox');
    if (!host) return;
    var entry = APP.queries[APP.graphIdx || 0];
    if (!entry) { host.innerHTML = '<span class="cap">还没有检索，图是空的。</span>'; return; }`, 'hover-core');

/* 渲染后接上监听的兜底 + 悬停提示行 */
sub(`    host.innerHTML = graphSVG(entry, prev) + graphDelta(entry, prev);
  }`,
`    host.innerHTML = graphSVG(entry, prev) + graphDelta(entry, prev) + '<div class="hov" id="graphHover"></div>';
    wireGraphHover();
  }`, 'hover-wire');

/* placeEngram：悬停优先于常规 dim/hi */
sub(`    /* 硬边：选中 0.85；否则由「上一次检索有多像」给一点轮廓光 */
    N.hi.setX(rec.inst, hi == null
      ? (APP.selected === rec.id ? 0.85 : 0.62 * relOf(rec.id))
      : hi);
    N.dim.setX(rec.inst, dim == null ? ((APP.selected && APP.selected !== rec.id) ? 1 : 0) : dim);`,
`    /* 硬边：悬停 > 选中 > 相关度 */
    var hovered = APP.hoverId === rec.id;
    var dimmed = APP.hoverId && !hovered;
    N.hi.setX(rec.inst, hovered ? 1
      : (hi != null ? hi
        : (APP.selected === rec.id ? 0.85 : 0.62 * relOf(rec.id))));
    N.dim.setX(rec.inst, dimmed ? Math.max(dim == null ? 0 : dim, 0.92)
      : (dim == null ? ((APP.selected && APP.selected !== rec.id) ? 1 : 0) : dim));`, 'hover-place');

fs.writeFileSync(p, t);
console.log('patched', n);

const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* CSS：节奏条 */
sub(`.hist .scrub { margin-top: 6px; display: flex; align-items: center; gap: 8px; }`,
`.hist .rhythm { margin-top: 8px; }
.hist .rhythm svg { display: block; width: 100%; height: auto; }
.hist .rhythm .cap { font: 9px/1.5 var(--mono); color: var(--dim, #7c7a70); margin-top: 2px; }
.hist .rhythm .cap b { font-weight: 500; color: var(--paper-3, #b9b3a4); }
.hist .scrub { margin-top: 6px; display: flex; align-items: center; gap: 8px; }`, 'rhythm-css');

/* DOM：节奏条放在滑杆之前 */
sub(`      '<div class="scrub"><input type="range" id="histRange"`,
`      '<div class="rhythm"><div id="rhythmBox"></div></div>' +
      '<div class="scrub"><input type="range" id="histRange"`, 'rhythm-dom');

/* 节奏图：间距按真实间隔压缩，连续追查会挤成一簇，隔很久才想起的会拉开 */
sub(`  function wireScrub() {`,
`  function rhythmSVG() {
    var qs = APP.queries.slice().reverse(); /* 时间正序 */
    if (!qs.length) return '<span class="cap">还没有检索。</span>';
    var W = 268, H = 34, padL = 4, padR = 4, baseY = 22;
    var t0 = qs[0].at, t1 = qs[qs.length - 1].at;
    var span = Math.max(1, t1 - t0);
    /* 相邻间隔先压缩再累加成「节奏坐标」：一秒的间隔与一分钟的间隔不会差 60 倍宽 */
    var steps = [], acc = 0;
    for (var i = 1; i < qs.length; i++) {
      acc += Math.log1p((qs[i].at - qs[i - 1].at) / 1000);
      steps.push(acc);
    }
    var total = steps.length ? steps[steps.length - 1] : 0;
    var xs = [0];
    steps.forEach(function (s) { xs.push(total > 0 ? s / total : (xs.length / Math.max(1, qs.length - 1))); });
    if (!total) {
      xs = qs.map(function (_, i) { return qs.length === 1 ? 0.5 : i / (qs.length - 1); });
    }
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="检索节奏">');
    parts.push('<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY +
      '" stroke="rgba(230,224,210,.16)" stroke-width="1"/>');
    qs.forEach(function (q, i) {
      var x = padL + xs[i] * (W - padL - padR);
      var col = REGION[(q.hits[0] || {}).layer] ? REGION[q.hits[0].layer].color : '#e6e0d2';
      var h = 6 + Math.min(10, (q.hits || []).length * 3);
      var idx = APP.queries.length - 1 - i; /* 还原成 queries 里的下标（0 = 最新） */
      var on = idx === (APP.graphIdx || 0);
      parts.push('<line x1="' + x.toFixed(1) + '" y1="' + (baseY - h) + '" x2="' + x.toFixed(1) + '" y2="' + baseY +
        '" stroke="' + col + '" stroke-opacity="' + (on ? 1 : 0.55).toFixed(2) + '" stroke-width="' + (on ? 2 : 1.2) + '"/>');
      parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + baseY + '" r="' + (on ? 2.4 : 1.6) +
        '" fill="' + col + '" fill-opacity="' + (on ? 1 : 0.6).toFixed(2) + '"/>');
    });
    parts.push('</svg>');

    /* 读数：跨度 + 最密的一段 */
    var gap = 0, gapAt = 0;
    for (var j = 1; j < qs.length; j++) {
      var d = qs[j].at - qs[j - 1].at;
      if (d > gap) { gap = d; gapAt = j; }
    }
    function hhmm(ms) {
      var m = Math.round(ms / 60000);
      if (m < 1) return Math.round(ms / 1000) + ' s';
      if (m < 60) return m + ' min';
      return (m / 60).toFixed(1) + ' h';
    }
    var cap = '跨度 <b>' + hhmm(span) + '</b> · ' + qs.length + ' 次' +
      (gap > 0 ? ' · 最长停顿 <b>' + hhmm(gap) + '</b>' : '');
    parts.push('<div class="cap">' + cap + '</div>');
    return parts.join('');
  }
  function renderRhythm() {
    var host = document.getElementById('rhythmBox');
    if (!host) return;
    host.innerHTML = rhythmSVG();
  }

  function wireScrub() {`, 'rhythm-core');

/* 渲染时机 */
sub(`    renderGraphPanel();
    wireScrub();
  }`, `    renderGraphPanel();
    renderRhythm();
    wireScrub();
  }`, 'rhythm-wire');

sub(`    APP.graphIdx = 0;
    renderHistory();`,
`    APP.graphIdx = 0;
    renderHistory();
    renderRhythm();`, 'rhythm-push');

sub(`      APP.graphIdx = Number(li.getAttribute('data-hist')) || 0;
      renderGraphPanel();`,
`      APP.graphIdx = Number(li.getAttribute('data-hist')) || 0;
      renderGraphPanel();
      renderRhythm();`, 'rhythm-click');

fs.writeFileSync(p, t);
console.log('patched', n);

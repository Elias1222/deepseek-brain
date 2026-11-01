const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* ---------- CSS：时间轴滑杆 ---------- */
sub(`.stageGraph svg .hit { pointer-events: auto; cursor: crosshair; }`,
`.stageGraph svg .hit { pointer-events: auto; cursor: crosshair; }
.hist .scrub { margin-top: 6px; display: flex; align-items: center; gap: 8px; }
.hist .scrub input[type=range] { flex: 1; -webkit-appearance: none; appearance: none;
  height: 2px; background: rgba(230,224,210,.16); outline: none; cursor: ew-resize; }
.hist .scrub input[type=range]::-webkit-slider-thumb { -webkit-appearance: none;
  width: 8px; height: 12px; background: #c8482e; border: none; border-radius: 1px; cursor: ew-resize; }
.hist .scrub input[type=range]::-moz-range-thumb { width: 8px; height: 12px; background: #c8482e;
  border: none; border-radius: 1px; cursor: ew-resize; }
.hist .scrub span { font: 9px/1.4 var(--mono); color: var(--dim, #7c7a70);
  font-variant-numeric: tabular-nums; white-space: nowrap; }`, 'scrub-css');

/* ---------- 焦点保持模式 ---------- */
sub(`  function updateFocus(dt) {
    if (!APP.focus.on) return;
    APP.focus.t += dt;
    if (APP.focus.t >= APP.focus.dur) { clearFocus(); return; }
    var w = focusBell();`,
`  function updateFocus(dt) {
    if (!APP.focus.on) return;
    APP.focus.t += dt;
    if (APP.focus.t >= APP.focus.dur) {
      if (APP.focus.hold) APP.focus.t = APP.focus.dur * 0.5; /* 拖动时间轴时不自行熄灭 */
      else { clearFocus(); return; }
    }
    var w = APP.focus.hold ? 1 : focusBell();`, 'scrub-hold');

sub(`  function setFocus(hits) {`, `  function setFocus(hits, opts) {`, 'scrub-setfocus-sig');
sub(`    APP.focus.on = true; APP.focus.ids = ids; APP.focus.t = 0;`,
`    APP.focus.on = true; APP.focus.ids = ids;
    APP.focus.hold = !!(opts && opts.hold);
    APP.focus.t = 0;`, 'scrub-setfocus-body');

/* ---------- 时间轴 DOM ---------- */
sub(`      '<ol id="histList"></ol>';`,
`      '<ol id="histList"></ol>' +
      '<div class="scrub"><input type="range" id="histRange" min="0" max="11" step="0.02" value="0" aria-label="检索史时间轴"><span id="histPos">最近</span></div>';`, 'scrub-dom');

/* ---------- 拖动逻辑 ---------- */
sub(`  function ensureHistoryPanel() {`,
`  /* 时间轴回放：把最近 N 次检索当成一段可拖的时间，拖到两帧之间就插值出一次「中间检索」 */
  function scrubMerge(a, b, f) {
    var bag = {};
    function add(entry, weight) {
      (entry.hits || []).forEach(function (h) {
        var cur = bag[h.id];
        var w = (num(h.score, 0)) * weight;
        if (!cur || w > cur.score) bag[h.id] = { id: h.id, layer: h.layer, score: w };
      });
    }
    add(a, 1 - f);
    if (b && f > 0) add(b, f);
    return Object.keys(bag).map(function (k) { return bag[k]; });
  }
  function scrubTo(value) {
    var qs = APP.queries;
    if (!qs.length) return;
    var v = clamp(Number(value) || 0, 0, Math.max(0, qs.length - 1));
    var i = Math.floor(v), f = v - i;
    var a = qs[i], b = qs[i + 1] || null;
    var merged = scrubMerge(a, b, b ? f : 0);
    setFocus(merged, { hold: true });
    var posEl = document.getElementById('histPos');
    if (posEl) {
      var la = a ? truncate(a.q, 10) : '';
      var lb = (b && f > 0.02) ? truncate(b.q, 10) : '';
      posEl.textContent = lb
        ? (Math.round(f * 100) + '% ' + la + ' → ' + lb)
        : ('第 1 / ' + qs.length + ' · ' + la);
    }
    if (APP.focus.center && focusRing) {
      focusRing.position.copy(APP.focus.center);
      focusRing.visible = true;
    }
  }
  function wireScrub() {
    var r = document.getElementById('histRange');
    if (!r || r.__wired) return;
    r.__wired = true;
    r.max = String(Math.max(0, APP.queries.length - 1));
    r.addEventListener('input', function () { scrubTo(r.value); });
    r.addEventListener('change', function () {
      var qs = APP.queries;
      var i = clamp(Math.round(Number(r.value) || 0), 0, Math.max(0, qs.length - 1));
      var it = qs[i];
      APP.graphIdx = i;
      renderGraphPanel();
      if (it) runRecallPulses(it.hits, 0.9);
      var li = document.querySelectorAll('#histList li')[i];
      if (li) {
        Array.prototype.forEach.call(document.querySelectorAll('#histList li'), function (x) { x.classList.remove('on'); });
        li.classList.add('on');
      }
    });
  }

  function ensureHistoryPanel() {`, 'scrub-core');

sub(`    wireHistory();
    renderHistory();
    renderGraphPanel();
  }`,
`    wireHistory();
    renderHistory();
    renderGraphPanel();
    wireScrub();
  }`, 'scrub-wire');

sub(`    APP.graphIdx = 0;
    renderHistory();
    renderGraphPanel();`,
`    APP.graphIdx = 0;
    renderHistory();
    var rr = document.getElementById('histRange');
    if (rr) { rr.max = String(Math.max(0, APP.queries.length - 1)); }
    renderGraphPanel();`, 'scrub-max');

fs.writeFileSync(p, t);
console.log('patched', n);

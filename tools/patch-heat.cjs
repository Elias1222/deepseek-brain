const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* ---------- 1. 热度状态与累积规则 ---------- */
sub(`  function ingestEvent(ev, demo) {`,
`  /* 话题热度：把最近的活动折成每层的「被关注度」，让标本在闲置时也有缓慢流动的注意力。
     半衰期 32 s：一次检索的余温大约一分钟，够看清、不够形成噪声。 */
  APP.heat = { sensory: 0, working: 0, episodic: 0, semantic: 0, procedural: 0 };
  var HEAT_HALF_MS = 32000;
  function heatAdd(layer, amount) {
    if (!layer || !(layer in APP.heat)) return;
    APP.heat[layer] = clamp((APP.heat[layer] || 0) + amount, 0, 4);
  }
  function heatDecay(dt) {
    var k = Math.pow(0.5, (dt * 1000) / HEAT_HALF_MS);
    LAYERS.forEach(function (key) { APP.heat[key] *= k; });
  }
  function heatMax() {
    var m = 0;
    LAYERS.forEach(function (key) { if (APP.heat[key] > m) m = APP.heat[key]; });
    return m || 1;
  }
  function heatNorm(key) { return clamp(APP.heat[key] / heatMax(), 0, 1); }

  /* 每层一个加性光晕，位置就是该层的解剖锚点 */
  var heatHalo = (function () {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    var grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.30)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    var out = {};
    LAYERS.forEach(function (key) {
      var mat = new THREE.SpriteMaterial({
        map: tex, color: new THREE.Color(REGION[key].color),
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthTest: false, depthWrite: false, fog: false,
      });
      var sp = new THREE.Sprite(mat);
      var a = REGION[key].anchor;
      sp.position.set(a[0], a[1], a[2]);
      sp.scale.setScalar(0.95);
      sp.renderOrder = 6;
      scene.add(sp);
      out[key] = sp;
    });
    return out;
  })();

  var heatNote = null;
  function renderHeatNote() {
    if (!heatNote) {
      heatNote = document.createElement('p');
      heatNote.className = 'note';
      heatNote.id = 'heatNote';
      var host = $('boardSource');
      if (host && host.parentNode) host.parentNode.appendChild(heatNote);
    }
    var best = LAYERS.slice().sort(function (a, b) { return APP.heat[b] - APP.heat[a]; })[0];
    heatNote.textContent = APP.heat[best] > 0.08
      ? ('关注：' + REGION[best].label + ' ' + heatNorm(best).toFixed(2) +
         ' · 半衰期 32 s · 由活动流折算')
      : '关注：静默期，热度已衰减到 0。';
  }

  function updateHeat(dt) {
    heatDecay(dt);
    var m = heatMax();
    LAYERS.forEach(function (key) {
      var w = heatNorm(key);
      var sp = heatHalo[key];
      if (sp) {
        sp.material.opacity = 0.34 * w;
        sp.scale.setScalar(0.85 + 0.55 * w);
      }
    });
    APP.heatDirty = true;
  }

  function ingestEvent(ev, demo) {`, 'heat-core');

/* ---------- 2. 事件折算成热度 ---------- */
sub(`  function ingestEventInner(ev, demo) {
    var prefix = demo ? '演示 · ' : '';
    var kind = ev.kind;`,
`  function ingestEventInner(ev, demo) {
    var prefix = demo ? '演示 · ' : '';
    var kind = ev.kind;
    /* 事件 → 热度：写入抬自己那层，检索抬命中项所在层，睡眠是一次全局收敛 */
    if (kind === 'observe') heatAdd('sensory', 0.6), heatAdd('working', 1.0);
    else if (kind === 'remember') heatAdd(ev.layer || 'episodic', 1.6);
    else if (kind === 'recall') {
      (ev.hits || []).forEach(function (h) { heatAdd(h.layer, 1.1); });
      heatAdd('working', 0.5);
    } else if (kind === 'edit') heatAdd(ev.layer || 'episodic', 0.9);
    else if (kind === 'correct') heatAdd('semantic', 1.2);
    else if (kind === 'forget' || kind === 'prune') heatAdd(ev.layer || 'semantic', -0.5);
    else if (kind === 'restore' || kind === 'archive') heatAdd(ev.layer || 'episodic', 0.7);
    else if (kind === 'consolidate' || kind === 'sleep') {
      LAYERS.forEach(function (k) { APP.heat[k] *= 0.62; });
    }`, 'heat-events');

/* ---------- 3. 每帧推进 + 文本 ---------- */
sub(`    updateMoving(dt);
    updateFocus(dt);`,
`    updateHeat(dt);
    updateMoving(dt);
    updateFocus(dt);`, 'heat-tick');

sub(`    labelAcc += dt;
    if (labelAcc >= 0.05) {
      updateLabels();
      labelAcc = 0;
    }`,
`    labelAcc += dt;
    if (labelAcc >= 0.05) {
      updateLabels();
      if (APP.heatDirty) { renderHeatNote(); APP.heatDirty = false; }
      labelAcc = 0;
    }`, 'heat-note');

/* ---------- 4. 热度参与 engram 亮度 ---------- */
sub(`    N.glow.setX(rec.inst, clamp(0.08 + 0.98 * rec.salience, 0, 1));`,
`    var heatK = 1 + 0.55 * (APP.heat && rec.layer in APP.heat ? heatNorm(rec.layer) : 0);
    N.glow.setX(rec.inst, clamp((0.08 + 0.98 * rec.salience) * heatK, 0, 1.6));`, 'heat-glow');

fs.writeFileSync(p, t);
console.log('patched', n);

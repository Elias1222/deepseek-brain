const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* ---------- 1. 单条记忆级别的热度 ---------- */
sub(`  var heatNote = null;`,
`  /* 层内热度：热度落到具体 engram 上，亮的是一簇而不是整层。 */
  APP.heatK = {};
  var heatKMax = 0.001;
  function heatAddKey(key, amount) {
    if (!key) return;
    APP.heatK[key] = clamp((APP.heatK[key] || 0) + amount, 0, 4);
  }
  function heatKeyNorm(key) {
    if (!key) return 0;
    return clamp((APP.heatK[key] || 0) / heatKMax, 0, 1);
  }
  function heatHotKey() {
    var best = null, bv = 0;
    Object.keys(APP.heatK).forEach(function (k) {
      if (APP.heatK[k] > bv) { bv = APP.heatK[k]; best = k; }
    });
    return best;
  }
  function heatSpreadToText(topic) {
    if (!topic) return;
    var needle = String(topic).trim();
    if (needle.length < 2) return;
    var touched = 0;
    allEngrams(APP.model).forEach(function (rec) {
      if (touched >= 6) return;
      var blob = (rec.title || '') + ' ' + (rec.sub || '') + ' ' + (rec.detail || '');
      if (blob.indexOf(needle) >= 0) { heatAddKey(rec.id, 0.42); touched++; }
    });
  }

  var heatNote = null;`, 'heat-key-core');

/* ---------- 2. 衰减时同步衰减单条热度 ---------- */
sub(`  function updateHeat(dt) {
    heatDecay(dt);
    var m = heatMax();`,
`  function updateHeat(dt) {
    heatDecay(dt);
    var kk = Math.pow(0.5, (dt * 1000) / HEAT_HALF_MS);
    var mk = 0.001;
    Object.keys(APP.heatK).forEach(function (key) {
      var v = APP.heatK[key] * kk;
      if (v < 0.02) delete APP.heatK[key];
      else { APP.heatK[key] = v; if (v > mk) mk = v; }
    });
    heatKMax = mk;
    var m = heatMax();`, 'heat-key-decay');

/* ---------- 3. 事件写入单条热度 ---------- */
sub(`    if (kind === 'observe') heatAdd('sensory', 0.6), heatAdd('working', 1.0);`,
`    if (kind === 'observe') { heatAdd('sensory', 0.6); heatAdd('working', 1.0); heatSpreadToText(ev.topic || ev.text); }`, 'heat-observe');
sub(`    else if (kind === 'remember') heatAdd(ev.layer || 'episodic', 1.6);`,
`    else if (kind === 'remember') { heatAdd(ev.layer || 'episodic', 1.6); heatAddKey(ev.id, 1.6); }`, 'heat-remember');
sub(`      (ev.hits || []).forEach(function (h) { heatAdd(h.layer, 1.1); });`,
`      (ev.hits || []).forEach(function (h) { heatAdd(h.layer, 1.1); heatAddKey(h.id, 1.1); });`, 'heat-recall');
sub(`    } else if (kind === 'edit') heatAdd(ev.layer || 'episodic', 0.9);
    else if (kind === 'correct') heatAdd('semantic', 1.2);
    else if (kind === 'forget' || kind === 'prune') heatAdd(ev.layer || 'semantic', -0.5);
    else if (kind === 'restore' || kind === 'archive') heatAdd(ev.layer || 'episodic', 0.7);`,
`    } else if (kind === 'edit') { heatAdd(ev.layer || 'episodic', 0.9); heatAddKey(ev.id, 0.9); }
    else if (kind === 'correct') { heatAdd('semantic', 1.2); heatAddKey(ev.id, 1.2); heatAddKey(ev.replacedBy, 1.0); }
    else if (kind === 'forget' || kind === 'prune') { heatAdd(ev.layer || 'semantic', -0.5); heatAddKey(ev.id, -0.5); }
    else if (kind === 'restore' || kind === 'archive') { heatAdd(ev.layer || 'episodic', 0.7); heatAddKey(ev.id, 0.7); }`, 'heat-key-events');

/* ---------- 4. 读数里带上最热的那一条 ---------- */
sub(`    var best = LAYERS.slice().sort(function (a, b) { return APP.heat[b] - APP.heat[a]; })[0];
    heatNote.textContent = APP.heat[best] > 0.08
      ? ('关注：' + REGION[best].label + ' ' + heatNorm(best).toFixed(2) + ' · 半衰期 32 s')
      : '关注：静默，热度已归零。';`,
`    var best = LAYERS.slice().sort(function (a, b) { return APP.heat[b] - APP.heat[a]; })[0];
    if (!(APP.heat[best] > 0.08)) {
      heatNote.textContent = '关注：静默，热度已归零。';
      return;
    }
    var hotId = heatHotKey();
    var hot = hotId && APP.model && APP.model.byId ? APP.model.byId[hotId] : null;
    heatNote.textContent = '关注：' + REGION[best].label + ' ' + heatNorm(best).toFixed(2) +
      (hot ? ' · 「' + truncate(hot.title || '', 14) + '」' : '');`, 'heat-note-key');

/* ---------- 5. 单条热度参与亮度 ---------- */
sub(`    var heatK = 1 + 0.55 * (APP.heat && rec.layer in APP.heat ? heatNorm(rec.layer) : 0);`,
`    var heatK = 1 + 0.30 * (APP.heat && rec.layer in APP.heat ? heatNorm(rec.layer) : 0) +
      0.85 * heatKeyNorm(rec.id);`, 'heat-glow-key');

fs.writeFileSync(p, t);
console.log('patched', n);

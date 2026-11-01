const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 1. 相关度通道：与热度分开，衰减更慢（半衰期 128 s） */
sub(`  APP.heatK = {};`,
`  APP.heatK = {};
  /* 相关度是另一条线：它记住「上一次检索觉得这条有多像」，与「最近被想起」分开。
     半衰期 128 s —— 检索过去两分钟，边缘还留着一点硬边。 */
  APP.relK = {};
  var REL_HALF_MS = 128000;
  function relAdd(key, score) {
    if (!key) return;
    var s = clamp(Number(score) || 0, 0, 1);
    APP.relK[key] = Math.max(APP.relK[key] || 0, s);
  }
  function relOf(key) { return key ? clamp(APP.relK[key] || 0, 0, 1) : 0; }
  function relHotKey() {
    var best = null, bv = 0;
    Object.keys(APP.relK).forEach(function (k) { if (APP.relK[k] > bv) { bv = APP.relK[k]; best = k; } });
    return bv > 0.05 ? best : null;
  }`, 'rel-core');

/* 2. 随帧衰减（并清掉角落里的残余） */
sub(`    heatKMax = mk;
    var m = heatMax();`,
`    heatKMax = mk;
    var rk = Math.pow(0.5, (dt * 1000) / REL_HALF_MS);
    Object.keys(APP.relK).forEach(function (key) {
      var v = APP.relK[key] * rk;
      if (v < 0.03) delete APP.relK[key]; else APP.relK[key] = v;
    });
    var m = heatMax();`, 'rel-decay');

/* 3. 命中时按分数记热度、同时记相关度 */
sub(`      (ev.hits || []).forEach(function (h) { heatAdd(h.layer, 1.1); heatAddKey(h.id, 1.1); });`,
`      (ev.hits || []).forEach(function (h) {
        var sc = clamp(Number(h.score) || 0, 0, 1);
        heatAdd(h.layer, 1.1 * sc);
        heatAddKey(h.id, 1.1 * sc);
        relAdd(h.id, sc);
      });`, 'rel-recall');

/* 4. 亮度与边缘分开：亮度看热度，硬边看相关度 */
sub(`    var heatK = 1 + 0.30 * (APP.heat && rec.layer in APP.heat ? heatNorm(rec.layer) : 0) +
      0.85 * heatKeyNorm(rec.id);
    N.glow.setX(rec.inst, clamp((0.08 + 0.98 * rec.salience) * heatK, 0, 1.6));`,
`    var heatK = 1 + 0.30 * (APP.heat && rec.layer in APP.heat ? heatNorm(rec.layer) : 0) +
      0.85 * heatKeyNorm(rec.id);
    N.glow.setX(rec.inst, clamp((0.08 + 0.98 * rec.salience) * heatK, 0, 1.6));`, 'glow-same');

sub(`    N.hi.setX(rec.inst, hi == null ? (APP.selected === rec.id ? 0.85 : 0) : hi);`,
`    /* 硬边：选中 0.85；否则由「上一次检索有多像」给一点轮廓光 */
    N.hi.setX(rec.inst, hi == null
      ? (APP.selected === rec.id ? 0.85 : 0.62 * relOf(rec.id))
      : hi);`, 'rel-hi');

/* 5. 读数：热度那条之外，再点出「最相关」的那条 */
sub(`    var hotId = heatHotKey();
    var hot = hotId && APP.model && APP.model.byId ? APP.model.byId[hotId] : null;
    heatNote.textContent = '关注：' + REGION[best].label + ' ' + heatNorm(best).toFixed(2) +
      (hot ? ' · 「' + truncate(hot.title || '', 14) + '」' : '');`,
`    var hotId = heatHotKey();
    var hot = hotId && APP.model && APP.model.byId ? APP.model.byId[hotId] : null;
    var relId = relHotKey();
    var rel = relId && APP.model && APP.model.byId ? APP.model.byId[relId] : null;
    var line = '关注：' + REGION[best].label + ' ' + heatNorm(best).toFixed(2);
    if (hot) line += ' · 「' + truncate(hot.title || '', 14) + '」';
    heatNote.textContent = line;
    if (relId && relId !== hotId && rel) {
      var relEl = document.getElementById('relNote');
      if (!relEl) {
        relEl = document.createElement('p');
        relEl.className = 'note';
        relEl.id = 'relNote';
        heatNote.parentNode.appendChild(relEl);
      }
      relEl.textContent = '最相关：' + relOf(relId).toFixed(2) + ' · 「' + truncate(rel.title || '', 14) + '」';
      relEl.hidden = false;
    } else {
      var old = document.getElementById('relNote');
      if (old) old.hidden = true;
    }`, 'rel-note');

fs.writeFileSync(p, t);
console.log('patched', n);

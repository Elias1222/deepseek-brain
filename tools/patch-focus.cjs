const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 注意力聚焦状态 */
sub(
`  function placeEngram(rec, pos, scaleMul, dim, hi) {`,
`  /* 注意力聚焦：检索命中时把命中簇往焦点收、其余往外让，形成一次可读的「聚光」。
     这只是一次位移偏移——engram 的槽位坐标（slot u/v）不变，寻址仍然是确定性的。 */
  APP.focus = { on: false, ids: null, t: 0, dur: 2.6, center: new THREE.Vector3() };
  function focusBell() {
    var u = clamp(APP.focus.t / APP.focus.dur, 0, 1);
    return Math.sin(Math.PI * u); /* 0 → 1 → 0 */
  }
  function setFocus(hits) {
    var ids = {}, acc = new THREE.Vector3(), cnt = 0;
    (hits || []).forEach(function (h) {
      var rec = APP.model && APP.model.byId ? APP.model.byId[h.id] : null;
      if (!rec) return;
      ids[rec.id] = 1; acc.add(rec.pos); cnt++;
    });
    if (!cnt) { APP.focus.on = false; APP.focus.ids = null; return; }
    APP.focus.on = true; APP.focus.ids = ids; APP.focus.t = 0;
    APP.focus.center.copy(acc.multiplyScalar(1 / cnt));
  }
  function clearFocus() {
    if (!APP.focus.on) return;
    APP.focus.on = false; APP.focus.ids = null; APP.focus.t = 0;
    allEngrams(APP.model).forEach(function (rec) {
      if (rec.inst != null && !rec.ghost) placeEngram(rec, null, 1, null, null);
    });
  }
  function updateFocus(dt) {
    if (!APP.focus.on) return;
    APP.focus.t += dt;
    if (APP.focus.t >= APP.focus.dur) { clearFocus(); return; }
    var w = focusBell();
    allEngrams(APP.model).forEach(function (rec) {
      if (rec.inst == null || rec.ghost) return;
      var hit = !!(APP.focus.ids && APP.focus.ids[rec.id]);
      _v2.copy(APP.focus.center).sub(rec.pos);
      var len = _v2.length() || 1;
      _v2.multiplyScalar(1 / len);
      var amt = hit ? 0.34 * w : -0.12 * w * (1 - Math.min(1, len / 1.3));
      _v3.copy(rec.pos).addScaledVector(_v2, amt);
      placeEngram(rec, _v3, 1, hit ? 0 : 0.85 * w, hit ? 0.95 * w : 0);
    });
  }

  function placeEngram(rec, pos, scaleMul, dim, hi) {`,
'focus-core');

/* 每帧推进聚焦动画 */
sub(
`    updateMoving(dt);
    updatePulses(dt);`,
`    updateMoving(dt);
    updateFocus(dt);
    updatePulses(dt);`,
'focus-tick');

/* 检索时触发：真检索（POST）与活动流回放都走这一条 */
sub(
`  function runRecallPulses(hits, factor) {`,
`  function runRecallPulses(hits, factor) {
    setFocus(hits);`,
'focus-wire');

fs.writeFileSync(p, t);
console.log('patched', n);

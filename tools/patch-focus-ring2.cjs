const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 用一条常驻的 LineLoop 做聚光圈（spawnPulse 是沿线跑的点，画不出环） */
sub(`    /* 聚光圈：围绕命中簇中心的 32 点闭合环，寿命与 focus 同步 */
    var ring = [], R = 0.42;
    for (var i = 0; i <= 32; i++) {
      var a = (i / 32) * Math.PI * 2;
      ring.push(new THREE.Vector3(
        APP.focus.center.x + Math.cos(a) * R,
        APP.focus.center.y + Math.sin(a) * R,
        APP.focus.center.z));
    }
    spawnPulse(ring, new THREE.Color('#e6e0d2'), 0.055, APP.focus.dur, 0);`,
`    /* 聚光圈由常驻的 LineLoop 承担（spawnPulse 画的是沿线跑的点） */
    if (focusRing) {
      focusRing.position.copy(APP.focus.center);
      focusRing.visible = true;
    }`, 'ring-replace');

/* 建造聚光圈对象 */
sub(`  function setFocus(hits) {`,
`  var focusRing = (function () {
    var pts = [], R = 0.46;
    for (var i = 0; i < 64; i++) {
      var a = (i / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0));
    }
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = new THREE.LineBasicMaterial({
      color: 0xe6e0d2, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false,
    });
    var l = new THREE.LineLoop(geo, mat);
    l.renderOrder = 8;
    l.visible = false;
    scene.add(l);
    return l;
  })();

  function setFocus(hits) {`, 'ring-build');

/* 每帧让环朝向相机并按钟形曲线亮灭 */
sub(`    var w = focusBell();
    allEngrams(APP.model).forEach(function (rec) {`,
`    var w = focusBell();
    if (focusRing) {
      focusRing.visible = true;
      focusRing.quaternion.copy(camera.quaternion);
      focusRing.scale.setScalar(0.55 + 0.75 * w);
      focusRing.material.opacity = 0.55 * w;
    }
    allEngrams(APP.model).forEach(function (rec) {`, 'ring-anim');

sub(`  function clearFocus() {
    if (!APP.focus.on) return;`,
`  function clearFocus() {
    if (!APP.focus.on) return;
    if (focusRing) { focusRing.visible = false; focusRing.material.opacity = 0; }`, 'ring-clear');

fs.writeFileSync(p, t);
console.log('patched', n);

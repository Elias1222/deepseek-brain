const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
const sub = (a, b, tag) => { if (!t.includes(a)) { console.error('MISS ' + tag); process.exit(1); } t = t.replace(a, b); n++; };

/* 位移幅度加大，非命中让得更明显 */
sub('      var amt = hit ? 0.34 * w : -0.12 * w * (1 - Math.min(1, len / 1.3));',
    '      var amt = hit ? 0.50 * w : -0.22 * w * (1 - Math.min(1, len / 1.3));', 'amp');

/* 同时画一圈「聚光圈」，让聚焦这件事一眼能看出，而不是只靠粒子挪动 */
sub(`    APP.focus.on = true; APP.focus.ids = ids; APP.focus.t = 0;
    APP.focus.center.copy(acc.multiplyScalar(1 / cnt));`,
`    APP.focus.on = true; APP.focus.ids = ids; APP.focus.t = 0;
    APP.focus.center.copy(acc.multiplyScalar(1 / cnt));
    /* 聚光圈：围绕命中簇中心的 32 点闭合环，寿命与 focus 同步 */
    var ring = [], R = 0.42;
    for (var i = 0; i <= 32; i++) {
      var a = (i / 32) * Math.PI * 2;
      ring.push(new THREE.Vector3(
        APP.focus.center.x + Math.cos(a) * R,
        APP.focus.center.y + Math.sin(a) * R,
        APP.focus.center.z));
    }
    spawnPulse(ring, new THREE.Color('#e6e0d2'), 0.055, APP.focus.dur, 0);`, 'ring');

fs.writeFileSync(p, t);
console.log('patched', n);

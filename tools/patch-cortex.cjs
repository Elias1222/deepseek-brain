const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');
const must = (s) => { if (!t.includes(s)) { console.error('MISS:', s.slice(0, 80)); process.exit(1); } };

/* (a) 提高细分 */
must("    seg: small ? [96, 72] : [176, 132],");
t = t.replace("    seg: small ? [96, 72] : [176, 132],", "    seg: small ? [104, 80] : [224, 168],");

/* (b) 补两条顶叶骨架 */
must("    /* 顶叶 */\n    { id: 'intraparietal', w: 0.046, depth: 0.66, pts: [[0.30, 0.78, -0.34], [0.52, 0.62, -0.40], [0.74, 0.40, -0.44]] },");
t = t.replace(
  "    /* 顶叶 */\n    { id: 'intraparietal', w: 0.046, depth: 0.66, pts: [[0.30, 0.78, -0.34], [0.52, 0.62, -0.40], [0.74, 0.40, -0.44]] },",
  "    /* 顶叶：顶内沟 + 顶上沟 + 顶枕外侧支（补掉原先的空档） */\n" +
  "    { id: 'intraparietal', w: 0.046, depth: 0.66, pts: [[0.30, 0.78, -0.34], [0.52, 0.62, -0.40], [0.74, 0.40, -0.44]] },\n" +
  "    { id: 'parietal-sup',  w: 0.044, depth: 0.62, pts: [[0.22, 0.90, -0.12], [0.46, 0.82, -0.18], [0.68, 0.64, -0.22], [0.84, 0.40, -0.24]] },\n" +
  "    { id: 'parieto-lat',   w: 0.042, depth: 0.58, pts: [[0.16, 0.66, -0.62], [0.42, 0.44, -0.66], [0.66, 0.22, -0.68]] },"
);

/* (c) 抽出 surfaceDetail：沟回高度场 + 叶区脑回宽度调制 */
const s0 = t.indexOf('    var near = sulcusField(px, py, pz);');
const e0 = t.indexOf('    var disp = 1 + 0.094 * bump - 0.118 * sul;');
if (s0 < 0 || e0 < 0) { console.error('anchor miss', s0, e0); process.exit(1); }
const oldBlock = t.slice(s0, e0 + '    var disp = 1 + 0.094 * bump - 0.118 * sul;'.length);

const detailFn = `  /* 皮层高度场：一级沟深槽 + 沿沟平行的次级沟 + 三级沟倍频 + Voronoi 顶冠。
     抽成独立函数，既是顶点位移的来源，也是法线贴图的烘焙源——两者必须同源。 */
  var _det = { sul: 0, bump: 0, warpA: 0, warpB: 0 };
  function surfaceDetail(px, py, pz) {
    var warpA = fbm(px * 3.1 + 11.3, py * 3.1 - 4.1, pz * 3.1 + 7.7, 3);
    var warpB = fbm(px * 4.6 - 2.9, py * 4.6 + 9.2, pz * 4.6 - 5.4, 3);
    var near = sulcusField(px, py, pz);
    /* 脑回宽度按叶区调制：额极更宽（相位更疏），枕极更细，中央区取中 */
    var gf = 1.0 - 0.15 * smoothstep(0.0, 0.90, pz) + 0.20 * smoothstep(0.10, -0.85, pz);
    var primary = Math.exp(-Math.pow(near.d1 / near.w, 2.0)) * near.depth;
    var phase = (near.phase * gf + warpA * 0.48 + warpB * 0.22) * Math.PI;
    var band = Math.abs(Math.sin(phase));
    var secondary = (1 - smoothstep(0.0, 0.215 * (0.9 + 0.1 * gf), band)) * 0.88;
    var tert = Math.abs(Math.sin((near.phase * gf * 2.6 - warpB * 1.0) * Math.PI));
    var tertiary = (1 - smoothstep(0.0, 0.13, tert)) * 0.24;
    var wall = near.d2 < 8 ? Math.exp(-Math.pow((near.d2 - near.d1) / 0.055, 2.0)) : 0;
    var sul = Math.max(primary, Math.max(secondary, tertiary));
    _det.sul = sul;
    _det.bump = (1 - sul) * 0.55 + 0.45 * warpA + 0.18 * wall;
    _det.warpA = warpA;
    _det.warpB = warpB;
    return _det;
  }

`;

const newBlock = `    var det = surfaceDetail(px, py, pz);
    var warpA = det.warpA, warpB = det.warpB;
    var sul = det.sul, bump = det.bump;
    var disp = 1 + 0.094 * bump - 0.118 * sul;`;

t = t.slice(0, s0) + newBlock + t.slice(e0 + '    var disp = 1 + 0.094 * bump - 0.118 * sul;'.length);

/* 在 hemiPoint 之前插入 surfaceDetail */
const hp = t.indexOf('  function hemiPoint(px, py, pz, side) {');
if (hp < 0) { console.error('hemiPoint miss'); process.exit(1); }
t = t.slice(0, hp) + detailFn + t.slice(hp);

/* (d) 法线贴图烘焙 */
const matAnchor = "  var matFront = new THREE.MeshStandardMaterial({";
must(matAnchor);
const normFn = `  /* 由同一个高度场烘焙切线空间法线：近距离的沟壁质感靠它，而不是靠加密网格。 */
  function buildCortexNormalMap(size, strength) {
    var H = new Float32Array(size * size);
    for (var j = 0; j < size; j++) {
      var ph = ((j + 0.5) / size) * Math.PI;
      var sp = Math.sin(ph), cp = Math.cos(ph);
      for (var i = 0; i < size; i++) {
        var th = ((i + 0.5) / size) * Math.PI * 2;
        var d = surfaceDetail(sp * Math.cos(th), cp, sp * Math.sin(th));
        H[j * size + i] = d.sul * 0.135 - d.bump * 0.045;
      }
    }
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(size, size);
    for (var jj = 0; jj < size; jj++) {
      var jU = (jj - 1 + size) % size, jD = (jj + 1) % size;
      for (var ii = 0; ii < size; ii++) {
        var iL = (ii - 1 + size) % size, iR = (ii + 1) % size;
        var dx = (H[jj * size + iR] - H[jj * size + iL]) * 0.5;
        var dy = (H[jD * size + ii] - H[jU * size + ii]) * 0.5;
        var nx = -dx * strength, ny = -dy * strength, nz = 1.0;
        var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        var o = (jj * size + ii) * 4;
        img.data[o] = (nx / l * 0.5 + 0.5) * 255;
        img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
        img.data[o + 2] = (nz / l * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

`;
t = t.slice(0, t.indexOf(matAnchor)) + normFn + t.slice(t.indexOf(matAnchor));

/* 材质上挂 normalMap */
must("    transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide, fog: false,");
t = t.replace(
  "    transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide, fog: false,",
  "    transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide, fog: false,\n" +
  "    normalMap: buildCortexNormalMap(QUALITY.low ? 160 : 224, 2.6),\n" +
  "    normalScale: new THREE.Vector2(0.85, 0.85),"
);

fs.writeFileSync(p, t);
console.log('ok', t.length);

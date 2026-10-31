const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/web/brain-3d.html';
let t = fs.readFileSync(p, 'utf8');

// 1) 移除材质上的法线贴图（烘焙分辨率追不上次级沟频率，采样出现摩尔纹/鳞片感）
const matBit = "    normalMap: buildCortexNormalMap(QUALITY.low ? 160 : 320, 2.2),\n    normalScale: new THREE.Vector2(0.42, 0.42),\n";
if (!t.includes(matBit)) { console.error('MISS mat'); process.exit(1); }
t = t.replace(matBit, "");

// 2) 移除烘焙函数本体
const a = t.indexOf("  /* 由同一个高度场烘焙切线空间法线：近距离的沟壁质感靠它，而不是靠加密网格。 */");
const b = t.indexOf("  var matFront = new THREE.MeshStandardMaterial({");
if (a < 0 || b < 0 || b < a) { console.error('MISS fn', a, b); process.exit(1); }
t = t.slice(0, a) + t.slice(b);

fs.writeFileSync(p, t);
console.log('reverted normal map, len', t.length);

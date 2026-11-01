// tools/bake-brain-mesh.mjs — 把 CC BY 4.0 的 MRI 皮层网格烘焙成单文件可嵌入的量化数据
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { simplify } from './qem.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'build');
const OUT = path.join(HERE, '..', 'web', 'brain-mesh.js');
const OUT_LOW = path.join(HERE, '..', 'web', 'brain-mesh-low.js');
const TARGET_TRIS = Number(process.argv[2] || 42000);

function parseVerts(text) {
  const out = [];
  const re = /<([-\d.eE+]+),([-\d.eE+]+),([-\d.eE+]+)>/g;
  let m;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  return Float64Array.from(out);
}

function parseFaces(text) {
  const out = [];
  const re = /<(\d+),(\d+),(\d+)>/g;
  let m;
  while ((m = re.exec(text))) out.push(+m[1] - 1, +m[2] - 1, +m[3] - 1);
  return Uint32Array.from(out);
}

const hemi = {};
for (const side of ['lh', 'rh']) {
  hemi[side] = {
    pos: parseVerts(fs.readFileSync(path.join(SRC, `${side}_vertices.inc`), 'utf8')),
    idx: parseFaces(fs.readFileSync(path.join(SRC, `${side}_faces.inc`), 'utf8')),
  };
  console.log(side, 'verts', hemi[side].pos.length / 3, 'tris', hemi[side].idx.length / 3);
}

/* 1) 主轴确认：FreeSurfer 是 RAS，Y 向上、Z 前后、X 左右 */
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (const side of ['lh', 'rh']) {
  const p = hemi[side].pos;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
}
console.log('bbox min', min.map((v) => v.toFixed(1)), 'max', max.map((v) => v.toFixed(1)));
const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
console.log('span', span.map((v) => v.toFixed(1)));

/* 2) 顶点聚类抽稀：按网格吸附，保留每格重心 */
function decimate(pos, idx, cells) {
  const lo = [min[0], min[1], min[2]];
  const inv = [cells / span[0], cells / span[1], cells / span[2]];
  const map = new Map();
  const acc = [];
  const cellOf = new Map();
  for (let i = 0; i < pos.length; i += 3) {
    const gx = Math.min(cells - 1, Math.floor((pos[i] - lo[0]) * inv[0]));
    const gy = Math.min(cells - 1, Math.floor((pos[i + 1] - lo[1]) * inv[1]));
    const gz = Math.min(cells - 1, Math.floor((pos[i + 2] - lo[2]) * inv[2]));
    const key = gx + ',' + gy + ',' + gz;
    let vi = map.get(key);
    if (vi === undefined) {
      vi = acc.length / 4;
      map.set(key, vi);
      acc.push(0, 0, 0, 0);
    }
    const base = vi * 4;
    acc[base] += pos[i];
    acc[base + 1] += pos[i + 1];
    acc[base + 2] += pos[i + 2];
    acc[base + 3] += 1;
    cellOf.set(i / 3, vi);
  }
  const vp = new Float32Array((acc.length / 4) * 3);
  for (let v = 0; v < acc.length / 4; v++) {
    const n = acc[v * 4 + 3];
    vp[v * 3] = acc[v * 4] / n;
    vp[v * 3 + 1] = acc[v * 4 + 1] / n;
    vp[v * 3 + 2] = acc[v * 4 + 2] / n;
  }
  const tri = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = cellOf.get(idx[t]);
    const b = cellOf.get(idx[t + 1]);
    const c = cellOf.get(idx[t + 2]);
    if (a === b || b === c || a === c) continue;
    tri.push(a, b, c);
  }
  return { pos: vp, idx: Uint32Array.from(tri), verts: vp.length / 3, tris: tri.length / 3 };
}

let lh;
let rh;
{
  /* 顶点聚类只用来给出一个「无重叠、已对齐」的中间网格，真正的简化交给 QEM：
     聚类会把表面压成揉皱的锡纸，QEM 沿误差最小处折边，沟壁和平面都能保住。 */
  const seedCells = 120;
  const seedL = decimate(hemi.lh.pos, hemi.lh.idx, seedCells);
  const seedR = decimate(hemi.rh.pos, hemi.rh.idx, seedCells);
  const half = Math.max(2000, Math.round(TARGET_TRIS / 2));
  const t0 = Date.now();
  lh = simplify(seedL.pos, seedL.idx, half);
  const t1 = Date.now();
  rh = simplify(seedR.pos, seedR.idx, half);
  console.log(`qem → lh ${lh.tris} + rh ${rh.tris} = ${lh.tris + rh.tris} tris ` +
    `(lh ${t1 - t0} ms, rh ${Date.now() - t1} ms; seed ${seedL.tris + seedR.tris})`);
}

/* 3) 合并两半球，转到本项目的坐标：X 左右、Y 上、Z 前后，长度 4.04 */
const allVerts = lh.verts + rh.verts;
const allTris = lh.tris + rh.tris;
const pos = new Float32Array(allVerts * 3);
const idx = new Uint32Array(allTris * 3);
pos.set(lh.pos, 0);
pos.set(rh.pos, lh.verts * 3);
idx.set(lh.idx, 0);
for (let i = 0; i < rh.idx.length; i++) idx[lh.idx.length + i] = rh.idx[i] + lh.verts;

/* 原点归中 + 等比缩放到 AZ=2.02 的半长（皮层长轴 = Z） */
const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
let bbMin = [Infinity, Infinity, Infinity];
let bbMax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    if (pos[i + k] < bbMin[k]) bbMin[k] = pos[i + k];
    if (pos[i + k] > bbMax[k]) bbMax[k] = pos[i + k];
  }
}
const lenZ = bbMax[1] - bbMin[1];
const scale = 4.04 / lenZ;
console.log('scale', scale.toFixed(4), 'centre', c.map((v) => v.toFixed(1)));

const OUT_DIM = { x: 1.42, y: 1.50, z: 2.02 };
const qpos = new Uint16Array(allVerts * 3);
const qmin = [Infinity, Infinity, Infinity];
const qmax = [-Infinity, -Infinity, -Infinity];
const tmp = new Float32Array(allVerts * 3);
for (let i = 0; i < pos.length; i += 3) {
  tmp[i] = (pos[i] - c[0]) * scale;
  tmp[i + 1] = (pos[i + 2] - c[2]) * scale;
  tmp[i + 2] = (pos[i + 1] - c[1]) * scale;
  for (let k = 0; k < 3; k++) {
    if (tmp[i + k] < qmin[k]) qmin[k] = tmp[i + k];
    if (tmp[i + k] > qmax[k]) qmax[k] = tmp[i + k];
  }
}
for (let i = 0; i < tmp.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    const span2 = qmax[k] - qmin[k] || 1;
    qpos[i + k] = Math.round(((tmp[i + k] - qmin[k]) / span2) * 65535);
  }
}
console.log('world bbox', qmin.map((v) => v.toFixed(2)), qmax.map((v) => v.toFixed(2)));

/* 3.5) 拉普拉斯平滑：抵消顶点聚类造成的「揉皱锡纸」表面 */
for (let pass = 0; pass < 5; pass++) {
  const sum = new Float32Array(allVerts * 3);
  const cnt = new Uint32Array(allVerts);
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k];
      for (let j = 1; j <= 2; j++) {
        const w = idx[t + ((k + j) % 3)];
        sum[v * 3] += tmp[w * 3];
        sum[v * 3 + 1] += tmp[w * 3 + 1];
        sum[v * 3 + 2] += tmp[w * 3 + 2];
        cnt[v] += 1;
      }
    }
  }
  for (let v = 0; v < allVerts; v++) {
    if (!cnt[v]) continue;
    for (let k = 0; k < 3; k++) {
      const avg = sum[v * 3 + k] / cnt[v];
      tmp[v * 3 + k] = tmp[v * 3 + k] * 0.35 + avg * 0.65;
    }
  }
}

/* 4) 法线 + 曲率着色：凹处压暗，凸处提亮 */
const nrm = new Float32Array(allVerts * 3);
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t] * 3;
  const b = idx[t + 1] * 3;
  const cc = idx[t + 2] * 3;
  const ux = tmp[b] - tmp[a];
  const uy = tmp[b + 1] - tmp[a + 1];
  const uz = tmp[b + 2] - tmp[a + 2];
  const vx = tmp[cc] - tmp[a];
  const vy = tmp[cc + 1] - tmp[a + 1];
  const vz = tmp[cc + 2] - tmp[a + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  for (const v of [a, b, cc]) {
    nrm[v] += nx;
    nrm[v + 1] += ny;
    nrm[v + 2] += nz;
  }
}
const qnrm = new Int8Array(allVerts * 3);
for (let i = 0; i < nrm.length; i += 3) {
  const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
  for (let k = 0; k < 3; k++) qnrm[i + k] = Math.round((nrm[i + k] / l) * 127);
}

/* 曲率代理：顶点到一环邻居重心的向量在法线上的投影（凹为负） */
const nbrSum = new Float32Array(allVerts * 3);
const nbrCnt = new Uint32Array(allVerts);
for (let t = 0; t < idx.length; t += 3) {
  for (let k = 0; k < 3; k++) {
    const v = idx[t + k];
    for (let j = 1; j <= 2; j++) {
      const w = idx[t + ((k + j) % 3)];
      nbrSum[v * 3] += tmp[w * 3];
      nbrSum[v * 3 + 1] += tmp[w * 3 + 1];
      nbrSum[v * 3 + 2] += tmp[w * 3 + 2];
      nbrCnt[v] += 1;
    }
  }
}
const col = new Uint8Array(allVerts * 3);
for (let v = 0; v < allVerts; v++) {
  const n = nbrCnt[v] || 1;
  const dx = nbrSum[v * 3] / n - tmp[v * 3];
  const dy = nbrSum[v * 3 + 1] / n - tmp[v * 3 + 1];
  const dz = nbrSum[v * 3 + 2] / n - tmp[v * 3 + 2];
  const nx = qnrm[v * 3] / 127;
  const ny = qnrm[v * 3 + 1] / 127;
  const nz = qnrm[v * 3 + 2] / 127;
  const conc = -(dx * nx + dy * ny + dz * nz) * 9; // >0 表示凹
  /* 回冠高光：凸起的脑回顶额外提亮并偏暖，沟底则压暗偏冷——
     近景靠这个拉出立体感，不靠再加密网格。 */
  const crown = Math.max(0, Math.min(1, -conc * 1.25));
  const t2 = Math.max(0, Math.min(1, 0.50 - conc * 1.7 + crown * 0.34));
  const r = Math.round(36 + t2 * 188 + crown * 16);
  const g = Math.round(35 + t2 * 180 + crown * 11);
  const b = Math.round(39 + t2 * 164 + crown * 4);
  col[v * 3] = Math.min(255, r);
  col[v * 3 + 1] = Math.min(255, g);
  col[v * 3 + 2] = Math.min(255, b);
}

/* 5) 打包：pos(Uint16 LE) + nrm(Int8) + col(Uint8) + idx(Uint32 LE) → gzip → base64 */
const header = Buffer.alloc(20);
header.writeUInt32LE(allVerts, 0);
header.writeUInt32LE(allTris, 4);
header.writeFloatLE(1, 8);
header.writeUInt16LE(0, 12);
header.writeUInt16LE(0, 14);
header.writeUInt32LE(0, 16);
const body = Buffer.concat([
  Buffer.from(qpos.buffer),
  Buffer.from(qnrm.buffer),
  Buffer.from(col.buffer),
  Buffer.from(idx.buffer),
]);
const raw = Buffer.concat([header, body]);
const gz = zlib.gzipSync(raw, { level: 9 });
const b64 = gz.toString('base64');
console.log('raw', (raw.length / 1024).toFixed(0), 'KB → gzip', (gz.length / 1024).toFixed(0), 'KB → base64', (b64.length / 1024).toFixed(0), 'KB');

const meta = {
  verts: allVerts,
  tris: allTris,
  bbox: { min: qmin.map((v) => +v.toFixed(3)), max: qmax.map((v) => +v.toFixed(3)) },
  source: 'Thomas Habets, MRI-derived cortical surfaces, CC BY 4.0',
};
const js = [
  '/* 自动生成，请勿手改：tools/bake-brain-mesh.mjs',
  ' * 数据来源：Thomas Habets (https://github.com/ThomasHabets/brain)，CC BY 4.0',
  ' * 布局：20 字节头（verts, tris LE u32 …）+ 量化位置 u16 + 法线 i8 + 顶点色 u8 + 索引 u32，整体 gzip。',
  ' */',
  'window.__BRAIN_MESH = {',
  '  meta: ' + JSON.stringify(meta) + ',',
  '  data: \'' + b64 + '\',',
  '};',
  '',
].join('\n');
fs.writeFileSync(OUT, js);
fs.writeFileSync(path.join(SRC, 'brain-mesh.meta.json'), JSON.stringify(meta, null, 2));
console.log('wrote', path.relative(process.cwd(), OUT), (js.length / 1024).toFixed(0), 'KB');

/* 6) 分级 LOD：同一套 QEM 再折到 24k 三角，单独成一个文件。
      低画质档 / 小屏只下载这一份，高画质档用上面那份 90k。 */
{
  const LOW_TRIS = 24000;
  const lowL = simplify(lh.pos, lh.idx, LOW_TRIS / 2);
  const lowR = simplify(rh.pos, rh.idx, LOW_TRIS / 2);
  const lowVerts = lowL.verts + lowR.verts;
  const lowTris = lowL.tris + lowR.tris;
  const lowPos = new Float32Array(lowVerts * 3);
  const lowIdx = new Uint32Array(lowTris * 3);
  lowPos.set(lowL.pos, 0);
  lowPos.set(lowR.pos, lowL.verts * 3);
  lowIdx.set(lowL.idx, 0);
  for (let i = 0; i < lowR.idx.length; i++) lowIdx[lowL.idx.length + i] = lowR.idx[i] + lowL.verts;

  /* 与主资产同一套坐标变换与量化（复用上面算好的 c / scale / qmin / qmax） */
  const lq = new Uint16Array(lowVerts * 3);
  for (let v = 0; v < lowVerts; v++) {
    const x = (lowPos[v * 3] - c[0]) * scale;
    const y = (lowPos[v * 3 + 2] - c[2]) * scale;
    const z = (lowPos[v * 3 + 1] - c[1]) * scale;
    lq[v * 3] = Math.round(((x - qmin[0]) / (qmax[0] - qmin[0] || 1)) * 65535);
    lq[v * 3 + 1] = Math.round(((y - qmin[1]) / (qmax[1] - qmin[1] || 1)) * 65535);
    lq[v * 3 + 2] = Math.round(((z - qmin[2]) / (qmax[2] - qmin[2] || 1)) * 65535);
  }
  const lnrm = new Int8Array(lowVerts * 3);
  const lacc = new Float32Array(lowVerts * 3);
  for (let t = 0; t < lowIdx.length; t += 3) {
    const a = lowIdx[t] * 3, b = lowIdx[t + 1] * 3, d = lowIdx[t + 2] * 3;
    const ux = lowPos[b] - lowPos[a], uy = lowPos[b + 1] - lowPos[a + 1], uz = lowPos[b + 2] - lowPos[a + 2];
    const vx = lowPos[d] - lowPos[a], vy = lowPos[d + 1] - lowPos[a + 1], vz = lowPos[d + 2] - lowPos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, d]) { lacc[k] += nx; lacc[k + 1] += ny; lacc[k + 2] += nz; }
  }
  for (let i = 0; i < lacc.length; i += 3) {
    const l = Math.hypot(lacc[i], lacc[i + 1], lacc[i + 2]) || 1;
    lnrm[i] = Math.round((lacc[i] / l) * 127);
    lnrm[i + 1] = Math.round((lacc[i + 1] / l) * 127);
    lnrm[i + 2] = Math.round((lacc[i + 2] / l) * 127);
  }
  const lcol = new Uint8Array(lowVerts * 3);
  lcol.fill(150);

  const lh2 = Buffer.alloc(20);
  lh2.writeUInt32LE(lowVerts, 0);
  lh2.writeUInt32LE(lowTris, 4);
  const lbody = Buffer.concat([
    Buffer.from(lq.buffer), Buffer.from(lnrm.buffer), Buffer.from(lcol.buffer), Buffer.from(lowIdx.buffer),
  ]);
  const lgz = zlib.gzipSync(Buffer.concat([lh2, lbody]), { level: 9 });
  const lb64 = lgz.toString('base64');
  const lmeta = {
    verts: lowVerts,
    tris: lowTris,
    bbox: meta.bbox,
    source: meta.source,
  };
  const ljs = [
    '/* 自动生成，请勿手改：tools/bake-brain-mesh.mjs（低画质 LOD）',
    ' * 数据来源：Thomas Habets (https://github.com/ThomasHabets/brain)，CC BY 4.0',
    ' */',
    'window.__BRAIN_MESH_LOW = {',
    '  meta: ' + JSON.stringify(lmeta) + ',',
    '  data: \'' + lb64 + '\',',
    '};',
    '',
  ].join('\n');
  fs.writeFileSync(OUT_LOW, ljs);
  console.log('wrote low LOD', path.relative(process.cwd(), OUT_LOW),
    lowTris, 'tris', (ljs.length / 1024).toFixed(0), 'KB');
}

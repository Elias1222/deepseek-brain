/**
 * 二次误差（quadric error metric, QEM）边折叠简化。
 *
 * 顶点聚类把每个格子的顶点压成重心，表面会像揉皱的锡纸；QEM 沿着「删掉这条边
 * 带来的体积误差」从小到大折叠，平面和沟底被保住，三角形自动聚到该密的地方。
 *
 * 输入/输出都是扁平数组：pos = Float32Array(n*3)，idx = Uint32Array(m*3)。
 */
export function simplify(pos, idx, targetTris) {
  const vCount0 = pos.length / 3;
  const fCount0 = idx.length / 3;
  if (fCount0 <= targetTris) return { pos: pos.slice(), idx: idx.slice() };

  /* ---- 可增长的顶点表：折叠后老顶点标记为 dead ---- */
  const capacity = vCount0 + 16;
  const px = new Float64Array(capacity);
  const py = new Float64Array(capacity);
  const pz = new Float64Array(capacity);
  for (let i = 0; i < vCount0; i++) {
    px[i] = pos[i * 3];
    py[i] = pos[i * 3 + 1];
    pz[i] = pos[i * 3 + 2];
  }

  /* 每个顶点的 4x4 对称误差矩阵：a2 ab ac ad b2 bc bd c2 cd d2 */
  const Q = new Float64Array(capacity * 10);
  /* 只有真实存在的顶点算活着：容量里多出来的空槽必须显式标 0，否则会被当成有效顶点输出 */
  const alive = new Uint8Array(capacity);
  for (let i = 0; i < vCount0; i++) alive[i] = 1;
  const ver = new Uint32Array(capacity); // 惰性删除用的版本号

  /* ---- 面表：删除只打标记，最后统一压缩 ---- */
  const fv = new Uint32Array(fCount0 * 3);
  fv.set(idx);
  const fAlive = new Uint8Array(fCount0).fill(1);
  let aliveFaces = fCount0;

  const faceArea = (a, b, c) => {
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
    const vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return 0.5 * Math.hypot(nx, ny, nz);
  };

  const addFaceQuadric = (a, b, c) => {
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
    const vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    nx /= len; ny /= len; nz /= len;
    const d = -(nx * px[a] + ny * py[a] + nz * pz[a]);
    const w = len * 0.5; // 面积加权：大三角的平面更可信
    const q = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
    for (const v of [a, b, c]) {
      const o = v * 10;
      for (let k = 0; k < 10; k++) Q[o + k] += q[k] * w;
    }
  };

  for (let f = 0; f < fCount0; f++) addFaceQuadric(fv[f * 3], fv[f * 3 + 1], fv[f * 3 + 2]);

  /* ---- 顶点 → 面：每个顶点一个 Set，折叠时增量维护（不要每次重建，否则是 O(F²)）---- */
  const vFaces = new Array(capacity);
  for (let v = 0; v < vCount0; v++) vFaces[v] = new Set();
  for (let f = 0; f < fCount0; f++) {
    for (let k = 0; k < 3; k++) vFaces[fv[f * 3 + k]].add(f);
  }

  /* ---- 边堆（数组实现的最小堆，惰性删除）---- */
  const heapCost = [];
  const heapA = [];
  const heapB = [];
  const heapVer = [];
  const push = (cost, a, b) => {
    let i = heapCost.length;
    heapCost.push(cost); heapA.push(a); heapB.push(b); heapVer.push(ver[a] ^ ver[b]);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapCost[p] <= heapCost[i]) break;
      [heapCost[p], heapCost[i]] = [heapCost[i], heapCost[p]];
      [heapA[p], heapA[i]] = [heapA[i], heapA[p]];
      [heapB[p], heapB[i]] = [heapB[i], heapB[p]];
      [heapVer[p], heapVer[i]] = [heapVer[i], heapVer[p]];
      i = p;
    }
  };
  const pop = () => {
    const n = heapCost.length;
    const top = { cost: heapCost[0], a: heapA[0], b: heapB[0], v: heapVer[0] };
    const last = n - 1;
    heapCost[0] = heapCost[last]; heapA[0] = heapA[last]; heapB[0] = heapB[last]; heapVer[0] = heapVer[last];
    heapCost.pop(); heapA.pop(); heapB.pop(); heapVer.pop();
    let i = 0;
    const m = heapCost.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let best = i;
      if (l < m && heapCost[l] < heapCost[best]) best = l;
      if (r < m && heapCost[r] < heapCost[best]) best = r;
      if (best === i) break;
      [heapCost[best], heapCost[i]] = [heapCost[i], heapCost[best]];
      [heapA[best], heapA[i]] = [heapA[i], heapA[best]];
      [heapB[best], heapB[i]] = [heapB[i], heapB[best]];
      [heapVer[best], heapVer[i]] = [heapVer[i], heapVer[best]];
      i = best;
    }
    return top;
  };

  const edgeCost = (a, b) => {
    const mx = (px[a] + px[b]) * 0.5, my = (py[a] + py[b]) * 0.5, mz = (pz[a] + pz[b]) * 0.5;
    let sum = 0;
    const oa = a * 10, ob = b * 10;
    const q = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 10; k++) q[k] = Q[oa + k] + Q[ob + k];
    sum = q[0] * mx * mx + 2 * q[1] * mx * my + 2 * q[2] * mx * mz + 2 * q[3] * mx +
      2 * q[4] * my * 0 + q[4] * my * my + 2 * q[5] * my * mz + 2 * q[6] * my +
      q[7] * mz * mz + 2 * q[8] * mz + q[9];
    const len = Math.hypot(px[a] - px[b], py[a] - py[b], pz[a] - pz[b]) || 1;
    /* 加一点点边长惩罚，避免在薄结构上折出长条 */
    return sum + len * 0.02;
  };

  for (let f = 0; f < fCount0; f++) {
    if (!fAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const a = fv[f * 3 + k], b = fv[f * 3 + ((k + 1) % 3)];
      if (a < b) push(edgeCost(a, b), a, b);
    }
  }

  let guard = 0;
  const limit = fCount0 * 4;
  while (aliveFaces > targetTris && heapCost.length && guard++ < limit) {
    const top = pop();
    const a = top.a, b = top.b;
    if (!alive[a] || !alive[b]) continue;
    if ((ver[a] ^ ver[b]) !== top.v) continue; // 过期条目

    /* 折到中点，合并 quadric */
    px[a] = (px[a] + px[b]) * 0.5;
    py[a] = (py[a] + py[b]) * 0.5;
    pz[a] = (pz[a] + pz[b]) * 0.5;
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    alive[b] = 0;
    ver[a] += 1;
    ver[b] += 1;

    /* 把 b 的面重定向到 a，退化面标死；邻接表增量维护 */
    const facesB = vFaces[b];
    for (const f of facesB) {
      if (!fAlive[f]) continue;
      for (let k = 0; k < 3; k++) if (fv[f * 3 + k] === b) fv[f * 3 + k] = a;
      const v0 = fv[f * 3], v1 = fv[f * 3 + 1], v2 = fv[f * 3 + 2];
      if (v0 === v1 || v1 === v2 || v0 === v2) {
        fAlive[f] = 0;
        aliveFaces -= 1;
      } else {
        vFaces[a].add(f);
        addFaceQuadric(v0, v1, v2);
      }
    }
    vFaces[b].clear();

    /* a 的邻居边重新入堆：邻接关系已经变了，旧条目靠版本号自然失效 */
    for (const f of vFaces[a]) {
      if (!fAlive[f]) continue;
      for (let k = 0; k < 3; k++) {
        const w = fv[f * 3 + k];
        if (w !== a && alive[w]) push(edgeCost(a, w), Math.min(a, w), Math.max(a, w));
      }
    }
  }

  /* ---- 压缩输出 ---- */
  const remap = new Int32Array(capacity).fill(-1);
  let outV = 0;
  const outPos = [];
  for (let v = 0; v < capacity; v++) {
    if (!alive[v]) continue;
    remap[v] = outV++;
    outPos.push(px[v], py[v], pz[v]);
  }
  const outIdx = [];
  for (let f = 0; f < fCount0; f++) {
    if (!fAlive[f]) continue;
    const a = remap[fv[f * 3]], b = remap[fv[f * 3 + 1]], c = remap[fv[f * 3 + 2]];
    if (a < 0 || b < 0 || c < 0) continue;
    outIdx.push(a, b, c);
  }
  return {
    pos: Float32Array.from(outPos),
    idx: Uint32Array.from(outIdx),
    tris: outIdx.length / 3,
    verts: outV,
  };
}

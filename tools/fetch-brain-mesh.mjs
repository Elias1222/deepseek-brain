// tools/fetch-brain-mesh.mjs — 下载 CC BY 4.0 人脑皮层网格（Thomas Habets 的 MRI 重建）并解开 tar.gz
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'build');
const URL_TAR = 'https://codeload.github.com/ThomasHabets/brain/tar.gz/refs/heads/master';

fs.mkdirSync(OUT, { recursive: true });
const tgz = path.join(OUT, 'brain-src.tar.gz');

if (!fs.existsSync(tgz)) {
  console.log('fetching', URL_TAR);
  const res = await fetch(URL_TAR, { headers: { 'user-agent': 'deepseek-brain-build' } });
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tgz, buf);
  console.log('downloaded', (buf.length / 1048576).toFixed(1), 'MB');
} else {
  console.log('using cached tarball');
}

/* 最小 tar 解析：512 字节头 + 数据块，文件名在 0..100，长度在 124..136（八进制） */
const tar = zlib.gunzipSync(fs.readFileSync(tgz));
const want = /(lh|rh)_(vertices|faces)\.inc$/;
const files = new Map();
let off = 0;
while (off + 512 <= tar.length) {
  const header = tar.subarray(off, off + 512);
  if (header.every((b) => b === 0)) break;
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
  const body = tar.subarray(off + 512, off + 512 + size);
  if (want.test(name)) files.set(path.basename(name), body.toString('utf8'));
  off += 512 + Math.ceil(size / 512) * 512;
}

for (const [name, text] of files) {
  fs.writeFileSync(path.join(OUT, name), text);
  console.log('extracted', name, (text.length / 1048576).toFixed(2), 'MB');
  console.log('  head:', JSON.stringify(text.slice(0, 120)));
}
if (files.size === 0) throw new Error('no mesh files found in tarball');

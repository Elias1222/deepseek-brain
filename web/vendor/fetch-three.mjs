import fs from 'node:fs';

const url = 'https://unpkg.com/three@0.160.0/build/three.module.min.js';
const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const text = await res.text();
fs.writeFileSync(new URL('./three.module.min.js', import.meta.url), text);
console.log('bytes', text.length);
console.log('TAIL:', text.slice(-800));

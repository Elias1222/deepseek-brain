const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/test/memory.test.js';
let t = fs.readFileSync(p, 'utf8');

const pairs = [
  ["  const dir = tempDir();\n  const memory = new MemorySystem({ dataDir: dir });\n  bootstrap(memory);\n\n  const kept =",
   "  const memory = await makeMemory().init();\n\n  const kept ="],
  ["  const dir = tempDir();\n  const memory = new MemorySystem({ dataDir: dir });\n  bootstrap(memory);\n\n  const oldFact =",
   "  const memory = await makeMemory().init();\n\n  const oldFact ="],
  ["test('the archive is searchable and a forgotten memory can come back', () => {",
   "test('the archive is searchable and a forgotten memory can come back', async () => {"],
  ["test('restoring a hidden semantic fact does not steal the active slot', () => {",
   "test('restoring a hidden semantic fact does not steal the active slot', async () => {"],
];
for (const [a, b] of pairs) {
  if (!t.includes(a)) { console.error('MISS:', a.slice(0, 50)); process.exit(1); }
  t = t.replace(a, b);
}
fs.writeFileSync(p, t);
console.log('ok');

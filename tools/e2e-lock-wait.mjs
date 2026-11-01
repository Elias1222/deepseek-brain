import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemorySystem } from '../lib/memory.js';

const repo = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-e2e-'));
const memoryUrl = pathToFileURL(path.resolve(repo, 'lib/memory.js')).href;

/* A：子进程，拿锁后 1.2 s 释放并退出 */
const holder = path.join(os.tmpdir(), 'brain-holder.mjs');
fs.writeFileSync(holder, [
  "import { MemorySystem } from " + JSON.stringify(memoryUrl) + ";",
  "const m = await new MemorySystem({ dataDir: " + JSON.stringify(dir) + " }).init();",
  "console.log('holder ok pid=' + process.pid + ' count=' + m.stats.boot.count);",
  "setTimeout(() => { m.store.releaseLock(); process.exit(0); }, 1200);",
].join('\n'));

const child = spawn(process.execPath, [holder], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => child.stdout.once('data', (d) => { console.log(String(d).trim()); resolve(); }));

/* B：本进程，同一个目录，等锁最多 5 s */
const t0 = Date.now();
const b = await new MemorySystem({ dataDir: dir, lockWaitMs: 5000 }).init();
const waited = Date.now() - t0;
console.log('B readOnly=' + b.readOnly + ' waited<' + waited + 'ms> warnings=' + JSON.stringify(b.warnings));
b.remember({ layer: 'episodic', event: 'B 在 A 退出后写入' });
const disk = JSON.parse(fs.readFileSync(path.join(dir, 'episodic.json'), 'utf8'));
console.log('B write landed=' + disk.items.some((x) => x.event === 'B 在 A 退出后写入'));
b.store.releaseLock();

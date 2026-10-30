#!/usr/bin/env node
/**
 * Run the dashboard + 3D brain without DSH — a local preview server.
 *
 *   node tools/serve.mjs                 → http://127.0.0.1:7801/deepseek-brain/
 *   node tools/serve.mjs --port 7802     → pick a port
 *   node tools/serve.mjs --demo          → seed the 20 demo memories when the brain is empty
 *   node tools/serve.mjs --data ./tmp    → use another data directory
 *   DEEPSEEK_BRAIN_DIR=... node tools/serve.mjs
 *
 * The same handler the plugin mounts on DSH's webServer (`lib/server.js`) is used here,
 * so what you see in the preview is exactly what `brain_dashboard` serves.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemorySystem, VERSION } from '../lib/memory.js';
import { createHandler } from '../lib/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', 'web');
const BASE = '/deepseek-brain';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const port = Number(arg('port', 7801));
const dataDir = typeof arg('data', null) === 'string' ? path.resolve(arg('data')) : undefined;
const wantDemo = arg('demo', false) === true;

const memory = await new MemorySystem({ dataDir, demoSeed: false }).init();
const counts = () =>
  memory.episodic.length + memory.semantic.items.length + memory.procedural.items.length;

if (wantDemo && counts() === 0) memory.seedDemo();

const handler = createHandler({ memory, webRoot, base: BASE, version: VERSION });
const server = http.createServer((req, res) => handler.handle(req, res, BASE));

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`port ${port} is busy — try: node tools/serve.mjs --port ${port + 1}`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${port}${BASE}`;
  console.log(`deepseek-brain v${VERSION}`);
  console.log(`data dir  : ${memory.config.dataDir}`);
  console.log(`memories  : ${counts()} (${memory.episodic.length} episodic / ${memory.semantic.items.length} semantic / ${memory.procedural.items.length} procedural)`);
  console.log(`dashboard : ${origin}/dashboard.html`);
  console.log(`3D brain  : ${origin}/brain-3d.html`);
  console.log(`state API : ${origin}/api/state`);
  console.log('Ctrl+C to stop.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

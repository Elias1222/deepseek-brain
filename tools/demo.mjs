#!/usr/bin/env node
/**
 * Seed the persistent brain with the 20-item demo archive and print the ASCII map.
 *
 *   node tools/demo.mjs           → seed + visualize (uses ~/.deepseek-brain)
 *   node tools/demo.mjs --fresh   → wipe the demo entries first, then reseed
 *   DEEPSEEK_BRAIN_DIR=... node tools/demo.mjs
 */
import { MemorySystem, VERSION } from '../lib/memory.js';

const fresh = process.argv.includes('--fresh');
const memory = await new MemorySystem({ demoSeed: false }).init();

if (fresh) {
  memory.episodic = memory.episodic.filter((it) => it.source !== 'demo');
  memory.semantic.items = memory.semantic.items.filter((it) => it.source !== 'demo');
  memory.procedural.items = memory.procedural.items.filter((it) => it.source !== 'demo');
}

const before = memory.episodic.length + memory.semantic.items.length + memory.procedural.items.length;
memory.seedDemo();
memory.persist();
const after = memory.episodic.length + memory.semantic.items.length + memory.procedural.items.length;

console.log(`DeepSeek Brain v${VERSION}`);
console.log(`data dir : ${memory.config.dataDir}`);
console.log(`seeded   : ${before} → ${after} memories (${memory.episodic.length} episodic / ${memory.semantic.items.length} semantic / ${memory.procedural.items.length} procedural)`);
console.log('');
console.log(memory.visualize());
console.log('');
console.log('dashboard : brain_dashboard tool, or GET /api/state from the local server');
console.log('3D brain  : web/brain-3d.html (wire to the API) or dist/deepseek-brain-3d.html (standalone demo)');

import { clamp, id, nowIso, oneLine, truncate } from './util.js';

/**
 * Procedural memory: rules and habits ("always answer with the conclusion first",
 * "user is vegetarian", "the deployment command is pnpm build"). They are injected
 * into the system prompt as behavioural defaults and grow stronger when used.
 */

export class ProceduralMemory {
  constructor(state = { items: [] }) {
    this.items = state.items ?? [];
  }

  add(input, now = Date.now()) {
    const rule = oneLine(input.rule ?? input.text ?? '').slice(0, 400);
    if (!rule) throw new Error('procedural memory needs a "rule"');
    const existing = this.items.find((it) => normalize(rule) === normalize(it.rule));
    if (existing) {
      existing.hits = (existing.hits ?? 0) + 1;
      existing.strength = clamp((existing.strength ?? 1) + 0.5, 0, 5);
      return { item: existing, duplicate: true };
    }
    const item = {
      id: id('pro'),
      ts: nowIso(now),
      rule,
      importance: clamp(Math.round(input.importance ?? 3), 1, 5),
      strength: clamp(Math.round(input.importance ?? 3), 1, 5),
      hits: 0,
      source: input.source ?? 'manual',
      layer: 'procedural',
    };
    this.items.push(item);
    return { item, duplicate: false };
  }

  touch(idOrRule) {
    const target = this.items.find((it) => it.id === idOrRule) ?? this.items.find((it) => normalize(it.rule) === normalize(idOrRule));
    if (!target) return null;
    target.hits = (target.hits ?? 0) + 1;
    target.strength = clamp((target.strength ?? 1) + 0.1, 0, 5);
    return target;
  }

  remove(idToRemove, now = Date.now()) {
    const idx = this.items.findIndex((it) => it.id === idToRemove);
    if (idx < 0) return null;
    const [item] = this.items.splice(idx, 1);
    return { ...item, archivedAt: nowIso(now) };
  }

  /** Strongest rules first — the prompt injection order. */
  ranked(limit = 12) {
    return [...this.items]
      .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0) || Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, limit);
  }

  promptBlock(limit = 10) {
    const rules = this.ranked(limit);
    if (rules.length === 0) return '';
    return rules.map((r, i) => `${i + 1}. ${truncate(r.rule, 160)}`).join('\n');
  }

  toJSON() {
    return { version: 1, items: this.items };
  }
}

function normalize(text) {
  return oneLine(text).replace(/[，。！？!?.,；;：:\s]/g, '');
}

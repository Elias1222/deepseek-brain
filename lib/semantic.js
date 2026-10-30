import { clamp, id, isToday, nowIso, oneLine } from './util.js';

/**
 * Semantic memory: a knowledge graph stored as (subject, relation, object)
 * triples, with entity alias merging and non-destructive conflict resolution.
 *
 * When a new fact contradicts an active one for the same (subject, relation),
 * the old triple becomes `corrected` and keeps `supersededBy`; nothing is
 * physically deleted, so the model can always answer "what did I believe before".
 */

export function normalizeKey(text) {
  return oneLine(text).toLowerCase().replace(/\s+/g, '');
}

export class SemanticMemory {
  constructor(state = { items: [], aliases: {} }) {
    this.items = state.items ?? [];
    this.aliases = state.aliases ?? {};
  }

  /** Resolve an alias chain to the canonical entity name. */
  resolve(name) {
    let key = normalizeKey(name);
    const seen = new Set();
    while (this.aliases[key] && !seen.has(key)) {
      seen.add(key);
      key = normalizeKey(this.aliases[key]);
    }
    return key;
  }

  /** Merge two spellings: every future mention of `aliasName` resolves to `canonical`. */
  mergeAlias(aliasName, canonicalName) {
    const alias = normalizeKey(aliasName);
    const canonical = this.resolve(canonicalName);
    if (!alias || !canonical || alias === canonical) return null;
    this.aliases[alias] = canonical;
    for (const item of this.items) {
      if (normalizeKey(item.subject) === alias) item.subject = canonicalName;
      if (normalizeKey(item.object) === alias) item.object = canonicalName;
    }
    return { alias, canonical };
  }

  add(input, now = Date.now()) {
    const subject = oneLine(input.subject ?? '').slice(0, 80);
    const relation = oneLine(input.relation ?? '').slice(0, 60);
    const object = oneLine(input.object ?? '').slice(0, 160);
    if (!subject || !relation || !object) throw new Error('semantic memory needs subject, relation and object');
    const key = normalizeKey(subject);
    const canonical = this.aliases[key] ? this.resolve(subject) : key;

    const conflicting = this.items.filter(
      (it) => it.status === 'active' && this.resolve(it.subject) === canonical && it.relation === relation,
    );
    const same = conflicting.find((it) => normalizeKey(it.object) === normalizeKey(object));
    if (same) {
      same.hits = (same.hits ?? 0) + 1;
      same.lastSeen = nowIso(now);
      same.importance = clamp(Math.max(same.importance ?? 3, Math.round(input.importance ?? 3)), 1, 5);
      return { item: same, corrected: [], duplicate: true };
    }

    const item = {
      id: id('sem'),
      ts: nowIso(now),
      subject,
      relation,
      object,
      importance: clamp(Math.round(input.importance ?? 3), 1, 5),
      status: 'active',
      supersedes: null,
      supersededBy: null,
      source: input.source ?? 'manual',
      hits: 0,
      layer: 'semantic',
    };

    const corrected = [];
    for (const old of conflicting) {
      old.status = 'corrected';
      old.supersededBy = item.id;
      old.correctedAt = nowIso(now);
      item.supersedes = old.id;
      corrected.push(old);
    }
    this.items.push(item);
    return { item, corrected, duplicate: false };
  }

  active() {
    return this.items.filter((it) => it.status === 'active');
  }

  forSubject(subject) {
    const key = this.resolve(subject);
    return this.items.filter((it) => this.resolve(it.subject) === key);
  }

  /** Version history of one (subject, relation) fact slot, newest first. */
  history(subject, relation) {
    const key = this.resolve(subject);
    return this.items
      .filter((it) => this.resolve(it.subject) === key && it.relation === relation)
      .sort((a, b) => {
        const delta = Date.parse(b.ts) - Date.parse(a.ts);
        if (delta !== 0) return delta;
        // Same-millisecond writes: the currently valid fact is the newer one.
        const rank = (it) => (it.status === 'active' ? 0 : 1);
        return rank(a) - rank(b);
      });
  }

  forget(idToForget, now = Date.now()) {
    const item = this.items.find((it) => it.id === idToForget);
    if (!item) return null;
    item.status = 'archived';
    item.archivedAt = nowIso(now);
    if (item.supersededBy) {
      const successor = this.items.find((it) => it.id === item.supersededBy);
      if (successor) successor.supersedes = item.supersedes ?? null;
    }
    return item;
  }

  addedToday(now = Date.now()) {
    return this.items.filter((it) => it.status === 'active' && isToday(it.ts, now)).length;
  }

  toJSON() {
    return { version: 1, items: this.items, aliases: this.aliases };
  }
}

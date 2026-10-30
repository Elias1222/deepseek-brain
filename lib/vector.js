import { tokenize } from './util.js';

/**
 * Optional semantic recall.
 *
 * Default OFF. Two providers:
 *  - `hash` (always available, zero deps): a 256-d hashed bag-of-words embedding +
 *    cosine similarity. It is a *lexical* index — honest but not semantic.
 *  - `lancedb` (opt-in, requires `pnpm add @lancedb/lancedb`): the plugin opens the
 *    local LanceDB database as an extension point. Scoring still runs on the built-in
 *    hashed cosine until you plug real embeddings into `search()`; if the module is
 *    missing the plugin logs one warning and silently falls back to `hash`.
 *    Retrieval never breaks because of it.
 */

export const VECTOR_DIM = 256;

export function hashEmbed(text, dim = VECTOR_DIM) {
  const vec = new Float32Array(dim);
  for (const token of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    vec[idx] += 1;
  }
  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) vec[i] /= norm;
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export class VectorIndex {
  constructor({ enabled = false, provider = 'hash', dim = VECTOR_DIM } = {}) {
    this.enabled = Boolean(enabled);
    this.provider = provider;
    this.dim = dim;
    this.vectors = new Map();
    this.texts = new Map();
    this.lance = null;
    this.warning = null;
  }

  async init({ dir, records = [] } = {}) {
    if (!this.enabled) return this;
    if (this.provider === 'lancedb') {
      try {
        const mod = await import('@lancedb/lancedb');
        const db = await mod.connect(dir);
        this.lance = { mod, db, dir };
      } catch (error) {
        this.warning = `LanceDB unavailable (${error.message}); falling back to hash embeddings`;
        this.provider = 'hash';
      }
    }
    this.rebuild(records);
    return this;
  }

  rebuild(records) {
    if (!this.enabled) return;
    this.vectors.clear();
    this.texts.clear();
    for (const rec of records) {
      const text = `${rec.title ?? ''} ${rec.body ?? ''}`;
      this.vectors.set(rec.id, hashEmbed(text, this.dim));
      this.texts.set(rec.id, text);
    }
  }

  /** @returns {Map<string, number>|null} id → similarity in [0,1] */
  search(query, k = 20) {
    if (!this.enabled || this.vectors.size === 0) return null;
    const q = hashEmbed(query, this.dim);
    const scored = [];
    for (const [recId, vec] of this.vectors) {
      const score = cosine(q, vec);
      if (score > 0) scored.push([recId, score]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    return new Map(scored.slice(0, k).map(([recId, score]) => [recId, Math.min(1, score)]));
  }

  status() {
    return {
      enabled: this.enabled,
      provider: this.provider,
      dim: this.dim,
      indexed: this.vectors.size,
      warning: this.warning,
    };
  }
}

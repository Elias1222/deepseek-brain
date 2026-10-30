import { daysBetween, overlapScore, tokenize, truncate } from './util.js';
import { strengthOf } from './episodic.js';

/**
 * Retrieval: keyword match + importance weight + time-decay ranking, top-K.
 * Optionally blended with a vector-recall score from `vector.js` (disabled by default).
 *
 * The scoring is deliberately transparent (every hit carries its component
 * scores) so `brain_recall` can explain *why* a memory surfaced.
 */

const LAYER_WEIGHT = {
  working: 0.35,
  sensory: 0.3,
  episodic: 1,
  semantic: 1.05,
  procedural: 0.95,
};

const WEIGHTS = { keyword: 0.55, importance: 0.2, freshness: 0.2, layer: 0.05 };

export function buildRecords(state) {
  const records = [];
  const lambda = state.lambda ?? 0.05;
  const now = state.now ?? Date.now();

  for (const it of state.episodic ?? []) {
    records.push({
      layer: 'episodic',
      id: it.id,
      ts: it.ts,
      importance: it.importance,
      strength: it.strength ?? strengthOf(it, lambda, now),
      title: it.event,
      detail: [it.participants?.length ? `参与:${it.participants.join('、')}` : '', it.place ? `地点:${it.place}` : '', it.emotion ? `情绪:${it.emotion}` : '']
        .filter(Boolean)
        .join(' '),
      body: [it.event, it.detail, it.place, it.emotion, ...(it.participants ?? []), ...(it.tags ?? [])].join(' '),
      raw: it,
    });
  }
  for (const it of state.semantic ?? []) {
    if (it.status === 'archived') continue;
    records.push({
      layer: 'semantic',
      id: it.id,
      ts: it.ts,
      importance: it.importance,
      strength: it.importance * Math.exp(-lambda * daysBetween(it.ts, now)),
      title: `${it.subject} → ${it.relation} → ${it.object}`,
      detail: it.status === 'corrected' ? '[已修正]' : '',
      body: `${it.subject} ${it.relation} ${it.object}`,
      raw: it,
    });
  }
  for (const it of state.procedural ?? []) {
    records.push({
      layer: 'procedural',
      id: it.id,
      ts: it.ts,
      importance: it.importance,
      strength: it.strength,
      title: it.rule,
      detail: `命中 ${it.hits ?? 0} 次`,
      body: it.rule,
      raw: it,
    });
  }
  for (const it of state.working ?? []) {
    records.push({
      layer: 'working',
      id: it.id,
      ts: it.ts,
      importance: 3,
      strength: 3,
      title: `当前话题: ${it.title}`,
      detail: '栈内活跃',
      body: it.title,
      raw: it,
    });
  }
  for (const it of state.sensory ?? []) {
    records.push({
      layer: 'sensory',
      id: it.id,
      ts: it.ts,
      importance: it.importance ?? 1,
      strength: 1,
      title: it.text,
      detail: '感觉缓冲',
      body: it.text,
      raw: it,
    });
  }
  return records;
}

/**
 * @param {object} state  { lambda, now, episodic, semantic, procedural, working, sensory }
 * @param {string} query
 * @param {{ topK?: number, minScore?: number, vectorScores?: Map<string, number>, layers?: string[] }} opts
 */
export function recall(state, query, opts = {}) {
  const topK = Math.max(1, Math.min(50, opts.topK ?? 6));
  const minScore = opts.minScore ?? 0.06;
  const queryTokens = tokenize(query);
  const records = buildRecords(state).filter((r) => !opts.layers || opts.layers.includes(r.layer));
  const hits = [];
  for (const rec of records) {
    const tokens = tokenize(rec.body);
    const keyword = overlapScore(queryTokens, tokens);
    const vector = opts.vectorScores?.get(rec.id) ?? 0;
    if (keyword === 0 && vector === 0) continue;
    const importance = (rec.importance ?? 0) / 5;
    const freshness = Math.min(1, (rec.strength ?? 0) / 5);
    const score =
      keyword * WEIGHTS.keyword +
      importance * WEIGHTS.importance +
      freshness * WEIGHTS.freshness +
      (LAYER_WEIGHT[rec.layer] ?? 1) * WEIGHTS.layer +
      vector * 0.3;
    if (score < minScore) continue;
    hits.push({
      layer: rec.layer,
      id: rec.id,
      ts: rec.ts,
      title: truncate(rec.title, 120),
      detail: truncate(rec.detail ?? '', 120),
      score: Math.round(score * 1000) / 1000,
      parts: {
        keyword: Math.round(keyword * 100) / 100,
        importance: Math.round(importance * 100) / 100,
        freshness: Math.round(freshness * 100) / 100,
        vector: Math.round(vector * 100) / 100,
      },
      strength: Math.round((rec.strength ?? 0) * 100) / 100,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return { query, topK, hits: hits.slice(0, topK), scanned: records.length };
}

export function renderHits(result) {
  if (result.hits.length === 0) {
    return `未检索到与「${truncate(result.query, 40)}」相关的记忆（扫描 ${result.scanned} 条）。`;
  }
  const lines = [`检索「${truncate(result.query, 40)}」→ 命中 ${result.hits.length} 条（扫描 ${result.scanned} 条）`];
  result.hits.forEach((h, i) => {
    const layerName = { sensory: '感觉', working: '工作', episodic: '情景', semantic: '语义', procedural: '程序' }[h.layer] ?? h.layer;
    lines.push(`${i + 1}. [${layerName}] ${h.title}${h.detail ? `（${h.detail}）` : ''}`);
    lines.push(`   score ${h.score.toFixed(3)} · 关键词 ${h.parts.keyword.toFixed(2)} · 重要度 ${h.parts.importance.toFixed(2)} · 新鲜度 ${h.parts.freshness.toFixed(2)} · id ${h.id}`);
  });
  return lines.join('\n');
}

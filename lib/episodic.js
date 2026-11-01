import { clamp, daysBetween, id, isToday, nowIso, oneLine, round } from './util.js';

/**
 * Episodic memory: timestamped events with participants, place, emotional tone
 * and importance. Strength follows Ebbinghaus' exponential forgetting curve
 *     strength = importance × exp(-λ × elapsedDays)
 * but importance ≥ 4 is "flashbulb" memory and is never forgotten.
 */

export const PINNED_IMPORTANCE = 4;
export const FORGET_THRESHOLD = 0.5;

export function strengthOf(item, lambda, now = Date.now()) {
  const importance = clamp(item.importance ?? 2, 1, 5);
  const days = daysBetween(item.ts, now);
  return round(importance * Math.exp(-lambda * days), 3);
}

export function createEpisodic(input, now = Date.now()) {
  const event = oneLine(input.event ?? input.text ?? '').slice(0, 200);
  if (!event) throw new Error('episodic memory needs an "event"');
  return {
    id: id('ep'),
    ts: input.ts ? new Date(input.ts).toISOString() : nowIso(now),
    event,
    participants: [...new Set((input.participants ?? []).map((p) => oneLine(p)).filter(Boolean))].slice(0, 12),
    place: oneLine(input.place ?? '').slice(0, 80),
    emotion: oneLine(input.emotion ?? '').slice(0, 40),
    valence: clamp(input.valence ?? 0, -1, 1),
    importance: clamp(Math.round(input.importance ?? 3), 1, 5),
    detail: oneLine(input.detail ?? '').slice(0, 2000),
    source: input.source ?? 'manual',
    consolidated: Boolean(input.consolidated ?? false),
    tags: [...new Set((input.tags ?? []).map(oneLine).filter(Boolean))].slice(0, 12),
    hits: Number(input.hits ?? 0),
    /* 事件本身发生在什么时候（与入库时间 ts 分开）：只由时间短语解析得出 */
    when: oneLine(input.when ?? '').slice(0, 40),
    whenAt: input.whenAt ? new Date(input.whenAt).toISOString() : null,
    layer: 'episodic',
  };
}

export function withStrength(items, lambda, now = Date.now()) {
  return items.map((item) => ({ ...item, strength: strengthOf(item, lambda, now) }));
}

/**
 * Forget weak memories.
 * - importance ≥ PINNED_IMPORTANCE: never forgotten (flashbulb rule).
 * - strength < threshold: moved to the archive (never physically deleted).
 */
export function decay(items, { lambda, threshold = FORGET_THRESHOLD, now = Date.now() } = {}) {
  const kept = [];
  const forgotten = [];
  for (const item of items) {
    const strength = strengthOf(item, lambda, now);
    if (item.importance >= PINNED_IMPORTANCE || strength >= threshold) {
      kept.push({ ...item, strength });
    } else {
      forgotten.push({ ...item, strength, forgottenAt: nowIso(now), reason: 'decay' });
    }
  }
  return { kept, forgotten };
}

export function touched(items, ids, now = Date.now()) {
  const set = new Set(ids);
  for (const item of items) if (set.has(item.id)) item.hits = (item.hits ?? 0) + 1;
  return items;
}

export function addedToday(items, now = Date.now()) {
  return items.filter((it) => isToday(it.ts, now)).length;
}

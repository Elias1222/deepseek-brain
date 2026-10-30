/**
 * Small dependency-free helpers shared by every memory layer.
 * Everything here is pure and deterministic so the layer modules stay unit-testable.
 */

let counter = 0;

export function id(prefix) {
  counter = (counter + 1) % 0xffff;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export const DAY_MS = 86_400_000;

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function daysBetween(fromIso, toMs = Date.now()) {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, (toMs - from) / DAY_MS);
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isToday(iso, now = Date.now()) {
  return dayKey(Date.parse(iso) || 0) === dayKey(now);
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Latin words, numbers and Chinese runs (bi-grams + the run itself) used by keyword recall. */
export function tokenize(text) {
  const str = String(text ?? '').toLowerCase();
  const out = new Set();
  for (const m of str.matchAll(/[a-z0-9][a-z0-9._-]{1,}/g)) out.add(m[0]);
  for (const m of str.matchAll(/[\u4e00-\u9fa5]{1,}/g)) {
    const run = m[0];
    if (run.length <= 4) out.add(run);
    for (let i = 0; i < run.length - 1; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

export function overlapScore(queryTokens, tokens) {
  if (queryTokens.length === 0 || tokens.length === 0) return 0;
  const set = new Set(tokens);
  let hit = 0;
  for (const t of queryTokens) if (set.has(t)) hit += 1;
  return hit / Math.sqrt(queryTokens.length * tokens.length);
}

export function truncate(text, max = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function unique(list) {
  return [...new Set((list ?? []).filter(Boolean))];
}

export function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Strip control characters that would corrupt the ASCII brain output. */
export function oneLine(text) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

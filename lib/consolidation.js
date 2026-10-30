import { dayKey, formatDate, id, nowIso, round } from './util.js';
import { strengthOf } from './episodic.js';

/**
 * Sleep-like consolidation ("replay"): high-importance episodes are promoted and
 * their low-value detail is compressed; weak low-importance episodes are folded
 * into one daily digest and moved out of the live store (archived, not deleted).
 *
 * This mirrors systems consolidation during slow-wave sleep: the hippocampus
 * replays salient episodes to the cortex, and fine detail is lost.
 */
export function consolidate(items, { lambda = 0.05, threshold = 0.5, now = Date.now(), minAgeHours = 6, maxDetail = 160 } = {}) {
  const minAgeMs = Math.max(0, Number(minAgeHours) || 0) * 3_600_000;
  const kept = [];
  const archived = [];
  const digests = [];
  const buckets = new Map();
  let migrated = 0;
  let compressed = 0;

  for (const item of items) {
    const age = now - Date.parse(item.ts);
    if (age < minAgeMs) {
      kept.push(item);
      continue;
    }
    const strength = strengthOf(item, lambda, now);
    const high = item.importance >= 4;
    const weak = strength < threshold || (item.importance <= 2 && age > 3 * 86_400_000);

    if (high) {
      migrated += 1;
      const detail = item.detail ?? '';
      const next = {
        ...item,
        consolidated: true,
        strength,
        tags: [...new Set([...(item.tags ?? []), '长期'])],
        detail: detail.length > maxDetail ? `${detail.slice(0, maxDetail - 1)}…` : detail,
      };
      kept.push(next);
    } else if (weak) {
      const key = dayKey(Date.parse(item.ts));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
      archived.push({ ...item, strength: round(strength, 3), forgottenAt: nowIso(now), reason: 'consolidation' });
      compressed += 1;
    } else {
      kept.push({ ...item, strength });
    }
  }

  for (const [day, group] of buckets) {
    const events = group
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      .map((it) => it.event);
    const summary = events.join('；').slice(0, 240);
    digests.push({
      id: id('ep'),
      ts: new Date(`${day}T12:00:00`).toISOString(),
      event: `[${day}] 当日摘要：共 ${events.length} 件小事`,
      detail: summary,
      participants: [...new Set(group.flatMap((it) => it.participants ?? []))].slice(0, 8),
      place: '',
      emotion: '',
      valence: 0,
      importance: 2,
      source: 'consolidated',
      consolidated: false,
      tags: ['摘要'],
      hits: 0,
      layer: 'episodic',
    });
  }

  return {
    items: [...kept, ...digests],
    archived,
    digests,
    report: {
      migrated,
      compressed,
      pruned: archived.length,
      digests: digests.length,
      kept: kept.length,
      at: nowIso(now),
    },
    text:
      `睡眠巩固完成：长期化 ${migrated} 条，压缩细节 ${compressed} 条，` +
      `生成 ${digests.length} 条日摘要，当前活跃情景记忆 ${kept.length + digests.length} 条。`,
  };
}

export function isNightHour(now = Date.now()) {
  const h = new Date(now).getHours();
  return h >= 23 || h < 6;
}

export { formatDate };

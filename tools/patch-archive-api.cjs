const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/memory.js';
let t = fs.readFileSync(p, 'utf8');

/* 1) util 导入补 tokenize / overlapScore */
const a1 = "import { clamp, id, isToday, nowIso, oneLine, truncate, unique } from './util.js';";
const b1 = "import { clamp, id, isToday, nowIso, oneLine, overlapScore, tokenize, truncate, unique } from './util.js';";
if (!t.includes(a1)) { console.error('MISS util import'); process.exit(1); }
t = t.replace(a1, b1);

/* 2) 方法插入 */
const anchor = `  /**
   * 把另一台设备导出的档案并进来（export.json 的同一形状）。`;
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }

const methods = `  /**
   * 归档区：把 archive.json 里的条目与「被标为 archived 的语义事实」放进同一个视图，
   * 可按关键词、层级筛选。取回之前先看清楚它是什么、为什么被归档。
   */
  archiveList({ query = '', layer = null, limit = 40 } = {}) {
    const tokens = query ? tokenize(String(query)) : [];
    const rows = [];

    const layerOf = (it) => {
      if (it.event !== undefined) return 'episodic';
      if (it.rule !== undefined) return 'procedural';
      if (it.subject !== undefined) return 'semantic';
      return 'episodic';
    };
    const titleOf = (it, l) => {
      if (l === 'episodic') return it.event;
      if (l === 'procedural') return it.rule;
      return \`\${it.subject} → \${it.relation} → \${it.object}\`;
    };

    for (const it of this.archive) {
      const l = layerOf(it);
      rows.push({
        id: it.id,
        layer: l,
        title: titleOf(it, l) || it.id,
        body: it.detail || it.rule || '',
        importance: it.importance ?? null,
        ts: it.ts ?? null,
        archivedAt: it.archivedAt ?? null,
        reason: it.reason ?? 'manual',
        source: 'archive.json',
      });
    }

    for (const it of this.semantic.items) {
      if (it.status !== 'archived') continue;
      rows.push({
        id: it.id,
        layer: 'semantic',
        title: \`\${it.subject} → \${it.relation} → \${it.object}\`,
        body: '',
        importance: it.importance ?? null,
        ts: it.ts ?? null,
        archivedAt: it.archivedAt ?? null,
        reason: 'manual',
        source: 'semantic',
      });
    }

    let list = rows;
    if (layer) list = list.filter((it) => it.layer === layer);
    if (tokens.length) {
      list = list
        .map((it) => ({ ...it, score: overlapScore(\`\${it.title} \${it.body}\`, tokens) }))
        .filter((it) => it.score > 0)
        .sort((a, b) => b.score - a.score || String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? '')));
    } else {
      list = list
        .map((it) => ({ ...it, score: 0 }))
        .sort((a, b) => String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? '')));
    }

    return {
      total: list.length,
      byLayer: {
        episodic: rows.filter((it) => it.layer === 'episodic').length,
        semantic: rows.filter((it) => it.layer === 'semantic').length,
        procedural: rows.filter((it) => it.layer === 'procedural').length,
      },
      items: list.slice(0, clamp(Number(limit) || 40, 1, 200)),
    };
  }

  /**
   * 从归档区取回一条：回到它原本的层里继续参与检索与衰减。
   * 语义事实若槽位已有生效值，就回到「已修正」的位置，而不是抢走生效位。
   */
  restoreArchived(idToRestore, now = Date.now(), sessionId = 'default') {
    const fromArchive = this.archive.findIndex((it) => it.id === idToRestore);
    let item = null;
    let layer = null;

    if (fromArchive >= 0) {
      const [raw] = this.archive.splice(fromArchive, 1);
      const restored = { ...raw, restoredAt: nowIso(now) };
      delete restored.archivedAt;
      delete restored.prunedAt;
      delete restored.reason;
      layer = restored.event !== undefined ? 'episodic' : restored.rule !== undefined ? 'procedural' : 'semantic';
      if (layer === 'episodic') {
        this.episodic.push(restored);
        item = this.decorateEpisodic(restored, now);
      } else if (layer === 'procedural') {
        this.procedural.items.push(restored);
        item = restored;
      } else {
        this.semantic.items.push(restored);
        item = restored;
      }
    } else {
      const hidden = this.semantic.items.find((it) => it.id === idToRestore && it.status === 'archived');
      if (!hidden) return null;
      const live = this.semantic.items.find(
        (it) => it.status === 'active' && it.subject === hidden.subject && it.relation === hidden.relation,
      );
      if (live) {
        hidden.status = 'corrected';
        hidden.supersededBy = live.id;
        hidden.correctedAt = nowIso(now);
        delete hidden.archivedAt;
        live.supersedes = hidden.id;
      } else {
        hidden.status = 'active';
        delete hidden.archivedAt;
      }
      hidden.restoredAt = nowIso(now);
      hidden.hits = (hidden.hits ?? 0) + 1;
      item = hidden;
      layer = 'semantic';
    }

    this.persist();
    const title =
      layer === 'episodic'
        ? item.event
        : layer === 'procedural'
          ? item.rule
          : \`\${item.subject} → \${item.relation} → \${item.object}\`;
    this.activity.push('restore', { sessionId, layer, id: item.id, title }, now);
    return { layer, item };
  }

` + anchor;

t = t.replace(anchor, methods);
fs.writeFileSync(p, t);
console.log('ok');

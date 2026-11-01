// 废弃事实清理：按 (subject, relation) 聚合 corrected，可预览、可软归档（进 archive.json，不物理删除）。
const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/memory.js';
let t = fs.readFileSync(p, 'utf8');

const anchor = `  /**
   * 把另一台设备导出的档案并进来（export.json 的同一形状）。`;
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }

const block = `  /**
   * 按 (subject, relation) 聚合被修正的事实，配当前生效值。
   * 只读：给「废弃事实」面板用，告诉人哪一槽位堆了多少条旧值。
   */
  conflictGroups() {
    const items = this.semantic.items;
    const map = new Map();
    for (const it of items) {
      if (it.status !== 'corrected') continue;
      const key = \`\${it.subject}\\u0000\${it.relation}\`;
      if (!map.has(key)) map.set(key, { subject: it.subject, relation: it.relation, corrected: [] });
      map.get(key).corrected.push({ id: it.id, object: it.object, ts: it.ts ?? null, importance: it.importance ?? 3 });
    }
    const groups = [];
    for (const g of map.values()) {
      const live = items.find((x) => x.subject === g.subject && x.relation === g.relation && x.status === 'active') ?? null;
      g.corrected.sort((a, b) => Date.parse(b.ts ?? 0) - Date.parse(a.ts ?? 0));
      groups.push({
        key: \`\${g.subject} → \${g.relation}\`,
        subject: g.subject,
        relation: g.relation,
        current: live ? { id: live.id, object: live.object, ts: live.ts ?? null } : null,
        corrected: g.corrected,
        removable: Math.max(0, g.corrected.length - 1),
      });
    }
    groups.sort((a, b) => b.corrected.length - a.corrected.length || (a.key < b.key ? -1 : 1));
    return groups;
  }

  /**
   * 清理废弃事实：每个槽位保留最近 keep 条（默认 1，也就是只留「上一版」），
   * 其余软归档到 archive.json。dryRun 只算不写。
   */
  pruneConflicts({ subject = null, relation = null, keep = 1, dryRun = false, now = Date.now(), sessionId = 'default' } = {}) {
    const keepN = clamp(Math.trunc(Number(keep) || 0), 0, 20);
    const groups = this.conflictGroups().filter(
      (g) => (!subject || g.subject === subject) && (!relation || g.relation === relation),
    );
    const victims = [];
    for (const g of groups) {
      victims.push(...g.corrected.slice(keepN));
    }
    const report = {
      keep: keepN,
      dryRun: Boolean(dryRun),
      groups: groups.length,
      removed: victims.length,
      ids: victims.map((v) => v.id),
      byGroup: groups.map((g) => ({ key: g.key, kept: Math.min(keepN, g.corrected.length), removed: Math.max(0, g.corrected.length - keepN) })),
    };
    if (dryRun || !victims.length) return report;

    const doomed = new Set(report.ids);
    const kept = [];
    const gone = [];
    for (const it of this.semantic.items) {
      if (doomed.has(it.id)) gone.push(it);
      else kept.push(it);
    }
    this.semantic.items = kept;
    this.archive.push(
      ...gone.map((it) => ({ ...it, archivedAt: nowIso(now), reason: 'superseded', prunedAt: nowIso(now) })),
    );
    this.stats.counters.pruned = (this.stats.counters.pruned ?? 0) + gone.length;
    this.persist();
    this.activity.push(
      'prune',
      { sessionId, layer: 'semantic', count: gone.length, groups: report.groups, keep: keepN, titles: gone.slice(0, 6).map((it) => \`\${it.subject} \${it.relation} \${it.object}\`) },
      now,
    );
    return report;
  }

` + anchor;

t = t.replace(anchor, block);
fs.writeFileSync(p, t);
console.log('memory ok', t.length);

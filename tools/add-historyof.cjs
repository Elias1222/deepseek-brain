const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/memory.js';
let t = fs.readFileSync(p, 'utf8');

const anchor = '  /** 每一条被修正的语义事实 = 一组「旧值 / 当前值」，供冲突复核面板使用。 */';
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }

const block = `  /** 版本链：v1 是入库时的样子，之后每次编辑压一版，最后一版是当前值。 */
  historyOf(idWanted, now = Date.now()) {
    const epi = this.episodic.find((it) => it.id === idWanted);
    if (epi) return { layer: 'episodic', id: epi.id, title: epi.event, versions: this.versionList(epi) };
    const pro = this.procedural.items.find((it) => it.id === idWanted);
    if (pro) return { layer: 'procedural', id: pro.id, title: pro.rule, versions: this.versionList(pro) };
    const sem = this.semantic.items.find((it) => it.id === idWanted);
    if (sem) {
      const chain = this.semantic.history(sem.subject, sem.relation);
      const total = chain.length;
      return {
        layer: 'semantic',
        id: sem.id,
        title: \`\${sem.subject} \${sem.relation} \${sem.object}\`,
        versions: chain.map((it, i) => ({
          v: total - i,
          ts: it.ts,
          id: it.id,
          status: it.status === 'active' ? 'active' : 'corrected',
          current: it.status === 'active',
          fields: { object: it.object, importance: it.importance },
          changed: [],
        })),
      };
    }
    return null;
  }

  versionList(item) {
    const versions = (item.history ?? []).map((h) => ({
      v: h.v, ts: h.ts, fields: h.fields, changed: h.changed ?? [], status: 'past', current: false,
    }));
    versions.push({
      v: item.version ?? (versions.length + 1),
      ts: item.editedAt ?? item.ts,
      fields: MemorySystem.snapshotFields(item),
      changed: [],
      status: 'current',
      current: true,
    });
    return versions;
  }

`;
t = t.replace(anchor, block + anchor);
fs.writeFileSync(p, t);
console.log('ok', t.length);

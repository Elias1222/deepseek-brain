const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/index.js';
let t = fs.readFileSync(p, 'utf8');

const anchor = `  ctx.tools.register({
    name: 'brain_dashboard',`;
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }

const block = `  ctx.tools.register({
    name: 'brain_archive',
    description:
      'Look inside the archive (forgotten, pruned and manually archived memories). Without id it lists them with archive time and reason, filtered by query/layer; with id it restores that one into its original layer so it takes part in recall and decay again.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Keyword filter (optional).' },
        layer: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'Restrict to one layer (optional).' },
        limit: { type: 'integer', description: 'How many rows to return, 1-200, default 40.' },
        id: { type: 'string', description: 'Restore this id instead of listing.' },
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const idToRestore = typeof args?.id === 'string' ? args.id.trim() : '';
        if (idToRestore) {
          const restored = memory.restoreArchived(idToRestore, Date.now(), sessionIdOf(exec));
          if (!restored) return { text: \`归档区里没有 \${idToRestore}。\` };
          const it = restored.item;
          const title =
            restored.layer === 'episodic'
              ? it.event
              : restored.layer === 'procedural'
                ? it.rule
                : \`\${it.subject} → \${it.relation} → \${it.object}\`;
          return { text: \`已取回 → \${restored.layer}：\${title}\` };
        }

        const result = memory.archiveList({ query: args?.query ?? '', layer: args?.layer ?? null, limit: args?.limit ?? 40 });
        if (!result.total) return { text: '归档区是空的：没有遗忘、没有清理、也没有被手动归档的记忆。' };

        const lines = [
          \`归档区 · 共 \${result.total} 条（情景 \${result.byLayer.episodic} / 语义 \${result.byLayer.semantic} / 程序 \${result.byLayer.procedural}）\`,
        ];
        for (const it of result.items.slice(0, 12)) {
          const when = it.archivedAt ? String(it.archivedAt).slice(0, 16).replace('T', ' ') : '—';
          lines.push(\`· \${when} [\${it.layer}] \${it.title} · 原因 \${it.reason} · \${it.id}\`);
        }
        if (result.total > 12) lines.push(\`（还有 \${result.total - 12} 条，用 query / limit 继续查）\`);
        lines.push('取回：brain_archive { id }');
        return { text: lines.join('\\n') };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

` + anchor;

t = t.replace(anchor, block);
fs.writeFileSync(p, t);
console.log('index ok');

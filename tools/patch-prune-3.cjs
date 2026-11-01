const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/index.js';
let t = fs.readFileSync(p, 'utf8');

const anchor = `  ctx.tools.register({
    name: 'brain_restore',`;
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }

const tool = `  ctx.tools.register({
    name: 'brain_prune_conflicts',
    description:
      'Archive stale corrected facts so a single slot stops piling up old values. Groups by subject/relation and keeps the newest N per slot (default 1). Archived entries move to archive.json — nothing is erased. Use dryRun to preview the count first.',
    parameters: {
      type: 'object',
      properties: {
        keep: { type: 'integer', description: 'How many corrected versions to keep per subject/relation slot (0-20, default 1).' },
        subject: { type: 'string', description: 'Restrict to one subject of the fact triple.' },
        relation: { type: 'string', description: 'Restrict to one relation of the fact triple.' },
        dryRun: { type: 'boolean', description: 'Only report what would be archived; change nothing.' },
      },
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      try {
        await awaitReady();
        const report = memory.pruneConflicts({
          subject: typeof args.subject === 'string' && args.subject.trim() ? args.subject.trim() : null,
          relation: typeof args.relation === 'string' && args.relation.trim() ? args.relation.trim() : null,
          keep: Number.isFinite(args.keep) ? args.keep : 1,
          dryRun: Boolean(args.dryRun),
          sessionId: sessionIdOf(exec),
        });
        if (report.groups === 0) return { text: '没有可清理的废弃事实：语义库里没有被修正过的事实。' };
        const head = report.dryRun
          ? \`预演：\${report.groups} 个槽位，每个保留最近 \${report.keep} 条，将归档 \${report.removed} 条（未写入）\`
          : \`已归档 \${report.removed} 条废弃事实，涉及 \${report.groups} 个槽位，每个槽位保留最近 \${report.keep} 条；archive.json 里可查\`;
        const lines = report.byGroup
          .filter((g) => g.removed > 0)
          .slice(0, 10)
          .map((g) => \`- \${g.key}：保留 \${g.kept} 条，归档 \${g.removed} 条\`);
        return { text: [head, ...lines].join('\\n') };
      } catch (error) {
        return { text: errorText(error) };
      }
    },
  });

` + anchor;

t = t.replace(anchor, tool);
fs.writeFileSync(p, t);
console.log('tool ok');

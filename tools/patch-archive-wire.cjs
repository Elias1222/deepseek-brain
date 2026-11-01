const fs = require('fs');
const base = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain';

/* ── server routes ── */
{
  const p = base + '/lib/server.js';
  let t = fs.readFileSync(p, 'utf8');
  const anchor = "      if (method === 'POST' && route === '/api/conflicts/prune') {";
  if (!t.includes(anchor)) { console.error('MISS server anchor'); process.exit(1); }

  const routes = `      if (method === 'GET' && route === '/api/archive') {
        const layer = url.searchParams.get('layer') || null;
        const limit = url.searchParams.get('limit');
        const result = memory.archiveList({ query: url.searchParams.get('q') || '', layer, limit });
        return json(res, 200, { ok: true, ...result });
      }
      const arcMatch = /^\\/api\\/archive\\/([^/]+)\\/restore$/.exec(route);
      if (method === 'POST' && arcMatch) {
        const restored = memory.restoreArchived(decodeURIComponent(arcMatch[1]), Date.now(), sessionId);
        if (!restored) return fail(res, 404, 'not-found', 'no such archived memory');
        const it = restored.item;
        const title =
          restored.layer === 'episodic'
            ? it.event
            : restored.layer === 'procedural'
              ? it.rule
              : \`\${it.subject} → \${it.relation} → \${it.object}\`;
        return json(res, 200, { ok: true, layer: restored.layer, item: it, title });
      }
` + anchor;

  t = t.replace(anchor, routes);
  fs.writeFileSync(p, t);
  console.log('server ok');
}

/* ── tool ── */
{
  const p = base + '/lib/index.js';
  let t = fs.readFileSync(p, 'utf8');
  const anchor = '  ctx.tools.register(brainSnapshot);';
  if (!t.includes(anchor)) { console.error('MISS index anchor'); process.exit(1); }

  const tool = `const brainArchive = {
  name: 'brain_archive',
  description:
    '查看或取回「归档区」。不给 id 时按关键词列出被归档/遗忘/清理掉的记忆（含归档时间与原因）；给 id 时把那条取回原来的层，继续参与检索与衰减。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: '关键词（可选）。' },
      layer: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: '只看某一层（可选）。' },
      limit: { type: 'integer', description: '最多返回几条，1–200，默认 40。' },
      id: { type: 'string', description: '要取回的记忆 id；给了它就不再列出，而是执行取回。' },
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    render: (_args, value) => value.text,
  },
  async execute(args, exec) {
    const memory = await ready;
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
    if (!result.total) {
      return { text: '归档区是空的：没有遗忘、没有清理、也没有被手动归档的记忆。' };
    }
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
  },
};

` + anchor;

  t = t.replace(anchor, tool);
  t = t.replace(tool, tool + '\n  ctx.tools.register(brainArchive);');
  fs.writeFileSync(p, t);
  console.log('index ok');
}

const fs = require('fs');
const p = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain/lib/server.js';
let t = fs.readFileSync(p, 'utf8');

/* 1) GET /api/conflicts 附带分组 */
const oldGet = `      if (method === 'GET' && route === '/api/conflicts') {
        const items = memory.conflicts();
        return json(res, 200, { ok: true, total: items.length, items });
      }`;
if (!t.includes(oldGet)) { console.error('MISS get'); process.exit(1); }
const newGet = `      if (method === 'GET' && route === '/api/conflicts') {
        const items = memory.conflicts();
        const groups = memory.conflictGroups();
        return json(res, 200, {
          ok: true,
          total: items.length,
          items,
          groups,
          removable: groups.reduce((sum, g) => sum + g.removable, 0),
        });
      }`;
t = t.replace(oldGet, newGet);

/* 2) POST /api/conflicts/prune（必须排在 :id/restore 之前，避免被 :id 吃掉） */
const anchor = `      const restoreMatch = /^\\/api\\/conflicts\\/([^/]+)\\/restore$/.exec(route);`;
if (!t.includes(anchor)) { console.error('MISS anchor'); process.exit(1); }
const pruneRoute = `      if (method === 'POST' && route === '/api/conflicts/prune') {
        const body = (await readBody(req)) ?? {};
        if (body && typeof body !== 'object') return fail(res, 400, 'bad-payload', 'body must be an object');
        const report = memory.pruneConflicts({
          subject: body.subject ?? null,
          relation: body.relation ?? null,
          keep: body.keep ?? 1,
          dryRun: Boolean(body.dryRun),
        });
        return json(res, 200, { ok: true, ...report });
      }
` + anchor;
t = t.replace(anchor, pruneRoute);
fs.writeFileSync(p, t);
console.log('server ok');

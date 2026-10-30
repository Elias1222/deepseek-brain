import fs from 'node:fs';
import path from 'node:path';
import { VERSION } from './memory.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const BASE = '/deepseek-brain';

/**
 * Build the HTTP handler for the plugin's dashboard + JSON API.
 * The handler is mounted either on DSH's web server (prefix route) or on the
 * standalone `brain_dashboard` server. Both share this one implementation.
 */
export function createHandler({ memory, webRoot, base = BASE, version = VERSION }) {
  const staticCache = new Map();

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(body);
  }

  function json(res, status, data) {
    send(res, status, JSON.stringify(data, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  function fail(res, status, code, message) {
    json(res, status, { ok: false, error: { code, message } });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1_048_576) {
          reject(new Error('body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  function staticFile(res, rel) {
    const safe = path.normalize(rel).replace(/^([/\\])+/, '');
    if (safe.includes('..')) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    const root = path.resolve(webRoot);
    const file = path.resolve(root, safe);
    // Only the web root and its descendants are servable (a bare prefix check
    // would let a sibling directory like "<webRoot>-evil" through).
    if (file !== root && !file.startsWith(root + path.sep)) {
      return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    const cached = staticCache.get(file);
    const mtime = fs.statSync(file).mtimeMs;
    let buf;
    if (cached && cached.mtime === mtime) buf = cached.buf;
    else {
      buf = fs.readFileSync(file);
      if (buf.length < 2_000_000) staticCache.set(file, { mtime, buf });
    }
    send(res, 200, buf, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  }

  async function handle(req, res, prefix = base) {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let route = url.pathname;
    if (prefix && route.startsWith(prefix)) route = route.slice(prefix.length) || '/';
    const sessionId = url.searchParams.get('session') ?? 'default';
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && route === '/api/state') return json(res, 200, memory.apiState(sessionId));
      if (method === 'GET' && route === '/api/health') {
        const backups = memory.store.backups('episodic.json');
        return json(res, 200, {
          ok: true,
          version,
          dataDir: memory.config.dataDir,
          counts: memory.statsSnapshot(sessionId).layers,
          backups: { count: backups.length, newest: backups[0]?.name ?? null },
          vector: memory.vector.status(),
          warnings: memory.warnings,
        });
      }
      if (method === 'GET' && (route === '/api/export.json' || route === '/api/export')) {
        return send(res, 200, JSON.stringify(memory.exportJson(sessionId), null, 2), {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="deepseek-brain-export.json"',
        });
      }
      if (method === 'GET' && route === '/api/snapshot.md') {
        const md = memory.snapshotMarkdown(sessionId);
        memory.store.writeSnapshot('snapshot', md);
        return send(res, 200, md, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="deepseek-brain-memory.md"',
        });
      }
      if (method === 'POST' && route === '/api/remember') {
        const body = await readBody(req);
        const result = memory.remember(body);
        return json(res, 200, { ok: true, item: result.item, text: result.text, corrected: result.corrected ?? [] });
      }
      if (method === 'POST' && route === '/api/forget') {
        const body = await readBody(req);
        if (!body?.id) return fail(res, 400, 'missing-id', 'body.id is required');
        const result = memory.forget(String(body.id));
        if (!result) return fail(res, 404, 'not-found', `no memory with id ${body.id}`);
        return json(res, 200, { ok: true, archived: result.item.id, layer: result.layer });
      }
      if (method === 'POST' && route === '/api/sleep') {
        memory.decayPass();
        const result = memory.sleep(Date.now(), { minAgeHours: 0 });
        return json(res, 200, { ok: true, report: result.report, text: result.text });
      }
      if (method === 'POST' && route === '/api/decay') {
        const result = memory.decayPass();
        return json(res, 200, { ok: true, forgotten: result.forgotten ?? 0, ids: result.ids ?? [] });
      }
      if (method === 'POST' && route === '/api/working/push') {
        const body = await readBody(req);
        if (!body?.title) return fail(res, 400, 'missing-title', 'body.title is required');
        memory.session(sessionId).working.push(String(body.title));
        memory.persist();
        return json(res, 200, { ok: true, stack: memory.session(sessionId).working.stack });
      }
      if (method === 'GET' && (route === '/' || route === '/index.html' || route === '/dashboard.html')) {
        return staticFile(res, 'dashboard.html');
      }
      if (method === 'GET' && route === '/brain-3d.html') return staticFile(res, 'brain-3d.html');
      if (method === 'GET' && route.startsWith('/vendor/')) return staticFile(res, route.slice(1));
      return fail(res, 404, 'no-route', `no route for ${method} ${route}`);
    } catch (error) {
      return fail(res, 400, 'bad-request', error?.message ?? String(error));
    }
  }

  return { handle, base };
}

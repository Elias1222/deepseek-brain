# deepseek-brain — Front-end / Host API contract (v1)

All routes live under the plugin's base path **`/deepseek-brain`** on the DSH local web server
(`http://127.0.0.1:<port>/deepseek-brain/...`). When a page is opened from `file://` there is no host:
front-ends MUST fall back to their built-in demo dataset and show a "demo" badge.

- Static pages: `GET /deepseek-brain/` (dashboard), `/deepseek-brain/brain-3d.html`, `/deepseek-brain/vendor/*`.
- JSON API: `GET /deepseek-brain/api/state`, `/api/health`, `/api/export.json`, `/api/snapshot.md`,
  `POST /api/remember`, `/api/forget`, `/api/sleep`, `/api/decay`, `/api/working/push`.
- All responses are UTF-8 JSON with `ok: true|false`. Errors: `{ ok:false, error:{ code, message } }` + HTTP 4xx/5xx.
- CORS: `Access-Control-Allow-Origin: *` so a `file://` page may probe `http://127.0.0.1:<port>`.

## 1. Brain state

`GET /deepseek-brain/api/state`

```jsonc
{
  "ok": true,
  "generatedAt": "2026-02-11T08:30:00.000Z",
  "lambda": 0.05,                       // decay constant
  "stats": {
    "total": 34,                        // live memories across all layers
    "addedToday": 5,                    // created today (local day)
    "forgotten": 12,                    // decayed-out memories (cumulative)
    "consolidated": 3,                  // sleep-consolidation runs / migrated items
    "activeTopics": ["项目排期", "周末旅行"],
    "layers": { "sensory": 2, "working": 3, "episodic": 20, "semantic": 6, "procedural": 3 }
  },
  "sensory": [{
    "id": "sen_...",
    "ts": "2026-02-11T08:29:59.000Z",
    "text": "明天下午三点和张伟在望京开会",
    "entities": { "people": ["张伟"], "times": ["明天下午三点"], "numbers": ["三点"],
                  "places": ["望京"], "urls": [], "emotions": [] },
    "attended": true,
    "expiresAt": "2026-02-11T08:30:01.000Z"
  }],
  "working": { "capacity": 7, "stack": [{ "id": "wk_...", "title": "项目排期", "ts": "..." }] },
  "episodic": [{
    "id": "ep_...", "ts": "...", "event": "会议延期到周五",
    "participants": ["张伟"], "place": "望京", "emotion": "焦虑",
    "importance": 4,                  // 1..5
    "strength": 3.42,                 // 0..5, decayed: importance * exp(-lambda * days)
    "detail": "……", "source": "manual|auto|demo"
  }],
  "semantic": [{
    "id": "sem_...", "ts": "...", "subject": "用户", "relation": "职业", "object": "设计师",
    "status": "active",               // "active" | "corrected"
    "importance": 4, "strength": 3.9, "supersedes": null
  }],
  "procedural": [{ "id": "pro_...", "ts": "...", "rule": "回答保持简洁", "strength": 2.8, "hits": 4 }],
  "regions": {
    "sensory":    { "label": "感觉记忆", "count": 2,  "color": "#67e8f9" },
    "working":    { "label": "工作记忆", "count": 3,  "color": "#a78bfa" },
    "episodic":   { "label": "情景记忆", "count": 20, "color": "#f472b6" },
    "semantic":   { "label": "语义记忆", "count": 6,  "color": "#34d399" },
    "procedural": { "label": "程序记忆", "count": 3,  "color": "#fbbf24" }
  }
}
```

`POST /deepseek-brain/api/remember`

```jsonc
// episodic
{ "layer": "episodic", "event": "和张伟开会", "participants": ["张伟"], "place": "望京",
  "emotion": "紧张", "importance": 4, "detail": "讨论了排期" }
// semantic
{ "layer": "semantic", "subject": "用户", "relation": "职业", "object": "产品设计师", "importance": 4 }
// procedural
{ "layer": "procedural", "rule": "回答前先给结论", "importance": 3 }
```

Response: `{ "ok": true, "item": { …the created record… } }`

`POST /deepseek-brain/api/forget` — body `{ "id": "ep_..." }` → `{ "ok": true, "archived": "ep_..." }`
(hard delete is never exposed; records move to `archive.json`).

`POST /deepseek-brain/api/sleep` → `{ "ok": true, "report": { "migrated": 2, "compressed": 5, "pruned": 1 } }`

`POST /deepseek-brain/api/decay` → `{ "ok": true, "forgotten": 3, "ids": ["ep_..."] }` (runs one decay sweep now; archived, never hard-deleted).

`POST /deepseek-brain/api/working/push` — body `{ "title": "话题", "sessionId": "optional" }` →
`{ "ok": true, "stack": [{ "id": "wk_...", "title": "话题", "ts": "..." }] }` (lets a front-end steer the focus topic).

`GET /deepseek-brain/api/health` → `{ "ok": true, "version": "1.0.0", "dataDir": "...",
"counts": { "sensory": 0, "working": 0, "episodic": 0, "semantic": 0, "procedural": 0 },
"backups": { "count": 7, "newest": "..." }, "vector": { "enabled": false, "provider": "hash", "dim": 256, "indexed": 0, "warning": null },
"warnings": [] }` — the debugging entry point: initialisation failures and vector-provider fallbacks land in `warnings`.

`GET /deepseek-brain/api/export.json` → `{ "version": "1.0.0", "exportedAt": "...", "episodic": [...],
"semantic": [...], "procedural": [...], "stats": {...} }`
`GET /deepseek-brain/api/snapshot.md` → `text/markdown` human-readable memory archive.

## 2. Region → anatomy mapping (3-D app)

| region key | 中文 | anatomy | hex |
|---|---|---|---|
| `sensory` | 感觉记忆 | 皮层前端 / 前中央回区 | `#67e8f9` |
| `working` | 工作记忆 | 前额叶 | `#a78bfa` |
| `episodic` | 情景记忆 | 海马体（颞叶深部） | `#f472b6` |
| `semantic` | 语义记忆 | 颞叶外侧皮层 | `#34d399` |
| `procedural` | 程序记忆 | 基底节（深部中心） | `#fbbf24` |

## 3. Demo dataset rules (shared by both front-ends)

When `api/state` is unreachable, both front-ends synthesize the SAME 20 demo memories
(12 episodic, 4 semantic, 2 procedural, 2 sensory) with realistic Chinese content, ids `demo-ep-1`…
`demo-sen-2`, `source: "demo"`, timestamps spread over the last 14 days, importance 1–5.
Demo mode must be toggleable at runtime; while on, add/delete only mutate the in-memory demo model.

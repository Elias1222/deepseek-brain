# deepseek-brain — Front-end / Host API contract (v2)

All routes live under the plugin's base path **`/deepseek-brain`** on the DSH local web server
(`http://127.0.0.1:<port>/deepseek-brain/...`). Opened from `file://` there is no host: front-ends
MUST fall back to their built-in demo dataset and show a demo badge.

- Static: `GET /deepseek-brain/` (dashboard), `/deepseek-brain/brain-3d.html`, `/deepseek-brain/vendor/*`.
- JSON: `GET /api/state[?at=]`, `/api/activity[?since=]`, `/api/health`, `/api/export.json`, `/api/snapshot.md`;
  `POST /api/recall`, `/api/remember`, `/api/forget`, `/api/sleep`, `/api/decay`, `/api/working/push`.
- Every response is UTF-8 JSON with `ok: true|false`; errors are `{ ok:false, error:{ code, message } }` with 4xx/5xx.
- CORS `Access-Control-Allow-Origin: *`, `OPTIONS` → `204`, so a `file://` page may probe the host.

## 1. Brain state — `GET /api/state?at=<when>`

`at` is the **time-travel dial**. Accepted forms: nothing (= now), epoch ms (`1790000000000`),
ISO (`2026-10-30T12:00:00.000Z`), relative `-3d` / `-12h` / `-30m` (into the past) and `+30d` / `+6h`
(into the future). Unparsable values fall back to now. The server recomputes every `strength` at that
instant with the same `importance * exp(-lambda * days)` used by recall, so scrubbing the dial is a
real simulation, not a client-side animation.

```jsonc
{
  "ok": true,
  "generatedAt": "2026-10-30T12:00:00.000Z",
  "at": 1790000000000,                  // instant the state was computed for
  "sessionId": "default",               // which DSH session's brain is being observed
  "lambda": 0.05,
  "forgetThreshold": 0.5,               // strength below this is forgotten (unless pinned)
  "pinnedImportance": 4,                // importance ≥ 4 never decays away
  "stats": {
    "total": 34, "addedToday": 5, "forgotten": 12, "consolidated": 3,
    "activeTopics": ["项目排期", "周末旅行"],
    "layers": { "sensory": 2, "working": 3, "episodic": 20, "semantic": 6, "procedural": 3 }
  },
  "sensory": [{
    "id": "sen_...", "ts": "...", "text": "明天下午三点和张伟在望京开会",
    "entities": { "people": ["张伟"], "times": ["明天下午三点"], "numbers": ["三点"],
                  "places": ["望京"], "urls": [], "emotions": [] },
    "attended": true, "expiresAt": "...", "ageDays": 0.00002, "salience": 0.91
  }],
  "working": { "capacity": 7, "stack": [{ "id": "wk_...", "title": "项目排期", "ts": "..." }] },
  "episodic": [{
    "id": "ep_...", "ts": "...", "event": "会议延期到周五",
    "participants": ["张伟"], "place": "望京", "emotion": "焦虑",
    "importance": 4, "strength": 3.42,          // at `at`
    "detail": "……", "source": "manual|auto|demo|consolidated",
    "hits": 2, "consolidated": false, "tags": [],
    "ageDays": 7.2, "salience": 0.684,          // derived, never persisted
    "pinned": false,                            // importance >= pinnedImportance
    "forgetInDays": 6.66                        // null when pinned; else real forecast
  }],
  "semantic": [{
    "id": "sem_...", "ts": "...", "subject": "用户", "relation": "职业", "object": "设计师",
    "status": "active|corrected", "importance": 4, "supersedes": null,
    "hits": 3, "ageDays": 12.5, "salience": 0.79
  }],
  "procedural": [{ "id": "pro_...", "ts": "...", "rule": "回答保持简洁",
                   "strength": 2.8, "hits": 4, "ageDays": 3.1, "salience": 0.72 }],
  "regions": {
    "sensory":    { "label": "感觉记忆", "count": 2,  "color": "#67e8f9" },
    "working":    { "label": "工作记忆", "count": 3,  "color": "#a78bfa" },
    "episodic":   { "label": "情景记忆", "count": 20, "color": "#f472b6" },
    "semantic":   { "label": "语义记忆", "count": 6,  "color": "#34d399" },
    "procedural": { "label": "程序记忆", "count": 3,  "color": "#fbbf24" }
  },
  "activitySeq": 128,                   // last activity sequence number
  "lastEvent": { "seq": 128, "ts": 1790000000000, "kind": "recall", "…": "…" }
}
```

`salience` is the single 0..1 knob a renderer needs:

| layer | salience formula |
|---|---|
| sensory | `1 - ageMs / sensoryTtlMs` |
| episodic | `strength / 5` |
| semantic | `0.30 + 0.45*min(1, hits/4) + 0.25*(importance/5)` |
| procedural | `0.35 + 0.45*min(1, strength/5) + 0.20*min(1, hits/4)` |

`forgetInDays` solves `importance * exp(-lambda * t) = forgetThreshold` for `t` and subtracts the
record's age, so a renderer can label "还剩 3.9 天" without re-deriving the physics. It is `null` for
pinned memories (`importance >= pinnedImportance`).

## 2. Recall — `POST /api/recall`

```jsonc
// request
{ "query": "张伟 会议 排期", "topK": 6, "layers": ["episodic", "semantic"] }   // topK/layers optional
// response
{
  "ok": true, "query": "张伟 会议 排期", "tookMs": 3,
  "hits": [{
    "layer": "episodic", "id": "ep_...", "ts": "...", "title": "和张伟在望京开会",
    "detail": "……", "score": 0.644, "strength": 2.1,
    "parts": { "keyword": 0.47, "importance": 0.8, "freshness": 0.93, "vector": 0 }
  }],
  "text": "检索到 3 条相关记忆……",     // human-readable log line
  "vector": { "enabled": false, "provider": "hash", "dim": 256, "indexed": 18 }
}
```

Empty/blank `query` → `400 { code: "missing-query" }`. Every recall also appends a `recall` activity
event, so a renderer can animate exactly what the agent just retrieved.

## 3. Activity log — `GET /api/activity?since=<seq>&limit=<n>`

The brain's electrophysiology. In-memory ring buffer (default 240 events), monotonic `seq`.
`since=<seq>` returns only newer events — poll every 500–1500 ms for live visualisation.

```jsonc
{ "ok": true, "seq": 128, "events": [ { "seq": 121, "ts": 1790000000000, "kind": "observe", … } ] }
```

| kind | payload | meaning on screen |
|---|---|---|
| `observe` | `sessionId, topic, text, entities{people,places,emotions}, kept{id,layer,importance}\|null, shelved[], dropped, focus` | input strikes the sensory strip, then moves to PFC |
| `recall` | `sessionId, query, hits[{id,layer,score,title,strength,parts}], took` | activation sweeps from the sensory strip through the PFC to the targets |
| `remember` | `sessionId, layer, id, importance, title` | a new engram condenses in its region |
| `edit` | `sessionId, layer, id, title, fields[]` | the engram re-condenses: its spines / size change in place |
| `correct` | `sessionId, layer, id, replacedBy, title`（回滚时 `restored:true, replaced`） | the old engram splits off as a ghost, `[已修正]` |
| `forget` | `sessionId, layer, id, title` | the engram dissolves toward the archive ring |
| `consolidate` | `migrated, compressed, pruned, digests, before, after` | engrams migrate hippocampus → temporal cortex during the night |
| `decay` | `sessionId, count, ids[]` | weak engrams fade out in sequence |
| `import` | `sessionId, episodic, semantic, procedural, skipped` | a batch of engrams arrives from another brain (`imported` tag) |

## 4. Write / edit / forget / consolidate

```jsonc
POST /api/remember
{ "layer": "episodic", "event": "和张伟开会", "participants": ["张伟"], "place": "望京",
  "emotion": "紧张", "importance": 4, "detail": "讨论了排期" }
{ "layer": "semantic", "subject": "用户", "relation": "职业", "object": "产品设计师", "importance": 4 }
{ "layer": "procedural", "rule": "回答前先给结论", "importance": 3 }
// → { "ok": true, "item": { …created record… }, "text": "已写入情景记忆：…", "corrected": [] }
```

`PATCH /api/memories/:id`（也接受 POST）— 就地修订一条记忆，不新建也不删除：

```jsonc
PATCH /api/memories/ep_abc
{ "importance": 5, "place": "三里屯", "detail": "改到周五", "event": "…", "emotion": "…", "participants": ["…"] }
// → { "ok": true, "layer": "episodic", "item": { … }, "changed": ["importance","place","detail"], "corrected": [] }
```

- `importance` 会被夹到 1–5；`importance ≥ 4` 的条目立刻进入「永不遗忘」。
- 语义三元组改 `object` 时**不会就地覆盖**：新值走一次冲突检测，旧值变成 `status:"corrected"`，响应里 `corrected` 列出被顶替的那条。
- 404 `not-found`；没有任何可改字段时 `changed: []`。

`GET /api/memories/:id` — 版本链。`v1` 是入库时的样子，之后每次编辑压一版，最后一版 `current: true`：

```jsonc
{ "ok": true, "layer": "episodic", "id": "ep_abc", "title": "和张伟在望京开会，讨论排期",
  "versions": [
    { "v": 1, "ts": "2026-10-29T07:07:00.000Z", "current": false, "status": "past",
      "fields": { "event": "…", "detail": "", "place": "望京", "emotion": "紧张",
                  "participants": ["张伟"], "importance": 2 },
      "changed": ["place", "importance"] },
    { "v": 2, "ts": "2026-10-31T06:12:00.000Z", "current": true, "status": "current",
      "fields": { "…": "…" }, "changed": [] }
  ] }
```

- 只存**可编辑字段**（`event/detail/place/emotion/participants/importance`、`rule/strength`、`object`），派生量（`strength`、`salience`、`forgetInDays`）永不入档。
- 每条最多保留 20 个历史版本；语义事实的版本链是同一 `(subject, relation)` 槽位下的所有记录，`status` 为 `active | corrected`，回滚用 `/api/conflicts/:id/restore`。
- 「恢复某一版」不是特殊端点：对情景/程序记忆再发一次 `PATCH` 带上那一版的字段即可（会再压一版，历史不被覆盖）；语义事实走 `restore`。
- 404 `not-found`。

`GET /api/conflicts` — 所有被修正过的事实与它们的当前值：

```jsonc
{ "ok": true, "total": 1, "items": [
  { "id": "sem_old", "subject": "用户", "relation": "职业", "object": "设计师",
    "correctedAt": "2026-10-31T…", "current": { "id": "sem_new", "object": "产品设计师", "ts": "…", "importance": 5 } } ] }
```

`POST /api/conflicts/:id/restore` — 回滚：旧值重新生效，当前值转为 `[已修正]`，两条都留着。
→ `{ "ok": true, "restored": { "id", "subject", "relation", "object" }, "replaced": { "id", "object" } | null }`

`POST /api/import` — 把另一台设备导出的档案（`/api/export.json` 的同一形状）并进来；只做加法，
同 id / 同三元组 / 同规则 / 同事件原文的一律跳过，不覆盖本地。

```jsonc
{ "episodic": { "items": [ … ] }, "semantic": { "items": [ … ] }, "procedural": { "items": [ … ] } }
// → { "ok": true, "episodic": 1, "semantic": 1, "procedural": 0, "skipped": 3, "total": 2 }
```

`POST /api/forget` — `{ "id": "ep_..." }` → `{ "ok": true, "archived": "ep_...", "layer": "episodic" }`;
404 `not-found` otherwise. Hard delete is never exposed: records move to `archive.json`.

`POST /api/sleep` → `{ "ok": true, "report": { "migrated": 2, "compressed": 5, "pruned": 1, "digests": 1 }, "text": "…" }`
`POST /api/decay` → `{ "ok": true, "forgotten": 3, "ids": ["ep_..."] }`
`POST /api/working/push` — `{ "title": "话题" }` → `{ "ok": true, "stack": [{ "id": "wk_...", "title": "…", "ts": "…" }] }`

## 5. Debug / transfer

`GET /api/health` → `{ ok, version, dataDir, counts, backups:{count,newest}, vector:{enabled,provider,dim,indexed,warning}, warnings }`
`GET /api/export.json` → full JSON archive · `GET /api/snapshot.md` → portable Markdown memory档案.

## 6. Region → anatomy mapping

| region key | 中文 | anatomy | colour | 3-D anchor (x,y,z) |
|---|---|---|---|---|
| `sensory` | 感觉记忆 | 皮层前端 / 前中央回区 | `#67e8f9` | `(-0.42, 0.86, 1.12)` |
| `working` | 工作记忆 | 前额叶 | `#a78bfa` | `(0.48, 0.34, 1.60)` |
| `episodic` | 情景记忆 | 海马体（颞叶深部） | `#f472b6` | `(-0.88, -0.30, 0.14)` |
| `semantic` | 语义记忆 | 颞叶外侧皮层 | `#34d399` | `(1.14, -0.40, 0.06)` |
| `procedural` | 程序记忆 | 基底节（深部中心） | `#fbbf24` | `(-0.30, -0.12, -0.28)` |

## 7. Deterministic engram addressing (shared rule)

Every memory must occupy the **same place every session**, otherwise the model is decorative. Both
front-ends derive the slot from the record id with the same rule:

```js
function hash32(str) {                    // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const u = hash32(id + ':u') / 2 ** 32;    // 0..1
const v = hash32(id + ':v') / 2 ** 32;
const r = 0.86 * Math.sqrt(u);            // uniform disc, 0..1
const theta = 2 * Math.PI * v;            // radians
// local slot = (r*cos(theta), r*sin(theta)); map onto the region's tangent plane
```

Region radii (in brain units): `sensory 0.34`, `working 0.30`, `episodic 0.26`, `semantic 0.38`, `procedural 0.22`.

## 8. Demo dataset rules

When `api/state` is unreachable, both front-ends synthesize the SAME 20 demo memories
(12 episodic, 4 semantic, 2 procedural, 2 sensory), ids `demo-ep-1` … `demo-sen-2`, `source: "demo"`,
timestamps spread over the last 14 days, importance 1–5. Same ids ⇒ same slots ⇒ same picture.
Demo mode is toggleable at runtime; while on, add/delete only mutate the in-memory demo model.

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

### `GET /api/export.json` 的 `activity` 段

```jsonc
"activity": {
  "boot": "zstbzr",        // 进程世代
  "generation": 7,          // 第几次启动（stats.boot.count）
  "since": "2026-11-01T…",  // 本次启动时间
  "seq": 12,                // 事件总数
  "events": [ { "seq": 3, "at": "…", "kind": "recall", "detail": "「张伟 会议」 · 2 命中 · 9 ms" } ]
}
```

这是一段**只读上下文**：说明这个大脑最近在查什么，不参与 `POST /api/import` 的合并（导入只认 `episodic / semantic / procedural`）。Markdown 快照末尾也有同样内容，渲染成一张表。

### 只读模式

当数据目录被另一个活进程锁住（`brain.lock` 里的 pid 仍在），本实例以只读启动：

- `GET /api/health` → `{ ok:true, readOnly:true, lock:{ pid, at, host } }`；
- 任何非 GET 请求（remember / forget / sleep / decay / recall… 的写路径）→ `503 { ok:false, error:{ code:"read-only", message:"data dir is locked by pid N — this instance is read-only" } }`；
- 读接口照常返回数据，方便对照；
- 只读不是永久状态：后台每 `handoverMs` 试一次锁，前任退出后自动升级为可写（`/api/health` 的 `readOnly` 会变回 `false`）。

### 活动流的落盘与跨实例对齐

- 持锁进程把每条活动事件追加到数据目录下的 `activity.jsonl`（JSON Lines，最多 400 行，超出后重写保留尾部）。
- 只读实例不写这个文件；它在 `init()` 时把文件读进内存（`ActivityLog.hydrate`），并在每次 `GET /api/activity` 之前调用 `syncActivityFromDisk()` 追平，所以两个实例返回的 `seq`、`boot`、检索史一致。
- 只读实例不改写 `stats.json` 里的 `boot`（那是持锁进程的世代），接管之后才重新 `stampBoot()` 并接上落盘钩子 `attachTail`。
- `GET /api/events` 在只读实例上也会推送持有者的事件：每条连接每秒 `syncActivityFromDisk()` 一次，新增事件经 `ActivityLog.ingest()` 直接喂给该连接的订阅者（实测端到端 1–2 s）。

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

`POST /api/conflicts/prune` — 清理同一个槽位里堆着的旧值：每个槽位保留最近 `keep` 条（默认 1），
其余从语义库摘出、写入 `archive.json`（`reason: "superseded"`），**永不物理删除**。

```jsonc
{ "subject": "用户", "relation": "职业", "keep": 1, "dryRun": false }   // subject/relation 省略即全库
// → { "ok": true, "keep": 1, "dryRun": false, "removed": 1, "ids": ["sem_old"],
//     "groups": 1, "byGroup": [{ "key": "用户 → 职业", "kept": 1, "removed": 1 }] }
```

`GET /api/conflicts` 的响应同时带聚合视图，前端据此渲染「废弃事实」面板：

```jsonc
{ "ok": true, "total": 2, "removable": 1, "items": [ … ],
  "groups": [ { "key": "用户 → 职业", "subject": "用户", "relation": "职业",
                "current": { "id": "sem_new", "object": "产品设计师", "ts": "…" },
                "corrected": [ { "id": "sem_old", "object": "设计师", "ts": "…", "importance": 4 } ],
                "removable": 1 } ] }
```

`GET /api/archive?q=&layer=&limit=` — 归档区：`archive.json` 里的条目与「状态为 archived 的语义事实」合并视图。

```jsonc
{ "ok": true, "total": 2,
  "byLayer": { "episodic": 1, "semantic": 0, "procedural": 1 },
  "items": [ { "id": "ep_...", "layer": "episodic", "title": "季度评审改到周四上午",
               "body": "", "importance": 3, "ts": "…", "archivedAt": "…",
               "reason": "manual", "source": "archive.json", "score": 0 } ] }
```

`reason` 三态：`manual`（手动归档 / 遗忘）、`superseded`（被新说法取代后清理）、`decay`（衰减扫除）。

`POST /api/archive/:id/restore` — 取回一条。情景与程序回到各自层；
语义事实若槽位已有生效值，会回到「已修正」的位置（`supersededBy` 指向当前生效值），不会抢走生效位。

```jsonc
// → { "ok": true, "layer": "episodic", "item": { … }, "title": "季度评审改到周四上午" }
// 找不到 → 404 { "ok": false, "error": { "code": "not-found" } }
```

`POST /api/archive/restore` — 批量取回，body `{ "ids": ["ep_...", "pro_..."] }`。
空数组 → 400 `missing-ids`；缺失的 id 不算错误，集中在 `missing` 里回报。

```jsonc
// → { "ok": true,
//     "restored": [ { "id": "ep_...", "layer": "episodic", "title": "季度评审改到周四上午" } ],
//     "missing":  [ "ep_gone" ] }
```

`POST /api/archive/:id/undo` — 撤销刚才的取回：重新写回 `archive.json`（`reason: "undo"`）。
语义事实撤销后回到 `status: "archived"`，不碰同槽位的生效值；找不到 → 404 `not-found`。

```jsonc
// → { "ok": true, "layer": "episodic", "title": "季度评审改到周四上午" }
```

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

### GET /api/events?since=

Server-Sent Events 版的活动流。返回 `text/event-stream`；服务端订阅 `ActivityLog`，写记忆的动作一落地就推一帧（40 ms 合批，实测端到端约 80 ms）：

```
event: activity
data: {"seq":12,"events":[{ "seq":12, "kind":"remember", "title":"…", … }]}
```

- `since` 沿用 `/api/activity` 的序号语义；断线重连时带上最后一次的 `seq` 即可，不会重复也不会漏。
- 无新事件时每 15 s 发一个 `: ping` 注释帧保活；客户端关闭时服务端自动退订并清掉定时器。
- 密集写入时服务端按 40 ms 合批，一帧可带多条事件；前端对超出动画预算的部分只更新数字（500 ms / 6 段）。
- 前端应优先用它，拿不到 `EventSource` 时退回 1 秒一次的 `/api/activity` 轮询。

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

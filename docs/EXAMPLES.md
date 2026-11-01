# 三个使用示例（对话内 / HTTP / Node 三种入口）

示例假设仪表盘已启动：`http://127.0.0.1:7799/deepseek-brain/`（端口随会话变化，以 `brain_dashboard` 返回为准）。
Windows 用 `Invoke-RestMethod`，macOS / Linux 用 `curl`，两者等价。

---

## 示例一：记住一件事

**对话内**：用户说「记一下：周五下午三点和张伟在望京开会，很重要」。

```json
{ "name": "brain_remember", "arguments": {
  "layer": "episodic",
  "event": "和张伟在望京开会，讨论排期",
  "participants": ["张伟"],
  "place": "望京",
  "emotion": "中性",
  "importance": 5
} }
```

**HTTP**

```bash
curl -s -X POST http://127.0.0.1:7799/deepseek-brain/api/remember \
  -H 'content-type: application/json' \
  -d '{"layer":"episodic","event":"和张伟在望京开会，讨论排期","participants":["张伟"],"place":"望京","importance":5}'
```

```powershell
# Windows PowerShell 默认按 ANSI 发送 body，中文会变成 "??"，必须自己转 UTF-8 字节
$body = @{
  layer = 'episodic'
  event = '和张伟在望京开会，讨论排期'
  participants = @('张伟')
  place = '望京'
  importance = 5
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post http://127.0.0.1:7799/deepseek-brain/api/remember `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

**写入语义记忆**（同一件事里的稳定事实）：

```bash
curl -s -X POST http://127.0.0.1:7799/deepseek-brain/api/remember \
  -H 'content-type: application/json' \
  -d '{"layer":"semantic","subject":"张伟","relation":"身份","object":"同事 / 项目经理","importance":4}'
```

同一 `subject + relation` 再写一条不同 `object` 时，旧事实不会被删除，而是变成 `status: "corrected"` 并保留 `supersededBy`：

```bash
curl -s -X POST http://127.0.0.1:7799/deepseek-brain/api/remember \
  -H 'content-type: application/json' \
  -d '{"layer":"semantic","subject":"张伟","relation":"身份","object":"合伙人","importance":4}'
# -> {"ok":true,...,"corrected":"<旧 id>"}
```

**写程序记忆**（行为默认值，会进 system prompt）：

```bash
curl -s -X POST http://127.0.0.1:7799/deepseek-brain/api/remember \
  -H 'content-type: application/json' \
  -d '{"layer":"procedural","rule":"回答先给结论，再给理由"}'
```

---

## 示例二：回忆一件事

**对话内**：

```json
{ "name": "brain_recall", "arguments": { "query": "张伟 会议 排期", "topK": 5 } }
```

**HTTP**

```bash
curl -s 'http://127.0.0.1:7799/deepseek-brain/api/state' > /tmp/state.json   # 只想看数据
```

检索本身走工具（`brain_recall`），HTTP 侧等价入口是进程内调用：

```bash
node -e "
import('./lib/memory.js').then(async ({ MemorySystem }) => {
  const os = await import('node:os');
  const m = await new MemorySystem({ dataDir: os.homedir() + '/.deepseek-brain' }).init();
  const r = m.recall('张伟 会议 排期', { topK: 5 });
  for (const h of r.hits) console.log(h.layer, h.score.toFixed(3), h.title, JSON.stringify(h.parts));
});"
```

输出形如：

```
semantic 0.644 张伟 → 身份 → 同事 / 项目经理 {"keyword":1,"importance":0.8,"freshness":1,"vector":0}
episodic 0.431 和张伟在望京开会，讨论排期 {"keyword":0.47,"importance":1,"freshness":1,"vector":0}
episodic 0.326 和房东确认下季度房租 {"keyword":0,"importance":0.8,"freshness":0.62,"vector":0}
```

`parts` 就是「为什么它被想起来」：关键词命中、重要度、新鲜度、向量相似度四个分量，权重写在 `lib/retrieval.js`。

---

## 示例三：查看大脑可视化

**对话内**（ASCII 脑图 + 健康面板）：

```json
{ "name": "brain_visualize", "arguments": {} }
```

**Web 仪表盘**

```json
{ "name": "brain_dashboard", "arguments": {} }
```

返回两个 URL：

```
http://127.0.0.1:7799/deepseek-brain/dashboard.html    # 概览 / 时间线 / 知识图谱 / 衰减热力图
http://127.0.0.1:7799/deepseek-brain/brain-3d.html     # 3D 记忆大脑
```

**快照（跨会话 / 跨设备移植）**

```bash
curl -s http://127.0.0.1:7799/deepseek-brain/api/snapshot.md > brain-archive.md
```

**整库 JSON**

```bash
curl -s http://127.0.0.1:7799/deepseek-brain/api/export.json > brain-export.json
```

**手动触发睡眠巩固 / 衰减扫描**

```bash
curl -s -X POST http://127.0.0.1:7799/deepseek-brain/api/sleep -H 'content-type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:7799/deepseek-brain/api/decay -H 'content-type: application/json' -d '{"lambda":0.08}'
```

---

## 示例四：观察大脑正在想什么（v2 新增）

这三个端点是「仪器化」的地基：界面上看到的每一缕光、每一个数字都来自它们，而不是前端编造的动画。

**① 时间旅行：三天前的我还记得什么？**

```bash
curl -s 'http://127.0.0.1:7799/deepseek-brain/api/state?at=-3d' | jq '{at, episodic: [.episodic[] | {event, strength, forgetInDays}]}'
curl -s 'http://127.0.0.1:7799/deepseek-brain/api/state?at=%2B30d' | jq '[.episodic[] | {event, salience}]'
```

`-3d` 回看、`+30d` 预演，服务端用同一套 `importance × exp(-λ·天数)` 重算强度，并给出 `forgetInDays`
（「还剩几天跌破阈值」，`importance ≥ 4` 的条目是 `null` —— 它们永不忘）。

**② 真实检索：调用一次，看分数怎么来的**

```bash
curl -s -X POST http://127.0.0.1:7799/deepseek-brain/api/recall \
  -H 'content-type: application/json' \
  -d '{"query":"张伟 会议 排期","topK":5}'
```

返回的 `hits[].parts` 就是「为什么它被想起来」。3D 大脑里的激活脉冲按 `score` 决定强度与分叉数。

**③ 活动流：Agent 每一刻对记忆做了什么**

```bash
curl -s 'http://127.0.0.1:7799/deepseek-brain/api/activity?since=0' | jq '.events[] | {seq, kind, query, hits}'
```

9 种事件：`observe`（用户输入过感觉缓冲）、`recall`（检索）、`remember`（写入）、`edit`（就地修订）、
`correct`（冲突修正 / 回滚）、`forget`（软删除）、`consolidate`（睡眠巩固迁移）、`decay`（衰减清理）、
`import`（并入外部档案）。轮询 `?since=<上一批的 seq>` 即可增量取。

> 小技巧：把 `api/state`、`api/activity` 接进你自己的脚本，就能在终端里复刻 3D 观测仪的读数；
> 两个前端做的是同一件事，只是把它们画了出来。

---

## 示例五：改一条旧记忆，再把被顶替的说法放回去

记忆不是只能读。改与回滚都走「留历史」的路径：旧的不会被物理删除，只会变成 `[已修正]`。

```bash
# 1) 把某条情景记忆的重要度从 2 提到 5（≥4 即进入「永不遗忘」）
curl -s -X PATCH 'http://127.0.0.1:7799/deepseek-brain/api/memories/ep_abc123' \
  -H 'content-type: application/json' \
  -d '{"importance":5,"place":"三里屯","detail":"改到周五下午"}'
# → {"ok":true,"layer":"episodic","item":{…},"changed":["importance","place","detail"],"corrected":[]}

# 2) 语义事实说错了一次：新说法写入时旧说法自动降级
curl -s -X POST 'http://127.0.0.1:7799/deepseek-brain/api/remember' -H 'content-type: application/json' \
  -d '{"layer":"semantic","subject":"用户","relation":"职业","object":"设计师"}'
curl -s -X POST 'http://127.0.0.1:7799/deepseek-brain/api/remember' -H 'content-type: application/json' \
  -d '{"layer":"semantic","subject":"用户","relation":"职业","object":"产品设计师"}'

# 3) 看现在哪条在生效、哪条被修正过
curl -s 'http://127.0.0.1:7799/deepseek-brain/api/conflicts' | jq '.items[] | {object, current}'

# 3b) 看一条记忆的版本链：v1 是入库时那句话，之后每改一次就压一版
curl -s 'http://127.0.0.1:7799/deepseek-brain/api/memories/ep_abc123' | jq '.versions[] | {v, current, fields}'

# 4) 发现新说法才是错的：把旧的放回生效位（新的降级为 [已修正]，两条都留着）
curl -s -X POST 'http://127.0.0.1:7799/deepseek-brain/api/conflicts/sem_old123/restore'

# 5) 换一台机器：把另一份 export 并进来，只做加法，重复的跳过
curl -s -X POST 'http://127.0.0.1:7799/deepseek-brain/api/import' \
  -H 'content-type: application/json' --data-binary @other-brain-export.json
# → {"ok":true,"episodic":12,"semantic":4,"procedural":2,"skipped":3,"total":18}
```

在 3D 目镜里这是两个按钮：`重要度 −` / `重要度 +`（走同一条 `PATCH`）。改完 engram 的棘丝长度与亮度立刻变化，
左栏的「永不遗忘 / 遗忘预报」计数同步跳动。


---

## 一次完整的 20 天剧本

`node tools/demo.mjs --fresh` 之后跑下面这段，能看到「记住 → 衰减 → 巩固 → 遗忘」的完整闭环：

```bash
node -e "
import('./lib/memory.js').then(async ({ MemorySystem }) => {
  const os = await import('node:os');
  const m = await new MemorySystem({ dataDir: os.tmpdir() + '/brain-20d', lambda: 0.08, demoSeed: true }).init();
  console.log(m.visualize());
  console.log(JSON.stringify(m.decayPass()));
  console.log(JSON.stringify(m.sleep()));
  console.log(m.visualize());
});"
```

# deepseek-brain 1.0 · 发布说明

> 给 DSH 装一颗持久、可查、可操作的生物大脑；再用同一份数据，把它做成一台能观测的仪器。

## 一、这是什么

两个东西共用一份数据：

1. **插件本体**：`dsh plugin add` 之后，DeepSeek 在回答前会先 `brain_recall`，遇姓名/日期/承诺/偏好自动 `brain_remember`，冲突标 `[已修正]`、永不物理删除，`importance ≥ 4` 永不遗忘。数据写在 `~/.deepseek-brain/`。
2. **两台前端**：3D 观测仪（`brain-3d.html` / `dist/deepseek-brain-3d.html`）与 2D 观测仪（`dashboard.html`），读同一组 `/deepseek-brain/api/*`。

## 二、装

```bash
dsh plugin --profile web add github:<you>/deepseek-brain
# 本机自测：dsh plugin --profile brain-selftest add <repo 绝对路径>
# 看是否生效：dsh --profile brain-selftest --dump-config | grep deepseek-brain
```

只想起个本地服务看页面：

```bash
node tools/serve.mjs --port 7801 --demo     # 数据落在 ~/.deepseek-brain
# http://127.0.0.1:7801/deepseek-brain/dashboard.html
# http://127.0.0.1:7801/deepseek-brain/brain-3d.html
```

单文件离线版：`dist/deepseek-brain-3d.html`（three 内联，双击即开，自带 20 条演示记忆）。

## 三、能力矩阵

### 记忆（五层 + 生命周期）

| 能力 | 入口 |
| --- | --- |
| 写入 / 检索 / 可视化 / 遗忘 / 巩固 / 快照 | `brain_remember` `brain_recall` `brain_visualize` `brain_forget` `brain_sleep` `brain_snapshot` |
| 就地修订（不删不改历史） | `brain_update`，每次留一版 `v1…vN`（上限 20 版） |
| 版本链读取 | `brain_history`、`GET /api/memories/:id` |
| 语义冲突查看 / 回滚 | `brain_conflicts` `brain_restore`、`GET /api/conflicts`、`POST /api/conflicts/:id/restore` |
| 废弃事实清理（软归档） | `brain_prune_conflicts`、`POST /api/conflicts/prune` |
| 归档区检索 / 批量取回 / 撤销 | `brain_archive`、`GET /api/archive`、`POST /api/archive/restore`、`POST /api/archive/:id/undo` |
| 跨设备合并 / 空白重建 | `brain_import`、`brain_reset`（清空前自动写 `snapshots/pre-reset-*.md`） |

### 观测（两台仪器）

- **3D**：engram 形态学（重要度→尺寸、salience→亮度、三元组→晶格）、FNV-1a 确定性槽位、目镜、时间切片（`?at=`）、检索聚焦与分治、检索史 + 节奏条 + 时间轴、查询关联图、话题热度、归档环五段扇区、取回/清空动画、剖面、只读横幅、SSE 实时。
- **2D**：概览（脑区度数/示波器/读数板）、编年史（强度预报/两步归档/修订抽屉）、纤维追踪（力导向图 + 实体档案 + 废弃事实面板）、衰减实验（时间转盘/曲线族/遗忘预报）。

### 运行期保障

- 数据目录 `brain.lock`（pid + 时间戳 + host）：同进程可重入，死进程锁可回收，第二个实例 `readOnly` 并在 `handoverMs` 后自动接管。
- 只读实例：写请求 503 `read-only`、顶栏常驻横幅、SSE 仍推持有者事件（`ActivityLog.ingest`）。
- 写入原子（tmp + rename）、备份轮转 7 份、快照 Markdown。

## 四、验证过的数字

| 项 | 值 |
| --- | --- |
| 测试 | `node --test test/` → **110 pass / 0 fail** |
| 单文件构建 | `dist/deepseek-brain-3d.html` ≈ 872 KB |
| 真实检索 | `张伟 会议 排期` → 3 命中、top 0.624、took 约 30–46 ms |
| 遗忘预报 | importance 1 → 13.86 天；`?at=+10d` → 3.86 天；≥4 → `null` |
| 事件时延 | SSE 端到端实测 ~80 ms |
| 首屏 | `DOMContentLoaded` ≈ 1.37 s（224×168 细分 × 22 条骨架） |

## 五、已知边界（不粉饰）

1. 皮质是**程序化近似**：叶形来自椭球并集，沟回来自 22 条骨架 + 相位融合，靠近看仍是生成物，额极/颞极折痕规整。
2. 法线贴图试过并撤回：球面 UV 下一条脑回带只有 ~6 px，采样出摩尔纹。真要做需要位移贴图 + 三平面投影。
3. `ActivityLog` 是进程内环形日志（默认 240 条）+ `activity.jsonl` 尾部 400 行：跨刷新可以，跨服务重启只剩文件里的部分。
4. 时间旅行只重算强度，不改写数据。
5. 遗忘是真删并进 `archive.json`，不是软隐藏。
6. 竖屏窄屏下会隐藏归档扇区标签与部分行内信息（层身份只剩颜色）。

## 六、下一步（按我自己排的优先级）

1. 3D 交互深化：剖面与目镜之间的过渡、检索轨迹的分叉动画。
2. 记忆质量：把 `extractSemantic` 从正则升级成「实体 + 关系」候选表，减少误抽。
3. 真网格：接一份可商用脑模型做 displace 对照，保留程序化版本作为 fallback。

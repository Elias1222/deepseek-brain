const fs = require('fs');
const base = 'C:/Users/31721/OneDrive/文档/deepseek-harness/default-workspace/deepseek-brain';

const captions = [
  ['brain3d.png', '默认视角：22 条一级沟骨架、回冠高光、五层锚点与环绕的归档环'],
  ['brain3d-detail.png', '拉近：沟底冷灰 / 回冠骨白，极部短支切出的折痕'],
  ['brain3d-eyepiece.png', '目镜：一条记忆的原文、字段、确定性槽位与遗忘预报'],
  ['brain3d-revisions.png', '目镜里的修订史：v1…vN 芯片 + 该版字段'],
  ['brain3d-focus.png', '检索聚焦：命中收拢、非命中让开、一圈朝向相机'],
  ['brain3d-heat.png', '话题热度：层光晕 + 最热那条 engram 的读数'],
  ['brain3d-recall.png', '检索尾迹与侧支（白色索引环 → 命中）'],
  ['brain3d-history.png', '左栏检索史：最近 12 次查询 + 命中层刻度'],
  ['brain3d-rhythm.png', '检索节奏条：log1p 压缩后的爆发与长停顿'],
  ['brain3d-timeline.png', '时间轴拖拽：两段检索之间插值出的聚焦'],
  ['brain3d-graph.png', '查询-记忆关联图：中心查询、四周命中、与上次对比'],
  ['brain3d-hover.png', '图上悬停 → 脑里对应的那枚 engram 高亮'],
  ['brain3d-archive-ring.png', '归档环的五段扇区与常显小字'],
  ['brain3d-restore.png', '取回：engram 从环上沿尾迹长回自己的槽位'],
  ['brain3d-reset.png', '清空瞬间：所有 engram 收拢回归档环'],
  ['brain3d-section.png', '剖面：真裁剪面推进 + 灰白质分层着色'],
  ['brain3d-readonly.png', '只读实例的常驻横幅（另一个进程持有数据目录）'],
  ['brain3d-boot.png', '检索史的世代标记：进程 xxxxxx · 第 N 次启动'],
  ['brain3d-shared-activity.png', '只读窗口收到持有者的检索：同样出聚焦与 toast'],
  ['brain3d-mobile.png', '390×844：竖屏取景与底部抽屉'],
  ['dash-vitals.png', '观测仪 · 概览：脑区度数、生命体征示波器、读数板'],
  ['dash-chronicle.png', '观测仪 · 编年史：等宽表格、强度预报、两步归档'],
  ['dash-tractography.png', '观测仪 · 纤维追踪：力导向纤维束 + 实体档案 + 废弃事实'],
  ['dash-decay.png', '观测仪 · 衰减实验：时间转盘、曲线族、遗忘预报清单'],
  ['dash-revisions.png', '观测仪 · 修订抽屉'],
  ['dash-archive.png', '观测仪 · 归档区：多选取回与撤销'],
  ['dash-deprecated.png', '观测仪 · 废弃事实：每槽留 1 条，其余软归档'],
  ['dash-reset.png', '观测仪 · 清空大脑（含「已留底」提示）'],
  ['dash-mobile.png', '观测仪 · 390×844'],
];

const rows = captions
  .filter(([f]) => fs.existsSync(base + '/docs/screenshots/' + f))
  .map(([f, c]) => '| [' + f + '](docs/screenshots/' + f + ') | ' + c + ' |');

const section = [
  '',
  '---',
  '',
  '## 附录 A · 截图一览',
  '',
  '全部 1600×1000（移动端为 390×844 真机视口），存在 [`docs/screenshots/`](docs/screenshots/)。',
  '',
  '| 文件 | 看什么 |',
  '| --- | --- |',
  ...rows,
  '',
].join('\n');

const p = base + '/README.md';
let t = fs.readFileSync(p, 'utf8');
if (t.includes('附录 A · 截图一览')) { console.log('present'); process.exit(0); }
fs.writeFileSync(p, t.trimEnd() + '\n' + section);
console.log('appended', rows.length, 'rows');

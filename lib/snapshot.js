import { formatDate } from './util.js';
import { stars } from './render.js';

/** Markdown memory archive — portable across sessions and devices. */
export function toMarkdown(state, meta = {}) {
  const activity = meta.activity ?? null;
  const now = state.now ?? Date.now();
  const stats = state.stats ?? {};
  const episodic = [...(state.episodic ?? [])].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const semantic = state.semantic ?? [];
  const procedural = state.procedural ?? [];
  const aliases = state.aliases ?? {};
  const out = [];

  out.push('# DeepSeek Brain · 记忆档案');
  out.push('');
  out.push(`> 导出于 ${formatDate(now)} · 插件版本 ${meta.version ?? '1.0.0'} · 衰减系数 λ=${state.lambda ?? 0.05}`);
  out.push(`> 数据目录 \`${meta.dataDir ?? '~/.deepseek-brain'}\``);
  out.push('');
  out.push('## 概览');
  out.push('');
  out.push('| 指标 | 数值 |');
  out.push('|---|---|');
  out.push(`| 情景记忆 | ${episodic.length} |`);
  out.push(`| 语义三元组 | ${semantic.filter((s) => s.status === 'active').length} 活跃 / ${semantic.length} 总计 |`);
  out.push(`| 程序规则 | ${procedural.length} |`);
  out.push(`| 累计遗忘 | ${stats.forgotten ?? 0} |`);
  out.push(`| 累计巩固 | ${stats.consolidated ?? 0} |`);
  out.push('');

  out.push('## 语义记忆 · 知识图谱');
  out.push('');
  if (semantic.length === 0) out.push('_（空）_');
  else {
    out.push('| 主体 | 关系 | 客体 | 状态 | 重要度 | 时间 |');
    out.push('|---|---|---|---|---|---|');
    for (const it of semantic) {
      const status = it.status === 'corrected' ? '[已修正]' : it.status === 'archived' ? '[已归档]' : '有效';
      out.push(`| ${esc(it.subject)} | ${esc(it.relation)} | ${esc(it.object)} | ${status} | ${stars(it.importance)} | ${formatDate(it.ts)} |`);
    }
  }
  out.push('');
  if (Object.keys(aliases).length > 0) {
    out.push('### 实体归一表');
    out.push('');
    for (const [alias, canonical] of Object.entries(aliases)) out.push(`- \`${esc(alias)}\` → \`${esc(canonical)}\``);
    out.push('');
  }

  out.push('## 情景记忆 · 时间线');
  out.push('');
  if (episodic.length === 0) out.push('_（空）_');
  else {
    let currentDay = '';
    for (const it of episodic) {
      const day = formatDate(it.ts).slice(0, 5);
      if (day !== currentDay) {
        currentDay = day;
        out.push('');
        out.push(`### ${day}`);
        out.push('');
      }
      const tags = [
        ...(it.participants ?? []).map((p) => `#${p}`),
        it.place ? `#地点/${it.place}` : '',
        it.emotion ? `#情绪/${it.emotion}` : '',
        ...(it.tags ?? []).map((t) => `#${t}`),
      ]
        .filter(Boolean)
        .join(' ');
      out.push(`- **${formatDate(it.ts)}** ${esc(it.event)} ${stars(it.importance)}${it.consolidated ? ' ◉长期' : ''}`);
      if (it.detail) out.push(`  - ${esc(it.detail)}`);
      if (tags) out.push(`  - ${tags}`);
    }
  }
  out.push('');

  out.push('## 程序记忆 · 行为规则');
  out.push('');
  if (procedural.length === 0) out.push('_（空）_');
  else for (const it of procedural) out.push(`- ${esc(it.rule)}（重要度 ${it.importance} · 强度 ${Number(it.strength ?? 0).toFixed(1)} · 命中 ${it.hits ?? 0}）`);
  out.push('');

  out.push('## 最近活动 · 进程日志');
  out.push('');
  if (!activity || !activity.events || activity.events.length === 0) {
    out.push('_（这个进程还没有活动记录）_');
  } else {
    out.push(`进程 ${activity.boot} · 第 ${activity.generation ?? 1} 次启动 · 事件 ${activity.seq} 件（这里只带走最近 ${activity.events.length} 条）`);
    out.push('');
    out.push('| 时间 | 类型 | 内容 |');
    out.push('| --- | --- | --- |');
    for (const event of activity.events) {
      out.push(`| ${esc(String(event.at).replace('T', ' ').slice(0, 19))} | ${esc(event.kind)} | ${esc(event.detail)} |`);
    }
    out.push('');
    out.push('_这只说明「刚才在查什么」，不是记忆本身；导入时会忽略它。_');
  }
  out.push('');

  out.push('## 迁移说明');
  out.push('');
  out.push('把本文件放回 `~/.deepseek-brain/` 即可作为人工备份；机器可读的完整档案在 `export.json`，');
  out.push('`deepseek-brain import <export.json>` 或 `brain_recall` 工具不会覆盖现有记忆，只做增量合并。');
  out.push('');
  return out.join('\n');
}

function esc(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

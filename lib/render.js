import { formatDate, truncate } from './util.js';

/**
 * ASCII "brain map" for the conversation. Renders with box-drawing characters and
 * accounts for double-width CJK glyphs so the frame never tears.
 */

const FULLWIDTH = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u3000-\u303f]/;

export function displayWidth(text) {
  let w = 0;
  for (const ch of String(text)) {
    if (/[\u{1f300}-\u{1faff}]/u.test(ch)) w += 2;
    else if (FULLWIDTH.test(ch)) w += 2;
    else w += 1;
  }
  return w;
}

function fit(text, width) {
  const str = String(text ?? '');
  if (displayWidth(str) <= width) return str + ' '.repeat(width - displayWidth(str));
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = displayWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…${' '.repeat(Math.max(0, width - w - 1))}`;
}

const WIDTH = 60;
const INNER = WIDTH - 4;

function rule(label) {
  const tail = WIDTH - 4 - displayWidth(label) - 1;
  return `├─ ${label} ${'─'.repeat(Math.max(2, tail))}┤`;
}

function top(label) {
  const tail = WIDTH - 4 - displayWidth(label) - 1;
  return `┌─ ${label} ${'─'.repeat(Math.max(2, tail))}┐`;
}

function row(text) {
  return `│ ${fit(text, INNER)} │`;
}

const bottom = `└${'─'.repeat(WIDTH - 2)}┘`;

const LAYER_LABEL = { sensory: '感觉', working: '工作', episodic: '情景', semantic: '语义', procedural: '程序' };

export function stars(importance) {
  const n = Math.max(0, Math.min(5, Math.round(importance ?? 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/**
 * @param {object} state { working:{stack}, episodic, semantic, procedural, sensory, lambda, now }
 */
export function renderBrain(state) {
  const now = state.now ?? Date.now();
  const lines = [];
  const working = state.working?.stack ?? state.working ?? [];
  const episodic = state.episodic ?? [];
  const semantic = (state.semantic ?? []).filter((it) => it.status === 'active');
  const procedural = state.procedural ?? [];
  const sensory = state.sensory ?? [];

  lines.push(top('工作记忆 · 话题栈（栈顶=当前焦点）'));
  if (working.length === 0) lines.push(row('▸ （空）等待输入…'));
  else {
    const stackText = working.map((t, i) => (i === 0 ? `▸ ${t.title}` : `· ${t.title}`)).join('   ');
    lines.push(row(truncate(stackText, 200)));
    lines.push(row(`容量 ${working.length}/${state.workingCapacity ?? 7} · 顶部话题决定回答焦点`));
  }

  lines.push(rule('情景记忆（近期 · 强度=重要度×e^(-λt)）'));
  const recent = [...episodic]
    .sort((a, b) => (b.strength ?? b.importance ?? 0) - (a.strength ?? a.importance ?? 0) || Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, 6);
  if (recent.length === 0) lines.push(row('● 尚无情景记忆'));
  for (const it of recent) {
    const strength = typeof it.strength === 'number' ? it.strength.toFixed(2) : '—';
    lines.push(row(`${it.consolidated ? '◉' : '●'} ${formatDate(it.ts).slice(0, 5)} ${truncate(it.event, 26)} ${stars(it.importance)} s=${strength}`));
  }
  if (episodic.length > recent.length) lines.push(row(`… 另有 ${episodic.length - recent.length} 条`));

  lines.push(rule('语义记忆（主体 → 关系 → 客体）'));
  const triples = semantic.slice(0, 6);
  if (triples.length === 0) lines.push(row('（空）尚无实体知识'));
  for (const it of triples) {
    lines.push(row(`${it.status === 'corrected' ? '[已修正] ' : ''}${truncate(`${it.subject} → ${it.relation} → ${it.object}`, 66)}`));
  }
  if (semantic.length > triples.length) lines.push(row(`… 另有 ${semantic.length - triples.length} 条三元组`));

  lines.push(rule('程序记忆（行为默认值）'));
  if (procedural.length === 0) lines.push(row('（空）尚无用户习惯规则'));
  for (const it of [...procedural].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0)).slice(0, 4)) {
    lines.push(row(`⚙ ${truncate(it.rule, 60)}`));
  }

  lines.push(rule('感觉记忆（7±2 槽 · 存活 2 秒）'));
  if (sensory.length === 0) lines.push(row('（空）2 秒内未捕获注意'));
  for (const it of sensory.slice(0, 4)) {
    const tags = [
      it.entities?.people?.length ? `人:${it.entities.people.join('/')}` : '',
      it.entities?.times?.length ? `时:${it.entities.times[0]}` : '',
      it.entities?.places?.length ? `地:${it.entities.places[0]}` : '',
    ].filter(Boolean).join(' ');
    lines.push(row(`◇ ${truncate(it.text, 34)}${tags ? ` ${truncate(tags, 22)}` : ''}`));
  }

  lines.push(bottom);
  lines.push('');
  lines.push(renderHealth(state, now));
  return lines.join('\n');
}

export function renderHealth(state, now = Date.now()) {
  const episodic = state.episodic ?? [];
  const semantic = state.semantic ?? [];
  const procedural = state.procedural ?? [];
  const working = state.working?.stack ?? state.working ?? [];
  const sensory = state.sensory ?? [];
  const total = episodic.length + semantic.filter((s) => s.status !== 'archived').length + procedural.length;
  const week = 7 * 86_400_000;
  const addedWeek = [...episodic, ...semantic, ...procedural].filter((it) => now - Date.parse(it.ts) <= week).length;
  const avgImportance = episodic.length
    ? (episodic.reduce((sum, it) => sum + (it.importance ?? 0), 0) / episodic.length).toFixed(2)
    : '0.00';
  const activeTopics = [...new Set(episodic.map((it) => it.participants?.[0] ?? it.place).filter(Boolean))].slice(0, 6);
  const stats = state.stats ?? {};
  const lines = [];
  const item = (label, value) => `${fit(label, 14)}${fit(String(value), INNER - 14)}`;
  lines.push(top('记忆健康面板'));
  lines.push(row(item('总记忆数', total)));
  lines.push(row(item('本周新增', addedWeek)));
  lines.push(row(item('遗忘压缩数', stats.forgotten ?? 0)));
  lines.push(row(item('睡眠巩固次数', stats.consolidated ?? 0)));
  lines.push(row(item('平均重要度', avgImportance)));
  lines.push(row(item('活跃主题', activeTopics.join('、') || '—')));
  lines.push(row(item('分层条数', `感 ${sensory.length} · 工 ${working.length} · 情 ${episodic.length} · 语 ${semantic.length} · 程 ${procedural.length}`)));
  lines.push(row(item('最近巩固', stats.lastSleepAt ? formatDate(stats.lastSleepAt) : '尚未发生')));
  lines.push(bottom);
  return lines.join('\n');
}

export { LAYER_LABEL };

import { clamp, id, nowIso, oneLine } from './util.js';

/**
 * Sensory memory: a 7±2 slot buffer with a 2-second lifetime.
 *
 * Science mapping: iconic/echoic store (Atkinson–Shiffrin). Everything that
 * arrives is parsed for entities first; only attended items survive the TTL and
 * become candidates for working memory.
 */

/** 「是我的」「了老板」这种不是人名：名字里不该带这些虚字。 */
const PERSON_STOP = /[的是我你他她它们这那了在和跟与及把被给对从到]/;
export function isPersonLike(value) {
  const v = String(value ?? '').trim();
  if (v.length < 2 || v.length > 4) return false;
  if (PERSON_STOP.test(v)) return false;
  return true;
}

const PEOPLE_PATTERNS = [
  /(?:和|跟|与|找|约|叫|给|问)([\u4e00-\u9fa5]{2,3})(?=[说聊去来到开吃见谈定走会一要在把住做发上下打签出回看听想觉得，、。！？;；\s]|$)/g,
  /([\u4e00-\u9fa5]{2,3})(?:老师|总|哥|姐|经理|主任|同学|医生|老板|教授)/g,
  /(?:我叫|名字是)([\u4e00-\u9fa5]{2,4})/g,
];

const TIME_PATTERN =
  /(今天|明天|后天|昨天|前天|大后天|本周|这周|下周|上周|周末|上午|中午|下午|晚上|凌晨|今晚|明晚|今年|明年|去年|[一二三四五六七八九十两\d]{1,3}点(?:半|[一二三四五六七八九十\d]{1,2}分?)?|[一二三四五六七八九十两\d]{1,2}月[一二三四五六七八九十两\d]{1,2}[日号]|下周[一二三四五六日天]|周[一二三四五六日天]|\d{1,2}:\d{2}|\d{4}年)/g;

const PLACE_PATTERNS = [
  /([\u4e00-\u9fa5]{2,8}(?:市|区|县|街|路|镇|村|大厦|广场|公园|机场|车站|医院|学校|大学|公司|咖啡厅|咖啡馆|餐厅|酒店|商场|超市))/g,
  /(?:在|去|到|来自)([\u4e00-\u9fa5]{2,8}?)(?=开|见|吃|逛|买|上班|工作|出差|开会|住|等|碰面|集合)/g,
];

const EMOTION_LEXICON = {
  开心: 0.8, 高兴: 0.8, 兴奋: 0.9, 期待: 0.6, 满意: 0.6, 感激: 0.7, 喜欢: 0.7, 爱: 0.9,
  难过: -0.7, 伤心: -0.8, 焦虑: -0.7, 紧张: -0.5, 害怕: -0.7, 生气: -0.8, 愤怒: -0.9,
  失望: -0.6, 委屈: -0.7, 疲惫: -0.4, 累: -0.4, 烦躁: -0.6, 担心: -0.5, 惊讶: 0.2, 平静: 0.1, 无聊: -0.2,
};

const COMMITMENT_WORDS = ['答应', '承诺', '一定', '务必', '记住', '记得', '安排', '截止', 'deadline', '提醒我', '别忘'];
const STOP_TOPICS = new Set(['我们', '你们', '他们', '这个', '那个', '什么', '怎么', '可以', '就是', '然后', '现在', '一下', '帮我']);

export function extractEntities(text) {
  const raw = String(text ?? '');
  const people = new Set();
  for (const re of PEOPLE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of raw.matchAll(re)) {
      const name = m[1];
      /* 名字候选统一过筛，见 isPersonLike */
      if (name && !STOP_TOPICS.has(name) && isPersonLike(name)) people.add(name);
    }
  }
  const times = [...new Set([...raw.matchAll(TIME_PATTERN)].map((m) => m[0]))];
  const numbers = [...new Set([...raw.matchAll(/\d+(?:\.\d+)?%?/g)].map((m) => m[0]))];
  const places = new Set();
  for (const re of PLACE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of raw.matchAll(re)) {
      const p = m[1];
      if (p && p.length >= 2 && !STOP_TOPICS.has(p)) places.add(p);
    }
  }
  const urls = [...new Set([...raw.matchAll(/https?:\/\/[^\s，。；、）)]+/g)].map((m) => m[0]))];
  const emotions = [];
  let valence = 0;
  for (const [word, v] of Object.entries(EMOTION_LEXICON)) {
    if (raw.includes(word)) {
      emotions.push(word);
      valence += v;
    }
  }
  return {
    people: [...people],
    times,
    numbers,
    places: [...places],
    urls,
    emotions: [...new Set(emotions)],
    valence: clamp(valence, -1, 1),
  };
}

export function isAttended(entities, text) {
  const hasEntity =
    entities.people.length + entities.times.length + entities.places.length + entities.urls.length > 0;
  return hasEntity || String(text).length >= 12 || entities.emotions.length > 0;
}

export function commitmentLevel(text) {
  const raw = String(text ?? '');
  let hits = 0;
  for (const w of COMMITMENT_WORDS) if (raw.includes(w)) hits += 1;
  return Math.min(2, hits);
}

/** Cheap importance estimate used by the "is it worth remembering?" gate. */
export function estimateImportance(text, entities) {
  let score = 2;
  if (entities.people.length > 0) score += 1;
  if (entities.places.length > 0) score += 0.5;
  if (entities.times.length > 0) score += 0.5;
  if (commitmentLevel(text) > 0) score += 1;
  if (Math.abs(entities.valence) >= 0.6) score += 0.5;
  if (entities.urls.length > 0) score += 0.5;
  return clamp(Math.round(score), 1, 5);
}

const GREETING = /^(你好|您好|嗨|hi|hello|早安|晚安|在吗|谢谢|多谢|好的|ok|嗯+|收到|再见|拜拜)[！!。.\s]*$/i;
const QUESTION = /(吗|呢|怎么|为什么|如何|什么|多少|哪|是不是|能不能|可不可以)[？?]?$/;

/** Decide whether an utterance deserves durable memory at all. */
export function shouldRemember(text, entities = extractEntities(text)) {
  const raw = oneLine(text);
  if (!raw) return { keep: false, reason: 'empty' };
  if (raw.length < 3) return { keep: false, reason: 'too-short' };
  if (GREETING.test(raw)) return { keep: false, reason: 'greeting' };
  const entityCount =
    entities.people.length + entities.times.length + entities.places.length + entities.urls.length;
  const importance = estimateImportance(raw, entities);
  if (QUESTION.test(raw) && entityCount === 0 && commitmentLevel(raw) === 0) {
    return { keep: false, reason: 'question-without-fact' };
  }
  if (entityCount === 0 && commitmentLevel(raw) === 0 && raw.length < 10) {
    return { keep: false, reason: 'low-signal' };
  }
  return { keep: true, reason: 'signal', importance };
}

export class SensoryBuffer {
  constructor({ capacity = 7, ttlMs = 2000 } = {}) {
    this.capacity = clamp(capacity, 3, 9);
    this.ttlMs = Math.max(100, Number(ttlMs) || 2000);
    this.items = [];
  }

  ingest(text, now = Date.now(), knownPeople = []) {
    const entities = extractEntities(text);
    for (const p of knownPeople) if (String(text).includes(p)) entities.people = [...new Set([...entities.people, p])];
    const attended = isAttended(entities, text);
    const entry = {
      id: id('sen'),
      ts: nowIso(now),
      text: oneLine(text).slice(0, 400),
      entities,
      attended,
      importance: estimateImportance(text, entities),
      expiresAt: nowIso(now + this.ttlMs),
    };
    this.items.push(entry);
    const dropped = [];
    while (this.items.length > this.capacity) dropped.push(this.items.shift());
    return { entry, dropped };
  }

  /** Drop expired unattended traces (attended ones stay until capacity pressure or TTL too). */
  sweep(now = Date.now()) {
    const expired = this.items.filter((it) => Date.parse(it.expiresAt) <= now);
    this.items = this.items.filter((it) => Date.parse(it.expiresAt) > now);
    return expired;
  }

  latestAttended(now = Date.now()) {
    this.sweep(now);
    for (let i = this.items.length - 1; i >= 0; i -= 1) if (this.items[i].attended) return this.items[i];
    return null;
  }

  snapshot() {
    return this.items.map((it) => ({ ...it }));
  }

  clear() {
    this.items = [];
  }
}

export function sensorySummary(entities) {
  const parts = [];
  if (entities.people.length) parts.push(`人:${entities.people.join('、')}`);
  if (entities.times.length) parts.push(`时:${entities.times.join('、')}`);
  if (entities.places.length) parts.push(`地:${entities.places.join('、')}`);
  if (entities.emotions.length) parts.push(`情:${entities.emotions.join('、')}`);
  return parts.join(' ') || '无显著实体';
}

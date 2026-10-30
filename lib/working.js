import { clamp, id, nowIso, oneLine, truncate } from './util.js';

/**
 * Working memory: the topic stack (Baddeley's central executive, Miller/Cowan
 * capacity 4±1 … 7±2). New topics are pushed; shelved topics are popped from the
 * top. The prompt always reads the top of the stack to decide the current focus.
 */

const TOPIC_STOP = new Set([
  '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '可以', '就是', '然后', '现在', '今天',
  '一个', '帮我', '请问', '如果', '但是', '因为', '所以', '还有', '已经', '需要', '进行', '一下',
]);

const TOPIC_STOP_RE = new RegExp(
  ['我们', '你们', '他们', '大家', '请问', '帮我', '帮忙', '现在', '今天', '明天', '然后', '就是', '如果', '但是',
   '因为', '所以', '还有', '已经', '需要', '进行', '一下', '这个', '那个', '什么', '怎么', '可以', '的', '了', '吗',
   '呢', '吧', '啊', '把', '被', '和', '跟', '在', '是', '就', '都', '也', '还'].join('|'),
  'g',
);

/** Extract a short topic label from a user utterance. */
export function detectTopic(text) {
  const raw = oneLine(text).replace(/[，。！？!?；;、,.]+/g, ' ');
  const latin = raw.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [];
  const chunks = raw.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const candidates = [];
  for (const chunk of chunks) {
    const stripped = chunk.replace(TOPIC_STOP_RE, ' ').split(/\s+/).filter((s) => s.length >= 2);
    const parts = stripped.length > 0 ? stripped : [chunk];
    for (const part of parts) {
      if (TOPIC_STOP.has(part)) continue;
      candidates.push(part);
    }
  }
  for (const word of latin) candidates.push(word);
  const pick = candidates.sort((a, b) => b.length - a.length)[0] ?? truncate(raw, 10);
  return truncate(pick, 12) || '闲聊';
}

const SMALL_TALK = /^(你好|您好|嗨|hi|hello|早安|晚安|在吗|在不在|谢谢|多谢|好的|ok|嗯+|收到|再见|拜拜|哈+)$/i;

/** Greetings and acknowledgements should not occupy a topic slot. */
export function isSmallTalk(text) {
  const raw = oneLine(text).replace(/[\s！!。.~～,，、]+/g, '');
  return raw.length > 0 && raw.length <= 6 && SMALL_TALK.test(raw);
}

export class WorkingMemory {
  constructor({ capacity = 7 } = {}) {
    this.capacity = clamp(capacity, 4, 7);
    this.stack = [];
  }

  /** Push (or re-activate) a topic. Returns the stack for rendering. */
  push(topic, now = Date.now()) {
    const title = oneLine(topic).slice(0, 24) || '闲聊';
    const existing = this.stack.find((t) => t.title === title);
    if (existing) {
      existing.ts = nowIso(now);
      this.stack = [existing, ...this.stack.filter((t) => t !== existing)];
      return { item: existing, shelved: [] };
    }
    const item = { id: id('wk'), title, ts: nowIso(now) };
    this.stack.unshift(item);
    const shelved = this.stack.splice(this.capacity);
    return { item, shelved };
  }

  peek() {
    return this.stack[0] ?? null;
  }

  /** Explicitly shelve the current topic. */
  pop() {
    return this.stack.shift() ?? null;
  }

  activate(topicId) {
    const idx = this.stack.findIndex((t) => t.id === topicId);
    if (idx <= 0) return this.peek();
    const [item] = this.stack.splice(idx, 1);
    item.ts = nowIso();
    this.stack.unshift(item);
    return item;
  }

  topics(limit = 5) {
    return this.stack.slice(0, limit);
  }

  clear() {
    this.stack = [];
  }
}

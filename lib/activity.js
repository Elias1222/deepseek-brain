/**
 * Activity log — the brain's live electrophysiology.
 *
 * Every operation the agent performs on its memory (observe / recall / remember /
 * edit / forget / correct / consolidate / decay / import) leaves a numbered event
 * here. The 3D instrument and the dashboard poll this log and replay it as
 * travelling activation, so what you see on screen is the agent's own cognition,
 * not decoration.
 *
 * The log is intentionally in-memory only: it is a recording of the current process,
 * not a durable store. The memories themselves are persisted; the traffic is not.
 */

const KINDS = new Set([
  'observe',
  'recall',
  'remember',
  'edit',
  'forget',
  'correct',
  'prune', 'restore', 'archive',
  'consolidate',
  'decay',
  'travel',
  'sleep',
  'import',
]);

export const ACTIVITY_KINDS = [...KINDS];

export class ActivityLog {
  constructor({ limit = 240 } = {}) {
    this.limit = Math.max(20, limit);
    /* 进程世代号：前端用它区分「历史为空」和「换了一个进程」 */
    this.boot = Math.random().toString(36).slice(2, 8);
    this.seq = 0;
    this.events = [];
    /* 订阅者集合：SSE 连接直接挂在这里，事件到位就推送，不必等下一次轮询 */
    this.listeners = new Set();
    /* 落盘钩子：持有锁的进程把事件追加到活动日志，只读实例再从那里读回来 */
    this.tail = null;
  }

  /**
   * 订阅新事件。返回取消订阅的函数（服务端在连接关闭时调用）。
   * 回调抛错不影响其它订阅者，也不会打断 push 的写入流程。
   */
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get subscriberCount() {
    return this.listeners.size;
  }

  /**
   * Record one event. Payload is merged verbatim, but `seq`/`ts`/`kind` always win.
   */
  push(kind, payload = {}, now = Date.now()) {
    const event = { ...payload, seq: this.seq + 1, ts: now, kind: KINDS.has(kind) ? kind : 'observe' };
    this.seq = event.seq;
    this.events.push(event);
    const overflow = this.events.length - this.limit;
    if (overflow > 0) this.events.splice(0, overflow);
    if (this.tail) {
      try {
        this.tail(event);
      } catch {
        /* 落盘失败不能让记忆写入失败 */
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken subscriber must not break memory writes */
      }
    }
    return event;
  }

  /** 挂上落盘钩子（只读实例传 null，它就只读不写）。 */
  attachTail(fn) {
    this.tail = typeof fn === 'function' ? fn : null;
  }

  /**
   * 用磁盘上的活动日志填充内存：两个实例共用一个数据目录时，
   * 只读的那一个也能看到持有者的检索史与事件序号。
   */
  hydrate(events) {
    if (!Array.isArray(events) || events.length === 0) return 0;
    const clean = events
      .filter((e) => e && Number.isFinite(e.seq))
      .sort((a, b) => a.seq - b.seq)
      .slice(-this.limit);
    this.events = clean;
    this.seq = clean.length ? clean[clean.length - 1].seq : 0;
    return this.seq;
  }

  /** Everything newer than `sinceSeq`, oldest first (bounded by `limit`). */
  since(sinceSeq = 0, { limit = 80 } = {}) {
    const floor = Number.isFinite(sinceSeq) ? sinceSeq : 0;
    return this.events.filter((e) => e.seq > floor).slice(-Math.max(1, limit));
  }

  recent(count = 12) {
    return this.events.slice(-Math.max(1, count));
  }

  clear() {
    this.events = [];
  }
}

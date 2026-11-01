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
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken subscriber must not break memory writes */
      }
    }
    return event;
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

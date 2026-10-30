/**
 * Activity log — the brain's live electrophysiology.
 *
 * Every operation the agent performs on its memory (observe / recall / remember /
 * forget / consolidate / decay) leaves a numbered event here. The 3D instrument and
 * the dashboard poll this log and replay it as travelling activation, so what you see
 * on screen is the agent's own cognition, not decoration.
 *
 * The log is intentionally in-memory only: it is a recording of the current process,
 * not a durable store. The memories themselves are persisted; the traffic is not.
 */

const KINDS = new Set([
  'observe',
  'recall',
  'remember',
  'forget',
  'correct',
  'consolidate',
  'decay',
  'travel',
  'sleep',
]);

export const ACTIVITY_KINDS = [...KINDS];

export class ActivityLog {
  constructor({ limit = 240 } = {}) {
    this.limit = Math.max(20, limit);
    this.seq = 0;
    this.events = [];
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

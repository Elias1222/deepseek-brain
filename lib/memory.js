import path from 'node:path';
import { extractFacts, parseWhen } from './extract.js';
import { Store, resolveDataDir } from './store.js';
import { SensoryBuffer, extractEntities, estimateImportance, shouldRemember } from './sensory.js';
import { WorkingMemory, detectTopic, isSmallTalk } from './working.js';
import { PINNED_IMPORTANCE, addedToday, createEpisodic, decay, strengthOf, withStrength } from './episodic.js';
import { SemanticMemory } from './semantic.js';
import { ProceduralMemory } from './procedural.js';
import { consolidate } from './consolidation.js';
import { recall as recallRecords, renderHits } from './retrieval.js';
import { renderBrain } from './render.js';
import { toMarkdown } from './snapshot.js';
import { VectorIndex } from './vector.js';
import { ActivityLog } from './activity.js';
import { clamp, id, isToday, nowIso, oneLine, overlapScore, tokenize, truncate, unique } from './util.js';

export const VERSION = '1.0.0';

export const DEFAULT_CONFIG = {
  dataDir: '',
  lambda: 0.05,
  sensoryCapacity: 7,
  sensoryTtlMs: 2000,
  workingCapacity: 7,
  forgetThreshold: 0.5,
  topK: 6,
  autoCapture: true,
  autoImportanceMin: 3,
  promptInjection: true,
  dashboard: true,
  backupCount: 7,
  idleConsolidationHours: 12,
  minConsolidationAgeHours: 6,
  vector: { enabled: false, provider: 'hash' },
  demoSeed: false,
  activityLimit: 240,
  autoDecayMinutes: 30,
  /* 抢不到锁时先排队等多久；0 = 不排队直接只读 */
  lockWaitMs: 8000,
  /* 后台接管轮询间隔；0 = 关闭（只读实例不会自己升级成可写） */
  handoverMs: 20000,
};

export function normalizeConfig(input = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  cfg.lambda = clamp(cfg.lambda, 0.001, 1);
  cfg.sensoryCapacity = clamp(Math.round(cfg.sensoryCapacity), 3, 9);
  cfg.sensoryTtlMs = clamp(Number(cfg.sensoryTtlMs) || 2000, 200, 60_000);
  cfg.workingCapacity = clamp(Math.round(cfg.workingCapacity), 4, 7);
  cfg.forgetThreshold = clamp(cfg.forgetThreshold, 0.05, 3);
  cfg.topK = clamp(Math.round(cfg.topK), 1, 20);
  cfg.backupCount = clamp(Math.round(cfg.backupCount), 1, 50);
  cfg.autoImportanceMin = clamp(Math.round(cfg.autoImportanceMin), 1, 5);
  cfg.idleConsolidationHours = clamp(Number(cfg.idleConsolidationHours) || 12, 1, 240);
  cfg.minConsolidationAgeHours = clamp(Number(cfg.minConsolidationAgeHours) || 0, 0, 720);
  cfg.vector = { enabled: false, provider: 'hash', ...(cfg.vector ?? {}) };
  cfg.activityLimit = clamp(Math.round(Number(cfg.activityLimit) || 240), 20, 2000);
  cfg.autoDecayMinutes = clamp(Number(cfg.autoDecayMinutes ?? 30) || 0, 0, 1440);
  cfg.lockWaitMs = clamp(Number(cfg.lockWaitMs ?? 8000) || 0, 0, 120000);
  cfg.handoverMs = clamp(Number(cfg.handoverMs ?? 20000) || 0, 0, 600000);
  cfg.dataDir = resolveDataDir(cfg.dataDir);
  return cfg;
}

const EMPTY_STATS = () => ({
  version: 1,
  createdAt: nowIso(),
  /* 世代指纹：谁、第几次启动、什么时候；previous 指向上一代，够前端说「重启过几次」 */
  boot: null,
  counters: { forgotten: 0, consolidated: 0, recalls: 0, remembers: 0, manualForgets: 0 },
  lastSleepAt: null,
  lastRecallAt: null,
  remembersByDay: {},
});

export class MemorySystem {
  constructor(config = {}) {
    this.config = normalizeConfig(config);
    this.store = new Store(this.config.dataDir, { backupCount: this.config.backupCount });
    this.store.ensure();
    this.episodic = [];
    this.archive = [];
    this.stats = EMPTY_STATS();
    this.semantic = new SemanticMemory();
    this.procedural = new ProceduralMemory();
    this.sessions = new Map();
    this.vector = new VectorIndex(this.config.vector);
    this.activity = new ActivityLog({ limit: this.config.activityLimit });
    this.ready = false;
    this.warnings = [];
  }

  async init() {
    this.load();
    let lock = this.store.acquireLock();
    /* 抢不到先排队：第二个实例等着，而不是立刻退成只读 */
    if (!lock.ok && this.config.lockWaitMs > 0) {
      const holderPid = lock.holder && lock.holder.pid ? lock.holder.pid : '?';
      this.warnings.push('waiting for the data dir lock held by pid ' + holderPid);
      lock = await this.store.waitForLock(Date.now(), { timeoutMs: this.config.lockWaitMs });
      if (lock.ok) {
        this.warnings.push('lock acquired after waiting');
        /* 等锁期间别人可能写过盘：重新读一遍再继续 */
        this.load();
      }
    }
    this.lock = lock;
    if (!lock.ok) {
      /* 另一个活着的进程正握着这个目录：不抢写，降级只读，让 /api/health 说清楚 */
      this.readOnly = true;
      const who = lock.holder && lock.holder.pid ? lock.holder.pid : '?';
      this.warnings.push(
        'data dir is locked by pid ' + who + ' (' + this.config.dataDir + '); running read-only',
      );
    } else {
      this.readOnly = false;
      if (lock.stolen) {
        const oldPid = lock.stolen.pid ? lock.stolen.pid : '?';
        this.warnings.push('reclaimed a stale lock from pid ' + oldPid);
      }
      const release = () => this.store.releaseLock();
      process.once('exit', release);
      process.once('SIGINT', () => { release(); process.exit(130); });
      process.once('SIGTERM', () => { release(); process.exit(143); });
      this.startHandoverWatch();
    }
    if (this.readOnly) this.startHandoverWatch();
    /* 只读实例不记世代：stats.json 里的 id 属于持锁进程，改了就再也对不上 */
    if (!this.readOnly) this.stampBoot();
    this.wireActivity();
    await this.vector.init({ dir: path.join(this.config.dataDir, 'vectors'), records: [] });
    if (this.vector.warning) this.warnings.push(this.vector.warning);
    if (this.config.demoSeed && this.episodic.length === 0) this.seedDemo();
    this.reindexVectors();
    this.ready = true;
    return this;
  }

  /**
   * 只读实例的后台接管：每隔 handoverMs 试一次锁，抢到就把自己升级成可写，
   * 并重新读一遍磁盘（前任进程可能写过），再记一次世代。
   */
  startHandoverWatch() {
    if (!this.config.handoverMs || this.handoverTimer) return;
    const tick = () => {
      if (!this.readOnly) return;
      const got = this.store.acquireLock();
      if (!got.ok) return;
      const former = this.lock && this.lock.holder && this.lock.holder.pid ? this.lock.holder.pid : null;
      this.lock = got;
      this.readOnly = false;
      this.warnings.push('handover: took over the data dir' + (former ? ' from pid ' + former : ''));
      this.load();
      this.stampBoot();
      /* 接管之后要把活动日志的落盘钩子接上——只读期间它是断开的 */
      this.wireActivity();
    };
    const timer = setInterval(tick, this.config.handoverMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.handoverTimer = timer;
  }

  stopHandoverWatch() {
    if (this.handoverTimer) { clearInterval(this.handoverTimer); this.handoverTimer = null; }
  }

  /**
   * 把这次的进程世代写进 stats.json：同一份数据目录被打开一次，世代就 +1。
   * 这不是活动流（那是进程内的），而是一条跨重启的短历史。
   */
  stampBoot(now = Date.now()) {
    const prev = this.stats.boot && typeof this.stats.boot === 'object' ? this.stats.boot : null;
    const count = prev && Number.isFinite(prev.count) ? prev.count + 1 : 1;
    this.stats.boot = {
      id: this.activity.boot,
      count,
      since: nowIso(now),
      previous: prev ? { id: prev.id, since: prev.since, count: prev.count } : null,
    };
    this.persist();
    return this.stats.boot;
  }

  /**
   * 活动日志与数据目录对齐：
   * - 持锁进程：把每条事件追加进 activity.jsonl；
   * - 只读实例：不写，只把持有者已经写下的事件灌进内存，于是检索史与序号与它一致。
   */
  wireActivity() {
    if (this.readOnly) {
      const events = this.store.readActivity({ limit: 200 });
      if (events.length) this.activity.hydrate(events);
      this.activity.attachTail(null);
      return;
    }
    this.activity.attachTail((event) => {
      if (this.readOnly) return;
      this.store.appendActivity(event, { max: 400 });
    });
  }

  /**
   * 空白大脑：把五层记忆、归档、活动流、计数器一起清掉，并记一次新世代。
   * 记忆文件照样落盘（清空后的空结构），所以不会留下「删了但还在」的错觉。
   */
  resetAll({ now = Date.now(), sessionId = 'default', snapshot = true } = {}) {
    const report = {
      episodic: this.episodic.length,
      semantic: this.semantic.items.length,
      procedural: this.procedural.items.length,
      archive: this.archive.length,
      activity: this.activity.events.length,
    };
    /* 清空前先留底：人最不想失去的东西，往往是在点「清空」那一刻才想起来的。 */
    const total = report.episodic + report.semantic + report.procedural + report.archive;
    if (snapshot && total > 0) {
      try {
        report.snapshot = this.store.writeSnapshot('pre-reset', this.snapshotMarkdown(sessionId));
      } catch (error) {
        report.snapshotError = String(error && error.message ? error.message : error);
      }
    }
    this.episodic = [];
    this.semantic.items = [];
    this.semantic.aliases = {};
    this.procedural.items = [];
    this.archive = [];
    this.sessions = new Map();
    this.stats = EMPTY_STATS();
    this.activity.reset();
    this.store.clearActivity();
    this.stampBoot(now);
    this.wireActivity();
    const cleared = {
      episodic: report.episodic,
      semantic: report.semantic,
      procedural: report.procedural,
      archive: report.archive,
      activity: report.activity,
    };
    this.activity.push('reset', { sessionId, cleared }, now);
    this.persist();
    this.reindexVectors();
    const out = { cleared, boot: this.stats.boot };
    if (report.snapshot) out.snapshot = report.snapshot;
    if (report.snapshotError) out.snapshotError = report.snapshotError;
    return out;
  }

  /** 只读实例：把持有者刚写下的事件追平（每次读活动流时调，代价是一次文件读）。 */
  syncActivityFromDisk() {
    if (!this.readOnly) return this.activity.seq;
    const events = this.store.readActivity({ limit: 200 });
    if (!events.length) return this.activity.seq;
    /* ingest 会把新增事件推给订阅者，只读实例的 SSE 因此能播持有者的动作 */
    this.activity.ingest(events);
    return this.activity.seq;
  }

  /** Rebuild the optional vector index over every recallable layer. */
  reindexVectors() {
    if (!this.config.vector.enabled) return;
    const state = this.state('default');
    this.vector.rebuild([
      ...state.episodic.map((it) => ({ id: it.id, title: it.event, body: `${it.event} ${it.detail ?? ''} ${(it.participants ?? []).join(' ')}` })),
      ...state.semantic.filter((it) => it.status !== 'archived').map((it) => ({ id: it.id, title: it.object, body: `${it.subject} ${it.relation} ${it.object}` })),
      ...state.procedural.map((it) => ({ id: it.id, title: it.rule, body: it.rule })),
    ]);
  }

  load() {
    const ep = this.store.read('episodic.json', { version: 1, items: [] });
    const se = this.store.read('semantic.json', { version: 1, items: [], aliases: {} });
    const pr = this.store.read('procedural.json', { version: 1, items: [] });
    const st = this.store.read('stats.json', EMPTY_STATS());
    const ar = this.store.read('archive.json', { version: 1, items: [] });
    this.episodic = Array.isArray(ep.data?.items) ? ep.data.items : [];
    this.semantic = new SemanticMemory(se.data ?? {});
    this.procedural = new ProceduralMemory(pr.data ?? {});
    this.stats = { ...EMPTY_STATS(), ...(st.data ?? {}), counters: { ...EMPTY_STATS().counters, ...(st.data?.counters ?? {}) } };
    this.archive = Array.isArray(ar.data?.items) ? ar.data.items : [];
    for (const flag of [ep, se, pr, st, ar]) {
      if (flag.corrupt) this.warnings.push(`corrupt store file restored from backup or reset (${flag.recovered ? 'backup' : 'initial'})`);
    }
  }

  persist() {
    if (this.readOnly) return;
    this.store.write('episodic.json', { version: 1, items: this.episodic });
    this.store.write('semantic.json', this.semantic.toJSON());
    this.store.write('procedural.json', this.procedural.toJSON());
    this.store.write('stats.json', this.stats);
    this.store.write('archive.json', { version: 1, items: this.archive.slice(-2000) });
  }

  session(sessionId = 'default') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sensory: new SensoryBuffer({ capacity: this.config.sensoryCapacity, ttlMs: this.config.sensoryTtlMs }),
        working: new WorkingMemory({ capacity: this.config.workingCapacity }),
        lastActive: Date.now(),
      });
    }
    const s = this.sessions.get(sessionId);
    s.lastActive = Date.now();
    return s;
  }

  knownPeople() {
    return [...new Set(this.semantic.active().filter((it) => ['姓名', '称呼'].includes(it.relation)).map((it) => it.object))];
  }

  /**
   * Observe one user utterance: sensory parse → working topic → (gated) episodic capture
   * → optional semantic/procedural extraction.
   */
  observe(sessionId, text, now = Date.now()) {
    const session = this.session(sessionId);
    const { entry, dropped } = session.sensory.ingest(text, now, this.knownPeople());
    const topic = detectTopic(text);
    // Greetings are sensory traces only: they must not displace the real focus.
    const shelved = isSmallTalk(text) ? [] : session.working.push(topic, now).shelved;
    const gate = shouldRemember(text, entry.entities);
    let memory = null;
    let facts = [];

    if (this.config.autoCapture && gate.keep && (gate.importance ?? estimateImportance(text, entry.entities)) >= this.config.autoImportanceMin) {
      const entities = entry.entities;
      const when = parseWhen(text, now);
      memory = createEpisodic(
        {
          event: truncate(oneLine(text), 90),
          participants: entities.people,
          place: entities.places[0] ?? '',
          emotion: entities.emotions[0] ?? '',
          valence: entities.valence,
          importance: gate.importance ?? estimateImportance(text, entities),
          detail: oneLine(text),
          source: 'auto',
          when: when?.label ?? '',
          whenAt: when?.at ?? null,
        },
        now,
      );
      this.episodic.push(memory);
      this.bumpRemember(now);
      facts = this.extractSemantic(text, now);
      this.persist();
    }
    this.activity.push(
      'observe',
      {
        sessionId,
        topic,
        text: truncate(topic || oneLine(text), 40),
        entities: {
          people: entry.entities.people.slice(0, 3),
          places: entry.entities.places.slice(0, 2),
          emotions: entry.entities.emotions.slice(0, 2),
        },
        kept: memory ? { id: memory.id, layer: 'episodic', importance: memory.importance } : null,
        shelved: shelved.map((s) => s.topic ?? String(s)),
        dropped: dropped.length,
        focus: session.working.peek()?.topic ?? '',
      },
      now,
    );
    return { sensory: entry, dropped, topic, shelved, memory, gate, facts };
  }

  /** Explicit `brain_remember`. */
  remember(input, now = Date.now(), sessionId = 'default') {
    const layer = String(input.layer ?? 'episodic').toLowerCase();
    if (layer === 'episodic') {
      const item = createEpisodic(input, now);
      this.episodic.push(item);
      this.bumpRemember(now);
      this.persist();
      this.activity.push('remember', { sessionId, layer, id: item.id, importance: item.importance, title: item.event }, now);
      return { layer, item: this.decorateEpisodic(item, now), text: `已写入情景记忆：${item.event}（重要度 ${item.importance}）` };
    }
    if (layer === 'semantic') {
      const { item, corrected, duplicate } = this.semantic.add(input, now);
      this.bumpRemember(now);
      this.persist();
      this.activity.push('remember', { sessionId, layer, id: item.id, importance: item.importance ?? 3, title: `${item.subject} ${item.relation} ${item.object}` }, now);
      for (const old of corrected) {
        this.activity.push('correct', { sessionId, layer, id: old.id, replacedBy: item.id, title: `${old.subject} ${old.relation} ${old.object}` }, now);
      }
      const note = duplicate
        ? `已强化既有事实：${item.subject} → ${item.relation} → ${item.object}`
        : corrected.length > 0
          ? `已修正 ${corrected.length} 条旧事实并保留历史：${item.subject} → ${item.relation} → ${item.object}`
          : `已写入语义记忆：${item.subject} → ${item.relation} → ${item.object}`;
      return { layer, item, corrected, duplicate, text: note };
    }
    if (layer === 'procedural') {
      const { item, duplicate } = this.procedural.add(input, now);
      this.bumpRemember(now);
      this.persist();
      this.activity.push('remember', { sessionId, layer, id: item.id, importance: item.importance ?? 3, title: item.rule }, now);
      return { layer, item, duplicate, text: `${duplicate ? '已强化规则' : '已写入程序记忆'}：${item.rule}` };
    }
    throw new Error(`unknown memory layer "${layer}" (expected episodic | semantic | procedural)`);
  }

  /** 事实抽取委托给 `lib/extract.js` 的规则表；这里只负责落库。 */
  extractSemantic(text, now = Date.now()) {
    const { facts, rules } = extractFacts(text);
    for (const rule of rules) {
      this.procedural.add({ rule: rule.rule, importance: rule.importance, source: 'auto' }, now);
    }
    for (const fact of facts) {
      const { rule: _rule, ...payload } = fact;
      this.semantic.add(payload, now);
    }
    return facts.map(({ rule: _rule, ...rest }) => rest);
  }

  bumpRemember(now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10);
    this.stats.counters.remembers = (this.stats.counters.remembers ?? 0) + 1;
    this.stats.remembersByDay = this.stats.remembersByDay ?? {};
    this.stats.remembersByDay[day] = (this.stats.remembersByDay[day] ?? 0) + 1;
  }

  decorateEpisodic(item, now = Date.now()) {
    return { ...item, strength: strengthOf(item, this.config.lambda, now) };
  }

  state(sessionId = 'default', now = Date.now()) {
    const session = this.session(sessionId);
    session.sensory.sweep(now);
    return {
      lambda: this.config.lambda,
      now,
      working: session.working.stack,
      workingCapacity: session.working.capacity,
      sensory: session.sensory.snapshot(),
      episodic: withStrength(this.episodic, this.config.lambda, now),
      semantic: this.semantic.items,
      procedural: this.procedural.items,
      aliases: this.semantic.aliases,
      stats: this.statsSnapshot(sessionId, now),
    };
  }

  statsSnapshot(sessionId = 'default', now = Date.now()) {
    const session = this.session(sessionId);
    const activeSemantic = this.semantic.active();
    const total = this.episodic.length + activeSemantic.length + this.procedural.items.length;
    return {
      total,
      addedToday: addedToday(this.episodic, now) + activeSemantic.filter((it) => isToday(it.ts, now)).length,
      forgotten: this.stats.counters.forgotten ?? 0,
      consolidated: this.stats.counters.consolidated ?? 0,
      recalls: this.stats.counters.recalls ?? 0,
      activeTopics: [...new Set([...session.working.stack.map((t) => t.title), ...this.episodic.slice(-20).map((it) => it.participants?.[0]).filter(Boolean)])].slice(0, 8),
      layers: {
        sensory: session.sensory.snapshot().length,
        working: session.working.stack.length,
        episodic: this.episodic.length,
        semantic: activeSemantic.length,
        procedural: this.procedural.items.length,
      },
      lastSleepAt: this.stats.lastSleepAt,
    };
  }

  recall(query, { sessionId = 'default', topK = this.config.topK, layers } = {}) {
    const startedAt = Date.now();
    const state = this.state(sessionId);
    const records = [
      ...state.episodic.map((it) => ({ id: it.id, title: it.event, body: `${it.event} ${it.detail ?? ''} ${(it.participants ?? []).join(' ')}` })),
      ...state.semantic.filter((it) => it.status !== 'archived').map((it) => ({ id: it.id, title: it.object, body: `${it.subject} ${it.relation} ${it.object}` })),
      ...state.procedural.map((it) => ({ id: it.id, title: it.rule, body: it.rule })),
    ];
    this.vector.rebuild(records);
    const vectorScores = this.vector.search(query, 40);
    const result = recallRecords(state, query, { topK, vectorScores, layers });
    if (result.hits.length > 0) {
      const ids = new Set(result.hits.map((h) => h.id));
      for (const item of this.episodic) if (ids.has(item.id)) item.hits = (item.hits ?? 0) + 1;
      for (const item of this.procedural.items) if (ids.has(item.id)) this.procedural.touch(item.id);
      this.stats.counters.recalls = (this.stats.counters.recalls ?? 0) + 1;
      this.stats.lastRecallAt = nowIso();
      this.persist();
    }
    this.activity.push(
      'recall',
      {
        sessionId,
        query,
        hits: result.hits.map((h) => ({
          id: h.id,
          layer: h.layer,
          score: Number(h.score.toFixed(3)),
          title: h.title,
          strength: h.strength == null ? null : Number(h.strength.toFixed(2)),
          parts: h.parts
            ? {
              keyword: Number(h.parts.keyword.toFixed(3)),
              importance: Number(h.parts.importance.toFixed(3)),
              freshness: Number(h.parts.freshness.toFixed(3)),
              vector: Number((h.parts.vector ?? 0).toFixed(3)),
            }
            : null,
        })),
        took: Date.now() - startedAt,
      },
      Date.now(),
    );
    return { ...result, text: renderHits(result), vector: this.vector.status() };
  }

  forget(idToForget, now = Date.now(), sessionId = 'default') {
    const idx = this.episodic.findIndex((it) => it.id === idToForget);
    if (idx >= 0) {
      const [item] = this.episodic.splice(idx, 1);
      this.archive.push({ ...item, archivedAt: nowIso(now), reason: 'manual' });
      this.stats.counters.manualForgets = (this.stats.counters.manualForgets ?? 0) + 1;
      this.persist();
      this.activity.push('forget', { sessionId, layer: 'episodic', id: item.id, title: item.event }, now);
      return { layer: 'episodic', item };
    }
    const sem = this.semantic.forget(idToForget, now);
    if (sem) {
      this.stats.counters.manualForgets = (this.stats.counters.manualForgets ?? 0) + 1;
      this.persist();
      this.activity.push('forget', { sessionId, layer: 'semantic', id: sem.id, title: `${sem.subject} ${sem.relation} ${sem.object}` }, now);
      return { layer: 'semantic', item: sem };
    }
    const pro = this.procedural.remove(idToForget, now);
    if (pro) {
      this.archive.push({ ...pro, archivedAt: nowIso(now), reason: 'manual' });
      this.stats.counters.manualForgets = (this.stats.counters.manualForgets ?? 0) + 1;
      this.persist();
      this.activity.push('forget', { sessionId, layer: 'procedural', id: pro.id, title: pro.rule }, now);
      return { layer: 'procedural', item: pro };
    }
    return null;
  }

  /**
   * Edit a memory in place. Nothing is deleted: the item keeps its id, its original
   * timestamp and its history, and the change is written to the activity log as `edit`
   * so the instrument shows the correction happening rather than just the result.
   */
  /** 一条记忆的可编辑表面：历史版本只保存这些字段，派生量（strength 等）永不入档。 */
  static snapshotFields(item) {
    if (!item) return {};
    if (Array.isArray(item.participants) || typeof item.event === 'string') {
      return {
        event: item.event, detail: item.detail ?? '', place: item.place ?? '',
        emotion: item.emotion ?? '', participants: [...(item.participants ?? [])],
        importance: item.importance,
      };
    }
    if (typeof item.rule === 'string') {
      return { rule: item.rule, strength: item.strength, importance: item.importance };
    }
    return { object: item.object, importance: item.importance };
  }

  /** 编辑前把旧值压成 vN 快照；item.version 缺省视为 1。 */
  recordVersion(item, now, changed, beforeFields) {
    if (!item.history) item.history = [];
    item.version = item.version ?? (item.history.length + 1);
    item.history.push({
      v: item.version,
      ts: nowIso(now),
      fields: beforeFields ?? MemorySystem.snapshotFields(item),
      changed: [...changed],
    });
    item.version += 1;
    /* 历史只留最近 20 版：仪器要能追溯，但不该变成档案库 */
    if (item.history.length > 20) item.history.splice(0, item.history.length - 20);
  }

  update(idToEdit, patch = {}, now = Date.now(), sessionId = 'default') {
    const changed = [];
    const epi = this.episodic.find((it) => it.id === idToEdit);
    if (epi) {
      const before = MemorySystem.snapshotFields(epi);
      if (typeof patch.event === 'string' && patch.event.trim()) {
        epi.event = oneLine(patch.event, 200);
        changed.push('event');
      }
      if (typeof patch.detail === 'string') {
        epi.detail = truncate(patch.detail.trim(), 400);
        changed.push('detail');
      }
      if (typeof patch.place === 'string') {
        epi.place = oneLine(patch.place, 40);
        changed.push('place');
      }
      if (typeof patch.emotion === 'string') {
        epi.emotion = oneLine(patch.emotion, 20);
        changed.push('emotion');
      }
      if (Array.isArray(patch.participants)) {
        epi.participants = unique(patch.participants.map((p) => oneLine(String(p), 24)).filter(Boolean));
        changed.push('participants');
      }
      if (Number.isFinite(patch.importance)) {
        epi.importance = clamp(Math.round(patch.importance), 1, 5);
        changed.push('importance');
      }
      if (changed.length === 0) return { layer: 'episodic', item: this.decorateEpisodic(epi, now), changed };
      this.recordVersion(epi, now, changed, before);
      epi.editedAt = nowIso(now);
      epi.revisions = (epi.revisions ?? 0) + 1;
      this.persist();
      this.activity.push('edit', { sessionId, layer: 'episodic', id: epi.id, title: epi.event, fields: changed }, now);
      return { layer: 'episodic', item: this.decorateEpisodic(epi, now), changed };
    }

    const sem = this.semantic.items.find((it) => it.id === idToEdit);
    if (sem) {
      if (typeof patch.object === 'string' && patch.object.trim() && patch.object.trim() !== sem.object) {
        /* 新值当作一次新的陈述，让冲突检测把旧值标成 [已修正] 而不是就地覆盖 */
        const { item, corrected } = this.semantic.add(
          { subject: sem.subject, relation: sem.relation, object: patch.object, importance: patch.importance ?? sem.importance },
          now,
        );
        this.persist();
        this.activity.push('edit', { sessionId, layer: 'semantic', id: item.id, title: `${item.subject} ${item.relation} ${item.object}`, fields: ['object'], supersedes: sem.id }, now);
        return { layer: 'semantic', item, changed: ['object'], corrected };
      }
      if (Number.isFinite(patch.importance)) {
        sem.importance = clamp(Math.round(patch.importance), 1, 5);
        sem.editedAt = nowIso(now);
        this.persist();
        this.activity.push('edit', { sessionId, layer: 'semantic', id: sem.id, title: `${sem.subject} ${sem.relation} ${sem.object}`, fields: ['importance'] }, now);
        return { layer: 'semantic', item: sem, changed: ['importance'] };
      }
      return { layer: 'semantic', item: sem, changed: [] };
    }

    const pro = this.procedural.items.find((it) => it.id === idToEdit);
    if (pro) {
      const beforePro = MemorySystem.snapshotFields(pro);
      if (typeof patch.rule === 'string' && patch.rule.trim()) {
        pro.rule = oneLine(patch.rule, 160);
        changed.push('rule');
      }
      if (Number.isFinite(patch.strength)) {
        pro.strength = clamp(patch.strength, 0, 5);
        changed.push('strength');
      }
      if (changed.length === 0) return { layer: 'procedural', item: pro, changed };
      this.recordVersion(pro, now, changed, beforePro);
      pro.editedAt = nowIso(now);
      this.persist();
      this.activity.push('edit', { sessionId, layer: 'procedural', id: pro.id, title: pro.rule, fields: changed }, now);
      return { layer: 'procedural', item: pro, changed };
    }
    return null;
  }

  /** 版本链：v1 是入库时的样子，之后每次编辑压一版，最后一版是当前值。 */
  historyOf(idWanted, now = Date.now()) {
    const epi = this.episodic.find((it) => it.id === idWanted);
    if (epi) return { layer: 'episodic', id: epi.id, title: epi.event, versions: this.versionList(epi) };
    const pro = this.procedural.items.find((it) => it.id === idWanted);
    if (pro) return { layer: 'procedural', id: pro.id, title: pro.rule, versions: this.versionList(pro) };
    const sem = this.semantic.items.find((it) => it.id === idWanted);
    if (sem) {
      const chain = this.semantic.history(sem.subject, sem.relation);
      const total = chain.length;
      return {
        layer: 'semantic',
        id: sem.id,
        title: `${sem.subject} ${sem.relation} ${sem.object}`,
        versions: chain.map((it, i) => ({
          v: total - i,
          ts: it.ts,
          id: it.id,
          status: it.status === 'active' ? 'active' : 'corrected',
          current: it.status === 'active',
          fields: { object: it.object, importance: it.importance },
          changed: [],
        })),
      };
    }
    return null;
  }

  versionList(item) {
    const versions = (item.history ?? []).map((h) => ({
      v: h.v, ts: h.ts, fields: h.fields, changed: h.changed ?? [], status: 'past', current: false,
    }));
    versions.push({
      v: item.version ?? (versions.length + 1),
      ts: item.editedAt ?? item.ts,
      fields: MemorySystem.snapshotFields(item),
      changed: [],
      status: 'current',
      current: true,
    });
    return versions;
  }

  /** 每一条被修正的语义事实 = 一组「旧值 / 当前值」，供冲突复核面板使用。 */
  conflicts() {
    const items = this.semantic.items;
    const byId = new Map(items.map((it) => [it.id, it]));
    return items
      .filter((it) => it.status === 'corrected')
      .map((it) => {
        const live =
          (it.supersededBy ? byId.get(it.supersededBy) : null) ??
          items.find((x) => x !== it && x.subject === it.subject && x.relation === it.relation && x.status === 'active') ??
          null;
        return {
          id: it.id,
          subject: it.subject,
          relation: it.relation,
          object: it.object,
          correctedAt: it.correctedAt ?? null,
          current: live ? { id: live.id, object: live.object, ts: live.ts ?? null, importance: live.importance ?? 3 } : null,
        };
      });
  }

  /** 回滚一条被修正的事实：旧值重新生效，当前值转为 [已修正]。历史一条都不删。 */
  restoreSemantic(idToRestore, now = Date.now(), sessionId = 'default') {
    const item = this.semantic.items.find((it) => it.id === idToRestore);
    if (!item) return null;
    const live = this.semantic.items.find(
      (x) => x !== item && x.subject === item.subject && x.relation === item.relation && x.status === 'active',
    );
    if (live) {
      live.status = 'corrected';
      live.supersededBy = item.id;
      live.correctedAt = nowIso(now);
    }
    item.status = 'active';
    delete item.supersededBy;
    item.correctedAt = null;
    item.restoredAt = nowIso(now);
    item.hits = (item.hits ?? 0) + 1;
    this.persist();
    this.activity.push(
      'correct',
      { sessionId, layer: 'semantic', id: item.id, restored: true, replaced: live?.id ?? null, title: `${item.subject} ${item.relation} ${item.object}` },
      now,
    );
    return { restored: item, replaced: live ?? null };
  }

  /**
   * 按 (subject, relation) 聚合被修正的事实，配当前生效值。
   * 只读：给「废弃事实」面板用，告诉人哪一槽位堆了多少条旧值。
   */
  conflictGroups() {
    const items = this.semantic.items;
    const map = new Map();
    for (const it of items) {
      if (it.status !== 'corrected') continue;
      const key = `${it.subject}\u0000${it.relation}`;
      if (!map.has(key)) map.set(key, { subject: it.subject, relation: it.relation, corrected: [] });
      map.get(key).corrected.push({ id: it.id, object: it.object, ts: it.ts ?? null, importance: it.importance ?? 3 });
    }
    const groups = [];
    for (const g of map.values()) {
      const live = items.find((x) => x.subject === g.subject && x.relation === g.relation && x.status === 'active') ?? null;
      g.corrected.sort((a, b) => Date.parse(b.ts ?? 0) - Date.parse(a.ts ?? 0));
      groups.push({
        key: `${g.subject} → ${g.relation}`,
        subject: g.subject,
        relation: g.relation,
        current: live ? { id: live.id, object: live.object, ts: live.ts ?? null } : null,
        corrected: g.corrected,
        removable: Math.max(0, g.corrected.length - 1),
      });
    }
    groups.sort((a, b) => b.corrected.length - a.corrected.length || (a.key < b.key ? -1 : 1));
    return groups;
  }

  /**
   * 清理废弃事实：每个槽位保留最近 keep 条（默认 1，也就是只留「上一版」），
   * 其余软归档到 archive.json。dryRun 只算不写。
   */
  pruneConflicts({ subject = null, relation = null, keep = 1, dryRun = false, now = Date.now(), sessionId = 'default' } = {}) {
    const keepN = clamp(Math.trunc(Number(keep) || 0), 0, 20);
    const groups = this.conflictGroups().filter(
      (g) => (!subject || g.subject === subject) && (!relation || g.relation === relation),
    );
    const victims = [];
    for (const g of groups) {
      victims.push(...g.corrected.slice(keepN));
    }
    const report = {
      keep: keepN,
      dryRun: Boolean(dryRun),
      groups: groups.length,
      removed: victims.length,
      ids: victims.map((v) => v.id),
      byGroup: groups.map((g) => ({ key: g.key, kept: Math.min(keepN, g.corrected.length), removed: Math.max(0, g.corrected.length - keepN) })),
    };
    if (dryRun || !victims.length) return report;

    const doomed = new Set(report.ids);
    const kept = [];
    const gone = [];
    for (const it of this.semantic.items) {
      if (doomed.has(it.id)) gone.push(it);
      else kept.push(it);
    }
    this.semantic.items = kept;
    this.archive.push(
      ...gone.map((it) => ({ ...it, archivedAt: nowIso(now), reason: 'superseded', prunedAt: nowIso(now) })),
    );
    this.stats.counters.pruned = (this.stats.counters.pruned ?? 0) + gone.length;
    this.persist();
    this.activity.push(
      'prune',
      { sessionId, layer: 'semantic', count: gone.length, groups: report.groups, keep: keepN, titles: gone.slice(0, 6).map((it) => `${it.subject} ${it.relation} ${it.object}`) },
      now,
    );
    return report;
  }

  /**
   * 归档区：把 archive.json 里的条目与「被标为 archived 的语义事实」放进同一个视图，
   * 可按关键词、层级筛选。取回之前先看清楚它是什么、为什么被归档。
   */
  archiveList({ query = '', layer = null, limit = 40 } = {}) {
    const tokens = query ? tokenize(String(query)) : [];
    const rows = [];

    const layerOf = (it) => {
      if (it.event !== undefined) return 'episodic';
      if (it.rule !== undefined) return 'procedural';
      if (it.subject !== undefined) return 'semantic';
      return 'episodic';
    };
    const titleOf = (it, l) => {
      if (l === 'episodic') return it.event;
      if (l === 'procedural') return it.rule;
      return `${it.subject} → ${it.relation} → ${it.object}`;
    };

    for (const it of this.archive) {
      const l = layerOf(it);
      rows.push({
        id: it.id,
        layer: l,
        title: titleOf(it, l) || it.id,
        body: it.detail || it.rule || '',
        importance: it.importance ?? null,
        ts: it.ts ?? null,
        archivedAt: it.archivedAt ?? null,
        reason: it.reason ?? 'manual',
        source: 'archive.json',
      });
    }

    for (const it of this.semantic.items) {
      if (it.status !== 'archived') continue;
      rows.push({
        id: it.id,
        layer: 'semantic',
        title: `${it.subject} → ${it.relation} → ${it.object}`,
        body: '',
        importance: it.importance ?? null,
        ts: it.ts ?? null,
        archivedAt: it.archivedAt ?? null,
        reason: 'manual',
        source: 'semantic',
      });
    }

    let list = rows;
    if (layer) list = list.filter((it) => it.layer === layer);
    if (tokens.length) {
      list = list
        .map((it) => ({ ...it, score: overlapScore(tokens, tokenize(`${it.title} ${it.body}`)) }))
        .filter((it) => it.score > 0)
        .sort((a, b) => b.score - a.score || String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? '')));
    } else {
      list = list
        .map((it) => ({ ...it, score: 0 }))
        .sort((a, b) => String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? '')));
    }

    return {
      total: list.length,
      byLayer: {
        episodic: rows.filter((it) => it.layer === 'episodic').length,
        semantic: rows.filter((it) => it.layer === 'semantic').length,
        procedural: rows.filter((it) => it.layer === 'procedural').length,
      },
      items: list.slice(0, clamp(Number(limit) || 40, 1, 200)),
    };
  }

  /**
   * 从归档区取回一条：回到它原本的层里继续参与检索与衰减。
   * 语义事实若槽位已有生效值，就回到「已修正」的位置，而不是抢走生效位。
   */
  restoreArchived(idToRestore, now = Date.now(), sessionId = 'default') {
    const fromArchive = this.archive.findIndex((it) => it.id === idToRestore);
    let item = null;
    let layer = null;

    if (fromArchive >= 0) {
      const [raw] = this.archive.splice(fromArchive, 1);
      const restored = { ...raw, restoredAt: nowIso(now) };
      delete restored.archivedAt;
      delete restored.prunedAt;
      delete restored.reason;
      layer = restored.event !== undefined ? 'episodic' : restored.rule !== undefined ? 'procedural' : 'semantic';
      if (layer === 'episodic') {
        this.episodic.push(restored);
        item = this.decorateEpisodic(restored, now);
      } else if (layer === 'procedural') {
        this.procedural.items.push(restored);
        item = restored;
      } else {
        this.semantic.items.push(restored);
        item = restored;
      }
    } else {
      const hidden = this.semantic.items.find((it) => it.id === idToRestore && it.status === 'archived');
      if (!hidden) return null;
      const live = this.semantic.items.find(
        (it) => it.status === 'active' && it.subject === hidden.subject && it.relation === hidden.relation,
      );
      if (live) {
        hidden.status = 'corrected';
        hidden.supersededBy = live.id;
        hidden.correctedAt = nowIso(now);
        delete hidden.archivedAt;
        live.supersedes = hidden.id;
      } else {
        hidden.status = 'active';
        delete hidden.archivedAt;
      }
      hidden.restoredAt = nowIso(now);
      hidden.hits = (hidden.hits ?? 0) + 1;
      item = hidden;
      layer = 'semantic';
    }

    this.persist();
    const title =
      layer === 'episodic'
        ? item.event
        : layer === 'procedural'
          ? item.rule
          : `${item.subject} → ${item.relation} → ${item.object}`;
    this.activity.push('restore', { sessionId, layer, id: item.id, title }, now);
    return { layer, item };
  }

  /**
   * 批量取回：一次给一串 id。缺的 id 不报错，集中放进 missing 里回报。
   */
  restoreArchivedMany(idList, now = Date.now(), sessionId = 'default') {
    const ids = Array.isArray(idList) ? idList.filter((x) => typeof x === 'string' && x.trim()) : [];
    const restored = [];
    const missing = [];
    for (const idRaw of ids) {
      const idToRestore = idRaw.trim();
      const one = this.restoreArchived(idToRestore, now, sessionId);
      if (!one) { missing.push(idToRestore); continue; }
      const it = one.item;
      const title =
        one.layer === 'episodic'
          ? it.event
          : one.layer === 'procedural'
            ? it.rule
            : `${it.subject} → ${it.relation} → ${it.object}`;
      restored.push({ id: it.id, layer: one.layer, title });
    }
    return { restored, missing };
  }

  /**
   * 撤销一次取回：把它重新放回归档区（原因记作 undo），供「刚点错了」这一秒使用。
   */
  undoRestore(idToUndo, now = Date.now(), sessionId = 'default') {
    const take = (arr) => {
      const at = arr.findIndex((it) => it.id === idToUndo);
      if (at < 0) return null;
      const [item] = arr.splice(at, 1);
      return item;
    };

    let item = take(this.episodic);
    let layer = 'episodic';
    if (!item) {
      item = take(this.procedural.items);
      layer = 'procedural';
    }
    if (!item) {
      const sem = this.semantic.items.find((it) => it.id === idToUndo && it.status !== 'archived');
      if (sem) {
        item = sem;
        layer = 'semantic';
        sem.status = 'archived';
        sem.archivedAt = nowIso(now);
      }
    }
    if (!item) return null;

    if (layer !== 'semantic') {
      this.archive.push({ ...item, archivedAt: nowIso(now), reason: 'undo' });
    }
    this.persist();
    const title =
      layer === 'episodic'
        ? item.event
        : layer === 'procedural'
          ? item.rule
          : `${item.subject} → ${item.relation} → ${item.object}`;
    this.activity.push('archive', { sessionId, layer, id: item.id, title, undo: true }, now);
    return { layer, title };
  }

  /**
   * 把另一台设备导出的档案并进来（export.json 的同一形状）。
   * 只做加法：同 id / 同三元组 / 同规则的一律跳过，不会覆盖本地已有记忆。
   */
  importArchive(payload, now = Date.now(), sessionId = 'default') {
    const take = (value) => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []);
    const report = { episodic: 0, semantic: 0, procedural: 0, skipped: 0 };

    const knownEpi = new Set(this.episodic.map((it) => it.id));
    /* 跨设备合并时 id 必然不同，所以同时按「事件原文」去重，避免同一件事被带进来两遍 */
    const knownEpiText = new Set(this.episodic.map((it) => it.event));
    for (const raw of take(payload?.episodic)) {
      if (!raw || typeof raw !== 'object') {
        report.skipped += 1;
        continue;
      }
      const event = typeof raw.event === 'string' ? raw.event.trim() : '';
      if (!event) {
        report.skipped += 1;
        continue;
      }
      if (raw.id && knownEpi.has(raw.id)) {
        report.skipped += 1;
        continue;
      }
      if (knownEpiText.has(event)) {
        report.skipped += 1;
        continue;
      }
      const item = createEpisodic(
        {
          event,
          participants: Array.isArray(raw.participants) ? raw.participants : [],
          place: raw.place ?? '',
          emotion: raw.emotion ?? '',
          detail: raw.detail ?? '',
          importance: raw.importance,
          ts: raw.ts,
        },
        now,
      );
      item.source = raw.source ?? 'import';
      item.tags = unique([...(item.tags ?? []), 'imported']);
      this.episodic.push(item);
      knownEpi.add(item.id);
      knownEpiText.add(item.event);
      report.episodic += 1;
    }

    const tripleKey = (s, r, o) => `${s}\u0000${r}\u0000${o}`;
    const knownFacts = new Set(this.semantic.items.map((it) => tripleKey(it.subject, it.relation, it.object)));
    for (const raw of take(payload?.semantic)) {
      if (!raw || typeof raw !== 'object' || !raw.subject || !raw.relation || !raw.object) {
        report.skipped += 1;
        continue;
      }
      if (raw.status === 'corrected') {
        report.skipped += 1;
        continue;
      }
      if (knownFacts.has(tripleKey(raw.subject, raw.relation, raw.object))) {
        report.skipped += 1;
        continue;
      }
      const { item } = this.semantic.add(
        { subject: raw.subject, relation: raw.relation, object: raw.object, importance: raw.importance },
        now,
      );
      knownFacts.add(tripleKey(item.subject, item.relation, item.object));
      report.semantic += 1;
    }

    const knownRules = new Set(this.procedural.items.map((it) => it.rule));
    for (const raw of take(payload?.procedural)) {
      const rule = typeof raw?.rule === 'string' ? raw.rule.trim() : '';
      if (!rule || knownRules.has(rule)) {
        report.skipped += 1;
        continue;
      }
      this.procedural.add({ rule, strength: raw.strength }, now);
      knownRules.add(rule);
      report.procedural += 1;
    }

    const total = report.episodic + report.semantic + report.procedural;
    if (total > 0) {
      this.persist();
      this.activity.push('import', { sessionId, ...report }, now);
    }
    return { ...report, total };
  }

  /** Decay pass: everything below threshold and not pinned leaves the live store. */
  decayPass(now = Date.now(), sessionId = 'default') {
    const { kept, forgotten } = decay(this.episodic, { lambda: this.config.lambda, threshold: this.config.forgetThreshold, now });
    if (forgotten.length === 0) return { forgotten: 0 };
    this.episodic = kept;
    this.archive.push(...forgotten);
    this.stats.counters.forgotten = (this.stats.counters.forgotten ?? 0) + forgotten.length;
    this.persist();
    this.activity.push(
      'decay',
      { sessionId, count: forgotten.length, ids: forgotten.map((f) => f.id).slice(0, 40) },
      now,
    );
    return { forgotten: forgotten.length, ids: forgotten.map((f) => f.id) };
  }

  sleep(now = Date.now(), { minAgeHours = this.config.minConsolidationAgeHours } = {}) {
    const before = this.episodic.length;
    const result = consolidate(this.episodic, {
      lambda: this.config.lambda,
      threshold: this.config.forgetThreshold,
      now,
      minAgeHours,
    });
    this.episodic = result.items;
    this.archive.push(...result.archived);
    this.stats.counters.consolidated = (this.stats.counters.consolidated ?? 0) + result.report.migrated + result.report.compressed;
    this.stats.counters.forgotten = (this.stats.counters.forgotten ?? 0) + result.report.pruned;
    this.stats.lastSleepAt = nowIso(now);
    this.persist();
    this.activity.push(
      'consolidate',
      {
        migrated: result.report.migrated,
        compressed: result.report.compressed,
        pruned: result.report.pruned,
        digests: result.report.digests,
        before,
        after: this.episodic.length,
      },
      now,
    );
    return { ...result, before, after: this.episodic.length };
  }

  maybeSleepIdle(now = Date.now()) {
    const last = this.stats.lastSleepAt ? Date.parse(this.stats.lastSleepAt) : 0;
    const idleMs = this.config.idleConsolidationHours * 3_600_000;
    if (now - last < idleMs) return null;
    const hour = new Date(now).getHours();
    if (hour >= 7 && hour < 22 && last > 0) return null;
    const result = this.sleep(now);
    return result.report.pruned + result.report.migrated + result.report.compressed > 0 ? result : null;
  }

  visualize(sessionId = 'default', now = Date.now()) {
    return renderBrain(this.state(sessionId, now));
  }

  snapshotMarkdown(sessionId = 'default') {
    const state = this.state(sessionId);
    return toMarkdown(state, {
      version: VERSION,
      dataDir: this.config.dataDir,
      activity: this.activityDigest(20),
    });
  }

  /**
   * 最近活动的摘要，给快照/导出用：把进程内的活动流折成「能读的一行」，
   * 描述的是「刚才在查什么、写什么」，而不是记忆内容本身。
   */
  activityDigest(limit = 40) {
    const boot = this.stats?.boot ?? null;
    const events = this.activity.recent(limit).map((event) => {
      const parts = [];
      if (event.query) parts.push('「' + truncate(String(event.query), 28) + '」');
      if (event.count) parts.push(event.count + ' 条');
      if (event.keep) parts.push('每槽留 ' + event.keep);
      if (Array.isArray(event.hits)) parts.push(event.hits.length + ' 命中');
      if (Number.isFinite(event.took)) parts.push(event.took + ' ms');
      if (event.text) parts.push(truncate(String(event.text), 24));
      return {
        seq: event.seq,
        at: nowIso(event.ts),
        kind: event.kind,
        detail: parts.join(' · ') || event.kind,
      };
    });
    return {
      boot: boot ? boot.id : this.activity.boot,
      generation: boot ? boot.count : 1,
      since: boot ? boot.since : null,
      seq: this.activity.seq,
      events,
    };
  }

  exportJson(sessionId = 'default') {
    return {
      version: VERSION,
      exportedAt: nowIso(),
      config: { lambda: this.config.lambda, forgetThreshold: this.config.forgetThreshold },
      stats: this.state(sessionId).stats,
      episodic: this.episodic,
      semantic: this.semantic.items,
      procedural: this.procedural.items,
      aliases: this.semantic.aliases,
      /* 最近的活动流：跨设备移植时连「刚才在查什么」一起带走；只读上下文，导入时忽略 */
      activity: this.activityDigest(40),
    };
  }

  apiState(sessionId = 'default', now = Date.now()) {
    const state = this.state(sessionId, now);
    const layerName = { sensory: '感觉记忆', working: '工作记忆', episodic: '情景记忆', semantic: '语义记忆', procedural: '程序记忆' };
    const color = { sensory: '#67e8f9', working: '#a78bfa', episodic: '#f472b6', semantic: '#34d399', procedural: '#fbbf24' };
    const regions = {};
    for (const key of ['sensory', 'working', 'episodic', 'semantic', 'procedural']) {
      regions[key] = { label: layerName[key], count: state.stats.layers[key], color: color[key] };
    }
    // `ageDays` / `salience` are derived (never persisted): they let a client draw
    // every engram on the same 0..1 scale, and let the time-travel slider ask the
    // server for `?at=` so fading is computed by the same strengthOf() as recall.
    const ageDaysOf = (ts) => {
      const t = Date.parse(ts);
      return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : 0;
    };
    const ttl = this.config.sensoryTtlMs;
    const threshold = this.config.forgetThreshold;
    const lambda = this.config.lambda;
    // `forgetInDays` is the honest forecast: the instant strength(t) == threshold
    // solved from strength = importance * exp(-lambda * ageDays). Pinned items never cross it.
    const forecastOf = (item) => {
      if ((item.importance ?? 0) >= PINNED_IMPORTANCE) return null;
      const ageDays = ageDaysOf(item.ts);
      const critical = Math.log(Math.max(item.importance ?? 1, 0.01) / threshold) / lambda;
      return Math.max(0, Number((critical - ageDays).toFixed(2)));
    };
    return {
      ok: true,
      generatedAt: nowIso(now),
      at: now,
      sessionId,
      lambda: state.lambda,
      forgetThreshold: threshold,
      pinnedImportance: PINNED_IMPORTANCE,
      stats: state.stats,
      sensory: state.sensory.map((it) => ({
        ...it,
        ageDays: ageDaysOf(it.ts ?? now),
        salience: clamp(1 - (it.ageMs ?? 0) / ttl, 0, 1),
      })),
      working: { capacity: state.workingCapacity, stack: state.working },
      episodic: state.episodic.map((it) => ({
        ...it,
        ageDays: ageDaysOf(it.ts),
        salience: clamp(it.strength / 5, 0, 1),
        pinned: (it.importance ?? 0) >= PINNED_IMPORTANCE,
        forgetInDays: forecastOf(it),
      })),      semantic: state.semantic.map((it) => ({
        ...it,
        ageDays: ageDaysOf(it.ts),
        salience: clamp(0.3 + 0.45 * Math.min(1, (it.hits ?? 0) / 4) + 0.25 * ((it.importance ?? 3) / 5), 0, 1),
      })),
      procedural: state.procedural.map((it) => ({
        ...it,
        ageDays: ageDaysOf(it.ts),
        salience: clamp(0.35 + 0.45 * Math.min(1, (it.strength ?? 1) / 5) + 0.2 * Math.min(1, (it.hits ?? 0) / 4), 0, 1),
      })),
      regions,
      activitySeq: this.activity.seq,
      lastEvent: this.activity.recent(1)[0] ?? null,
    };
  }

  promptBlock(sessionId = 'default', now = Date.now()) {
    const state = this.state(sessionId, now);
    const top = state.working[0];
    const strong = [...state.episodic].sort((a, b) => b.strength - a.strength).slice(0, 6);
    const lines = [];
    lines.push('你拥有一个持久化的类人生物大脑（五层记忆：感觉 / 工作 / 情景 / 语义 / 程序）。铁律：');
    lines.push('① 回答前先调用 brain_recall 检索相关记忆，禁止凭空“想起”；检索不到就明说没有记录。');
    lines.push('② 用户给出姓名 / 日期 / 承诺 / 偏好时，立即调用 brain_remember 写入对应层。');
    lines.push('③ 提到旧话题时自然带出过往细节（“你之前说过……”），但只使用检索到的内容。');
    lines.push('④ 记忆冲突时用 brain_remember 叠加新事实，旧事实会自动标记 [已修正]，永不物理删除。');
    lines.push('⑤ 重要度 ≥ 4 的记忆永不忘，低价值记忆随时间自然衰减；不要假装记得已被遗忘的事。');
    if (top) lines.push(`当前焦点（工作记忆栈顶）：${top.title}`);
    if (state.working.length > 1) lines.push(`话题栈（旧→新）：${state.working.map((t) => t.title).reverse().join(' → ')}`);
    const rules = this.procedural.promptBlock(8);
    if (rules) {
      lines.push('用户习惯 / 规则（程序记忆，作为默认行为）：');
      lines.push(rules);
    }
    const facts = state.semantic
      .filter((it) => it.status === 'active')
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
      .slice(0, 8);
    if (facts.length > 0) {
      lines.push('长期事实（语义记忆；与用户当前说法冲突时以新说法为准并标记 [已修正]）：');
      for (const it of facts) lines.push(`- ${it.subject} → ${it.relation} → ${it.object}`);
      const corrected = state.semantic.filter((it) => it.status === 'corrected').length;
      if (corrected > 0) lines.push(`（另有 ${corrected} 条旧事实已修正，brain_recall 可查历史版本）`);
    }
    if (strong.length > 0) {
      lines.push('高权重情景记忆（按当前强度，仅供对齐语气与上下文，不必逐条复述）：');
      for (const it of strong) {
        const people = it.participants?.length ? `｜参与者 ${it.participants.join('、')}` : '';
        const place = it.place ? `｜地点 ${it.place}` : '';
        lines.push(`- ${new Date(it.ts).toISOString().slice(0, 10)} ${truncate(it.event, 60)}（重要度 ${it.importance}，强度 ${it.strength.toFixed(2)}${people}${place}）`);
      }
    }
    const aliases = Object.entries(state.aliases ?? {}).slice(0, 10);
    if (aliases.length > 0) lines.push(`实体归一：${aliases.map(([a, b]) => `${a}=${b}`).join('，')}`);
    lines.push(`记忆文件：${this.config.dataDir}（brain_visualize 可查看脑图，brain_snapshot 可导出档案）。`);
    return lines.join('\n');
  }

  seedDemo() {
    const demo = buildDemoMemories();
    const seen = new Set(this.episodic.filter((it) => it.source === 'demo').map((it) => it.event));
    for (const ep of demo.episodic) {
      if (seen.has(ep.event)) continue;
      this.episodic.push(createEpisodic(ep, Date.now()));
    }
    for (const sem of demo.semantic) this.semantic.add(sem);
    for (const pro of demo.procedural) this.procedural.add(pro);
    this.persist();
    return demo;
  }
}

/** Shared 20-item demo dataset (the same shape the front-ends embed). */
export function buildDemoMemories(now = Date.now()) {
  const d = (daysAgo, hour = 10) => {
    const date = new Date(now - daysAgo * 86_400_000);
    date.setHours(hour, (daysAgo * 7) % 60, 0, 0);
    return date.toISOString();
  };
  const episodic = [
    { event: '和张伟在望京开会，讨论排期', participants: ['张伟'], place: '望京', emotion: '紧张', importance: 5, ts: d(1, 15), detail: '会议延期到周五，需要重排迭代计划', source: 'demo' },
    { event: '提交了插件架构第一版设计稿', participants: [], place: '家', emotion: '兴奋', importance: 4, ts: d(2, 22), detail: '五层记忆 + ASCII 脑图', source: 'demo' },
    { event: '和妈妈通电话，聊到周末回家吃饭', participants: ['妈妈'], place: '', emotion: '温暖', importance: 4, ts: d(3, 20), detail: '周日中午', source: 'demo' },
    { event: '跑步 5 公里，配速 5′40″', participants: [], place: '奥森公园', emotion: '平静', importance: 3, ts: d(4, 7), detail: '天气转凉', source: 'demo' },
    { event: '咖啡馆偶遇大学同学李雪', participants: ['李雪'], place: '三里屯', emotion: '惊喜', importance: 4, ts: d(5, 16), detail: '她现在做产品经理', source: 'demo' },
    { event: '代码评审被指出检索排序问题', participants: ['王工'], place: '公司', emotion: '沮丧', importance: 3, ts: d(6, 14), detail: '衰减权重应乘在重要度上', source: 'demo' },
    { event: '读完《认知心理学》第 7 章', participants: [], place: '', emotion: '满足', importance: 3, ts: d(7, 23), detail: '工作记忆容量 4±1', source: 'demo' },
    { event: '给猫换了新的猫砂盆', participants: [], place: '家', emotion: '无奈', importance: 2, ts: d(8, 19), detail: '', source: 'demo' },
    { event: '和房东确认下季度房租', participants: ['房东'], place: '', emotion: '焦虑', importance: 4, ts: d(9, 11), detail: '涨了 200', source: 'demo' },
    { event: '团队聚餐，喝了半杯啤酒', participants: ['张伟', '王工'], place: '望京', emotion: '放松', importance: 2, ts: d(11, 19), detail: '', source: 'demo' },
    { event: '把周报拖延到最后一刻', participants: [], place: '公司', emotion: '愧疚', importance: 2, ts: d(12, 18), detail: '', source: 'demo' },
    { event: '第一次跑通 Three.js 大脑渲染', participants: [], place: '', emotion: '兴奋', importance: 5, ts: d(13, 1), detail: '半透明材质效果超出预期', source: 'demo' },
  ];
  const semantic = [
    { subject: '用户', relation: '职业', object: '产品设计师', importance: 5, ts: d(40) },
    { subject: '用户', relation: '居住地', object: '北京', importance: 4, ts: d(60) },
    { subject: '张伟', relation: '身份', object: '同事 / 项目经理', importance: 4, ts: d(20) },
    { subject: '用户', relation: '喜欢', object: '黑咖啡', importance: 3, ts: d(30) },
  ];
  const procedural = [
    { rule: '回答先给结论，再给理由', importance: 5, ts: d(25) },
    { rule: '代码示例用 TypeScript，不要省略 import', importance: 4, ts: d(18) },
  ];
  return { episodic, semantic, procedural };
}

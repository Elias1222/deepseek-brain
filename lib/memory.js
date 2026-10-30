import path from 'node:path';
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
import { clamp, isToday, nowIso, oneLine, truncate } from './util.js';

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
  cfg.dataDir = resolveDataDir(cfg.dataDir);
  return cfg;
}

const EMPTY_STATS = () => ({
  version: 1,
  createdAt: nowIso(),
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
    await this.vector.init({ dir: path.join(this.config.dataDir, 'vectors'), records: [] });
    if (this.vector.warning) this.warnings.push(this.vector.warning);
    if (this.config.demoSeed && this.episodic.length === 0) this.seedDemo();
    this.reindexVectors();
    this.ready = true;
    return this;
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

    if (this.config.autoCapture && gate.keep && (gate.importance ?? estimateImportance(text, entry.entities)) >= this.config.autoImportanceMin) {
      const entities = entry.entities;
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
        },
        now,
      );
      this.episodic.push(memory);
      this.bumpRemember(now);
      this.extractSemantic(text, now);
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
    return { sensory: entry, dropped, topic, shelved, memory, gate };
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

  extractSemantic(text, now = Date.now()) {
    const raw = oneLine(text);
    const found = [];
    const name = raw.match(/(?:我叫|我的名字(?:是|叫)?)([\u4e00-\u9fa5]{2,4})/);
    if (name) found.push({ subject: '用户', relation: '姓名', object: name[1], importance: 5 });
    const job = raw.match(/我?(?:是一名|是|做|从事)([\u4e00-\u9fa5A-Za-z]{2,12}(?:师|员|生|家|工程师|经理|总监|老板))/);
    if (job) found.push({ subject: '用户', relation: '职业', object: job[1], importance: 4 });
    const likes = raw.match(/我(?:喜欢|爱上|偏好|最爱)([\u4e00-\u9fa5A-Za-z0-9]{1,16})/);
    if (likes && !/吗|呢/.test(raw)) found.push({ subject: '用户', relation: '喜欢', object: likes[1], importance: 3 });
    const city = raw.match(/我(?:住在|家在|来自)([\u4e00-\u9fa5]{2,10})/);
    if (city) found.push({ subject: '用户', relation: '居住地', object: city[1], importance: 4 });
    const reminder = raw.match(/(?:记住|记一下|以后都|以后要)[:：,，\s]*(.{2,80})/);
    if (reminder) {
      this.procedural.add({ rule: reminder[1], importance: 4, source: 'auto' }, now);
    }
    for (const fact of found) {
      this.semantic.add({ ...fact, source: 'auto' }, now);
    }
    return found;
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
    return toMarkdown(state, { version: VERSION, dataDir: this.config.dataDir });
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

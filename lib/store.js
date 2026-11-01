import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BACKUPS = 7;

/**
 * Layered JSON store under ~/.deepseek-brain.
 *
 * Every durable file is written through a temp file + rename, and the previous
 * revision is rotated into `backups/` first. A corrupt file is never lost: it is
 * renamed to `*.corrupt-<ts>` and the newest readable backup is restored instead.
 */
export class Store {
  constructor(dir, { backupCount = MAX_BACKUPS } = {}) {
    this.dir = dir;
    this.backupCount = Math.max(1, Math.min(50, Number(backupCount) || MAX_BACKUPS));
    this.backupDir = path.join(dir, 'backups');
    this.snapshotDir = path.join(dir, 'snapshots');
  }

  ensure() {
    for (const d of [this.dir, this.backupDir, this.snapshotDir]) {
      fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    }
    return this;
  }

  file(name) {
    return path.join(this.dir, name);
  }

  exists(name) {
    return fs.existsSync(this.file(name));
  }

  /**
   * @returns {{ data: any, recovered: boolean, corrupt: boolean }}
   */
  read(name, fallback) {
    const target = this.file(name);
    if (!fs.existsSync(target)) return { data: structuredCloneSafe(fallback), recovered: false, corrupt: false };
    try {
      return { data: JSON.parse(fs.readFileSync(target, 'utf8')), recovered: false, corrupt: false };
    } catch {
      const corruptPath = `${target}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(target, corruptPath);
      } catch {
        /* best effort */
      }
      const restored = this.newestBackup(name);
      if (restored) {
        try {
          return { data: JSON.parse(fs.readFileSync(restored, 'utf8')), recovered: true, corrupt: true };
        } catch {
          /* fall through */
        }
      }
      return { data: structuredCloneSafe(fallback), recovered: false, corrupt: true };
    }
  }

  write(name, data) {
    this.ensure();
    const target = this.file(name);
    if (fs.existsSync(target)) this.rotate(name);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    try {
      fs.renameSync(tmp, target);
    } catch {
      // Windows cannot always replace an existing target in one step.
      try {
        fs.rmSync(target, { force: true });
      } catch {
        /* ignore */
      }
      fs.renameSync(tmp, target);
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(target, 0o600);
      } catch {
        /* ignore */
      }
    }
    return target;
  }

  rotate(name) {
    const target = this.file(name);
    if (!fs.existsSync(target)) return;
    this.ensure();
    const newest = this.backups(name)[0];
    // Chatty sessions would otherwise produce one backup per message; keep
    // recovery granularity at ~20 s without flooding the directory.
    if (newest && Date.now() - newest.mtime < 20_000) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = name.replace(/\.json$/i, '');
    const dest = path.join(this.backupDir, `${base}.${stamp}.json`);
    try {
      fs.copyFileSync(target, dest);
    } catch {
      return;
    }
    this.pruneBackups(name);
  }

  backups(name) {
    if (!fs.existsSync(this.backupDir)) return [];
    const base = name.replace(/\.json$/i, '');
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.startsWith(`${base}.`) && f.endsWith('.json'))
      .map((f) => {
        const full = path.join(this.backupDir, f);
        const st = fs.statSync(full);
        return { name: f, path: full, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  pruneBackups(name) {
    const list = this.backups(name);
    for (const extra of list.slice(this.backupCount)) {
      try {
        fs.rmSync(extra.path, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  newestBackup(name) {
    const list = this.backups(name);
    return list.length > 0 ? list[0].path : null;
  }

  restore(name, backupName) {
    const list = this.backups(name);
    const pick = backupName ? list.find((b) => b.name === backupName) : list[0];
    if (!pick) return null;
    const data = JSON.parse(fs.readFileSync(pick.path, 'utf8'));
    this.write(name, data);
    return data;
  }

  /**
   * 数据目录的独占锁：同一个目录只允许一个进程写。
   * 用 'wx' 创建 brain.lock（拿不到就是别人的），锁里写 pid / 时间 / 主机名；
   * 持锁进程已经不在（崩溃残留）或锁文件太旧，就抢过来。
   * 返回 { ok, holder?, stolen? }——调用方决定是拒写还是降级为只读。
   */
  acquireLock(now = Date.now(), { staleMs = 6 * 60 * 60 * 1000 } = {}) {
    this.ensure();
    const file = path.join(this.dir, 'brain.lock');
    const payload = JSON.stringify({ pid: process.pid, at: now, host: os.hostname() }, null, 2);
    const write = () => fs.writeFileSync(file, payload, { flag: 'wx', mode: 0o600 });
    try {
      write();
      return { ok: true, path: file };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      holder = null;
    }
    /* 同一个进程再次打开同一目录（比如插件重复加载）：这是自己人，直接放行 */
    if (holder && holder.pid === process.pid) {
      return { ok: true, path: file, mine: true };
    }
    const alive = holder && Number.isFinite(holder.pid) ? pidAlive(holder.pid) : false;
    const stale = !holder || !alive || now - Number(holder.at) > staleMs;
    if (stale) {
      try {
        fs.rmSync(file, { force: true });
        write();
        return { ok: true, path: file, stolen: holder ? { pid: holder.pid, at: holder.at } : null };
      } catch {
        /* 抢锁失败：多半是别人刚好也抢到了 */
      }
    }
    return { ok: false, path: file, holder };
  }

  /** 轮询等待锁：给第二个实例一个排队的机会，超时就放弃（调用方降级只读） */
  waitForLock(now = Date.now(), { timeoutMs = 8000, intervalMs = 400 } = {}) {
    const deadline = now + Math.max(0, timeoutMs);
    const attempt = () => {
      const got = this.acquireLock();
      if (got.ok) return Promise.resolve(got);
      if (Date.now() >= deadline) return Promise.resolve(got);
      /* 排队期间必须让进程活着：这里的定时器不能 unref */
      return new Promise((resolve) => {
        setTimeout(() => resolve(attempt()), intervalMs);
      });
    };
    return attempt();
  }

  releaseLock() {
    const file = path.join(this.dir, 'brain.lock');
    try {
      const holder = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (holder && holder.pid === process.pid) fs.rmSync(file, { force: true });
    } catch {
      /* 锁不在了就什么都不用做 */
    }
  }

  lockHolder() {
    const file = path.join(this.dir, 'brain.lock');
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Write a timestamped snapshot file and return its absolute path. */
  /** 追加一条活动事件到 activity.jsonl（只允许持锁进程调用）。 */
  appendActivity(event, { max = 400 } = {}) {
    this.ensure();
    const file = this.file('activity.jsonl');
    let lines = [];
    if (this.exists('activity.jsonl')) {
      lines = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '');
    }
    lines.push(JSON.stringify(event));
    if (lines.length > max) lines = lines.slice(-max);
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    return event;
  }

  /** 读回最近 limit 条活动事件（解析失败的行直接跳过）。 */
  readActivity({ limit = 200 } = {}) {
    if (!this.exists('activity.jsonl')) return [];
    const raw = fs.readFileSync(this.file('activity.jsonl'), 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      const text = line.trim();
      if (!text) continue;
      try {
        out.push(JSON.parse(text));
      } catch {
        /* 半行写入（进程被杀）不影响其它行 */
      }
    }
    return out.slice(-Math.max(1, limit));
  }

  writeSnapshot(name, content) {
    this.ensure();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(this.snapshotDir, `${name}-${stamp}.md`);
    fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
  }

  writeExport(name, content) {
    this.ensure();
    const file = path.join(this.snapshotDir, name);
    fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
  }
}

function structuredCloneSafe(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/** Resolve the brain directory: explicit config > env > ~/.deepseek-brain. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    /* EPERM 说明进程在，只是不归我们管 */
    return error && error.code === 'EPERM';
  }
}

export function resolveDataDir(configured) {
  const raw = String(configured ?? '').trim();
  if (raw) return raw.startsWith('~') ? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', raw.slice(1)) : path.resolve(raw);
  const env = String(process.env.DEEPSEEK_BRAIN_DIR ?? '').trim();
  if (env) return path.resolve(env);
  return path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.deepseek-brain');
}

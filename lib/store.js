import fs from 'node:fs';
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

  /** Write a timestamped snapshot file and return its absolute path. */
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
export function resolveDataDir(configured) {
  const raw = String(configured ?? '').trim();
  if (raw) return raw.startsWith('~') ? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', raw.slice(1)) : path.resolve(raw);
  const env = String(process.env.DEEPSEEK_BRAIN_DIR ?? '').trim();
  if (env) return path.resolve(env);
  return path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.deepseek-brain');
}

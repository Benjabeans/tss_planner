import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Catalog, RawTerm } from '../../shared/src/types.ts';

export interface TermSyncState {
  syncedAt: string | null;
  refreshedAt: string | null;
  status: 'idle' | 'syncing' | 'ok' | 'error';
  error?: string;
  durationMs?: number;
  courseCount?: number;
  progress?: { done: number; total: number };
}

export interface Meta {
  terms: RawTerm[];
  termsFetchedAt: string | null;
  sync: Record<string, TermSyncState>;
}

interface CachedCatalog {
  body: string;
  etag: string;
  gzip: Buffer;
  syncedAt: string;
  mtimeMs: number;
}

/** File-backed catalog store with atomic writes and an in-memory cache. */
export class Store {
  readonly dir: string;
  private cache = new Map<string, CachedCatalog>();
  private meta: Meta;
  private metaMtimeMs = 0;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(path.join(dir, 'catalog'), { recursive: true });
    mkdirSync(path.join(dir, 'raw'), { recursive: true });
    this.meta = this.readMeta();
    // A crash mid-sync must not leave a term stuck in "syncing".
    for (const s of Object.values(this.meta.sync)) if (s.status === 'syncing') s.status = 'idle';
  }

  private writeAtomic(file: string, data: string | Buffer): void {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  }

  private get metaFile(): string {
    return path.join(this.dir, 'meta.json');
  }

  private readMeta(): Meta {
    if (!existsSync(this.metaFile)) return { terms: [], termsFetchedAt: null, sync: {} };
    try {
      this.metaMtimeMs = statSync(this.metaFile).mtimeMs;
      return JSON.parse(readFileSync(this.metaFile, 'utf8')) as Meta;
    } catch {
      return { terms: [], termsFetchedAt: null, sync: {} };
    }
  }

  /** Another process (e.g. `npm run sync` next to `npm run dev`) may have written meta.json. */
  private refreshMeta(): void {
    if (existsSync(this.metaFile) && statSync(this.metaFile).mtimeMs !== this.metaMtimeMs) this.meta = this.readMeta();
  }

  getMeta(): Meta {
    this.refreshMeta();
    return this.meta;
  }

  updateMeta(fn: (m: Meta) => void): void {
    this.refreshMeta();
    fn(this.meta);
    this.writeAtomic(this.metaFile, JSON.stringify(this.meta, null, 2));
    this.metaMtimeMs = statSync(this.metaFile).mtimeMs;
  }

  setSyncState(code: string, patch: Partial<TermSyncState>): void {
    this.updateMeta((m) => {
      m.sync[code] = { syncedAt: null, refreshedAt: null, status: 'idle', ...m.sync[code], ...patch };
    });
  }

  catalogPath(code: string): string {
    return path.join(this.dir, 'catalog', `${code}.json`);
  }

  hasCatalog(code: string): boolean {
    return existsSync(this.catalogPath(code));
  }

  writeCatalog(catalog: Catalog): void {
    const body = JSON.stringify(catalog);
    const file = this.catalogPath(catalog.term.code);
    this.writeAtomic(file, body);
    this.cache.set(catalog.term.code, this.toCached(body, catalog.term.syncedAt, statSync(file).mtimeMs));
  }

  /** Serialized catalog + ETag, cached in memory and reloaded if the file changed on disk. */
  readCatalog(code: string): CachedCatalog | null {
    const file = this.catalogPath(code);
    if (!existsSync(file)) return null;
    const mtimeMs = statSync(file).mtimeMs;
    const cached = this.cache.get(code);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    const body = readFileSync(file, 'utf8');
    const syncedAt = (JSON.parse(body) as Catalog).term.syncedAt;
    const entry = this.toCached(body, syncedAt, mtimeMs);
    this.cache.set(code, entry);
    return entry;
  }

  private toCached(body: string, syncedAt: string, mtimeMs: number): CachedCatalog {
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    return { body, etag, gzip: gzipSync(body), syncedAt, mtimeMs };
  }

  writeRawSnapshot(code: string, raw: unknown, keep: number): string {
    const dir = path.join(this.dir, 'raw', code);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
    this.writeAtomic(file, gzipSync(JSON.stringify(raw)));
    const old = readdirSync(dir)
      .filter((f) => f.endsWith('.json.gz'))
      .sort()
      .slice(0, -keep);
    for (const f of old) rmSync(path.join(dir, f));
    return file;
  }

}

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
}

/** File-backed catalog store with atomic writes and an in-memory cache. */
export class Store {
  readonly dir: string;
  private cache = new Map<string, CachedCatalog>();
  private meta: Meta;

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

  private readMeta(): Meta {
    const file = path.join(this.dir, 'meta.json');
    if (!existsSync(file)) return { terms: [], termsFetchedAt: null, sync: {} };
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Meta;
    } catch {
      return { terms: [], termsFetchedAt: null, sync: {} };
    }
  }

  getMeta(): Meta {
    return this.meta;
  }

  updateMeta(fn: (m: Meta) => void): void {
    fn(this.meta);
    this.writeAtomic(path.join(this.dir, 'meta.json'), JSON.stringify(this.meta, null, 2));
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
    this.writeAtomic(this.catalogPath(catalog.term.code), body);
    this.cache.set(catalog.term.code, this.toCached(body, catalog.term.syncedAt));
  }

  /** Serialized catalog + ETag, cached in memory. */
  readCatalog(code: string): CachedCatalog | null {
    const file = this.catalogPath(code);
    if (!existsSync(file)) return null;
    const cached = this.cache.get(code);
    if (cached) return cached;
    const body = readFileSync(file, 'utf8');
    const syncedAt = (JSON.parse(body) as Catalog).term.syncedAt;
    const entry = this.toCached(body, syncedAt);
    this.cache.set(code, entry);
    return entry;
  }

  private toCached(body: string, syncedAt: string): CachedCatalog {
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    return { body, etag, gzip: gzipSync(body), syncedAt };
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

  catalogMtime(code: string): Date | null {
    const file = this.catalogPath(code);
    return existsSync(file) ? statSync(file).mtime : null;
  }
}

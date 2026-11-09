import { normalizeCatalog } from '../../shared/src/normalize.ts';
import type { RawTerm } from '../../shared/src/types.ts';
import type { UcsdClient } from './upstream/ucsd.ts';
import type { Store } from './store.ts';

export interface SyncerOptions {
  client: UcsdClient;
  store: Store;
  seatRefreshMin: number;
  rawSnapshotsToKeep: number;
  log?: (msg: string) => void;
}

/**
 * Keeps local catalogs fresh. Requests are strictly sequential; a term is re-fetched when
 * it is new, when upstream's last_full_refresh_at changes, or when seats are stale.
 */
export class Syncer {
  private running: Promise<void> | null = null;
  /** Terms explicitly requested; survive a tick that is already in progress. */
  private pending = new Set<string>();
  private rerun = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly o: SyncerOptions;

  constructor(opts: SyncerOptions) {
    this.o = opts;
  }

  private log(msg: string) {
    (this.o.log ?? console.log)(`[sync] ${msg}`);
  }

  /**
   * One pass: refresh the term list, then sync whichever terms need it. Never overlaps:
   * a call during a running pass queues its forced terms and runs another pass afterwards.
   */
  tick(opts: { force?: string[] } = {}): Promise<void> {
    for (const c of opts.force ?? []) this.pending.add(c);
    if (this.running) {
      if (opts.force?.length) this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        const force = [...this.pending];
        this.pending.clear();
        await this.runTick({ force });
      } while (this.rerun || this.pending.size > 0);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  private async runTick({ force = [] }: { force?: string[] }): Promise<void> {
    let terms: RawTerm[];
    try {
      terms = await this.o.client.terms();
      this.o.store.updateMeta((m) => {
        m.terms = terms;
        m.termsFetchedAt = new Date().toISOString();
      });
    } catch (err) {
      this.log(`term list failed: ${(err as Error).message}`);
      terms = this.o.store.getMeta().terms;
      if (terms.length === 0) return;
    }

    for (const t of terms.filter((x) => x.configured !== false)) {
      const reason = force.includes(t.term_code) ? 'requested' : this.needsSync(t);
      if (!reason) continue;
      await this.syncTerm(t, reason);
    }
    // Forced terms upstream didn't list: try anyway, so the failure is recorded rather than silent.
    for (const code of force.filter((c) => !terms.some((t) => t.term_code === c))) {
      await this.syncTerm({ term_code: code, last_full_refresh_at: null }, 'requested (not in upstream term list)');
    }
  }

  needsSync(t: RawTerm): string | null {
    const state = this.o.store.getMeta().sync[t.term_code];
    if (!this.o.store.hasCatalog(t.term_code) || !state?.syncedAt) return 'no local catalog';
    if (t.last_full_refresh_at && t.last_full_refresh_at !== state.refreshedAt) return 'upstream refreshed';
    const ageMin = (Date.now() - Date.parse(state.syncedAt)) / 60_000;
    if (ageMin >= this.o.seatRefreshMin) return `seats ${Math.round(ageMin)}m old`;
    return null;
  }

  async syncTerm(t: RawTerm | { term_code: string; last_full_refresh_at: string | null }, reason = 'manual'): Promise<void> {
    const code = t.term_code;
    const started = Date.now();
    this.log(`${code}: syncing (${reason})`);
    this.o.store.setSyncState(code, { status: 'syncing', error: undefined, progress: { done: 0, total: 0 } });
    try {
      const subjects = await this.o.client.subjects(code);
      let lastLogged = 0;
      const courses = await this.o.client.allCourses(code, (done, total) => {
        this.o.store.setSyncState(code, { progress: { done, total } });
        if (done - lastLogged >= 480 || done === total) {
          lastLogged = done;
          this.log(`${code}: ${done}/${total}`);
        }
      });
      if (courses.length === 0) throw new Error('upstream returned zero courses; keeping previous catalog');
      this.o.store.writeRawSnapshot(code, { term: t, subjects, courses }, this.o.rawSnapshotsToKeep);
      const syncedAt = new Date().toISOString();
      const catalog = normalizeCatalog({ term: t, courses, subjects, syncedAt });
      this.o.store.writeCatalog(catalog);
      const durationMs = Date.now() - started;
      this.o.store.setSyncState(code, {
        status: 'ok',
        syncedAt,
        refreshedAt: t.last_full_refresh_at,
        durationMs,
        courseCount: catalog.courses.length,
        progress: undefined,
      });
      this.log(`${code}: ok — ${catalog.courses.length} courses in ${(durationMs / 1000).toFixed(1)}s`);
    } catch (err) {
      const message = (err as Error).message;
      this.o.store.setSyncState(code, { status: 'error', error: message, durationMs: Date.now() - started, progress: undefined });
      this.log(`${code}: FAILED — ${message}`);
    }
  }

  start(intervalMin: number): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMin * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

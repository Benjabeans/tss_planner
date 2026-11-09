import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

const num = (v: string | undefined, fallback: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : fallback);

export const config = {
  repoRoot,
  port: num(process.env.PORT, 8787),
  host: process.env.HOST ?? '127.0.0.1',
  production: process.env.NODE_ENV === 'production',
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(repoRoot, 'data'),
  webDist: path.join(repoRoot, 'web', 'dist'),
  upstreamBase: process.env.UPSTREAM_BASE ?? 'https://classplanner.apps.ucsd.edu',
  userAgent: process.env.UPSTREAM_USER_AGENT ?? 'tss-planner/0.1 (personal course planner; polite sync)',
  /** Delay between upstream requests during a sync. */
  requestDelayMs: num(process.env.SYNC_REQUEST_DELAY_MS, 700),
  /** How often to poll the term list for changes. */
  pollIntervalMin: num(process.env.SYNC_POLL_MIN, 15),
  /** Re-sync a term at least this often (seat counts). */
  seatRefreshMin: num(process.env.SYNC_SEAT_REFRESH_MIN, 60),
  syncEnabled: process.env.SYNC !== 'off',
  rawSnapshotsToKeep: num(process.env.SYNC_KEEP_RAW, 5),
};

export type Config = typeof config;

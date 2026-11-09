/**
 * One-shot sync: `npm run sync` (all terms that need it) or `npm run sync -- WI27 FA26` (force).
 */
import { config } from './config.ts';
import { Store } from './store.ts';
import { Syncer } from './sync.ts';
import { UcsdClient } from './upstream/ucsd.ts';

const force = process.argv.slice(2).map((s) => s.toUpperCase());
const store = new Store(config.dataDir);
const syncer = new Syncer({
  client: new UcsdClient({ baseUrl: config.upstreamBase, userAgent: config.userAgent, requestDelayMs: config.requestDelayMs }),
  store,
  seatRefreshMin: config.seatRefreshMin,
  rawSnapshotsToKeep: config.rawSnapshotsToKeep,
});

await syncer.tick({ force });
const failed = Object.entries(store.getMeta().sync).filter(([, s]) => s.status === 'error');
for (const [code, s] of failed) console.error(`${code}: ${s.error}`);
process.exit(failed.length ? 1 : 0);

import { serve } from '@hono/node-server';
import { config } from './config.ts';
import { Store } from './store.ts';
import { Syncer } from './sync.ts';
import { UcsdClient } from './upstream/ucsd.ts';
import { createApp } from './app.ts';

const store = new Store(config.dataDir);
const client = new UcsdClient({
  baseUrl: config.upstreamBase,
  userAgent: config.userAgent,
  requestDelayMs: config.requestDelayMs,
});
const syncer = new Syncer({
  client,
  store,
  seatRefreshMin: config.seatRefreshMin,
  rawSnapshotsToKeep: config.rawSnapshotsToKeep,
});

const app = createApp({
  store,
  syncer,
  production: config.production,
  webDist: config.production ? config.webDist : undefined,
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[server] listening on http://${config.host}:${info.port} (data: ${config.dataDir})`);
  if (config.syncEnabled) {
    console.log(`[server] sync every ${config.pollIntervalMin}m; seats refresh after ${config.seatRefreshMin}m`);
    syncer.start(config.pollIntervalMin);
  } else {
    console.log('[server] sync disabled (SYNC=off)');
  }
});

const shutdown = () => {
  syncer.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

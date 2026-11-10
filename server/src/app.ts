import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { termName, termSortKey } from '../../shared/src/terms.ts';
import type { TermSummary } from '../../shared/src/types.ts';
import type { Store } from './store.ts';
import type { Syncer } from './sync.ts';

export interface AppDeps {
  store: Store;
  syncer: Syncer;
  production: boolean;
  webDist?: string;
}

const TERM_RE = /^[A-Z0-9]{4}$/;

/** CSP hashes for index.html's inline scripts (the theme script that runs before first paint). */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1] ?? '').digest('base64')}'`,
  );
}

export function createApp({ store, syncer, production, webDist }: AppDeps): Hono {
  const app = new Hono();
  const index = webDist && existsSync(webDist) ? readFileSync(path.join(webDist, 'index.html'), 'utf8') : null;

  if (production) {
    // Everything the page loads comes from this origin, so the policy can be strict.
    app.use(
      '*',
      secureHeaders({
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...(index ? inlineScriptHashes(index) : [])],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          // Vite inlines the smallest font subsets as data: URIs.
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
        xFrameOptions: 'DENY',
        referrerPolicy: 'strict-origin-when-cross-origin',
      }),
    );
  }

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/terms', (c) => {
    const meta = store.getMeta();
    const codes = new Set([...meta.terms.map((t) => t.term_code), ...Object.keys(meta.sync)]);
    const terms: TermSummary[] = [...codes]
      .map((code) => {
        const raw = meta.terms.find((t) => t.term_code === code);
        const s = meta.sync[code];
        return {
          code,
          name: termName(code),
          refreshedAt: raw?.last_full_refresh_at ?? s?.refreshedAt ?? null,
          syncedAt: s?.syncedAt ?? null,
          courseCount: s?.courseCount ?? raw?.course_count ?? 0,
          available: store.hasCatalog(code),
        };
      })
      .sort((a, b) => termSortKey(b.code).localeCompare(termSortKey(a.code)));
    return c.json({ terms });
  });

  app.get('/api/terms/:code/catalog', (c) => {
    const code = c.req.param('code').toUpperCase();
    if (!TERM_RE.test(code)) return c.json({ error: 'Unknown term code' }, 400);
    const entry = store.readCatalog(code);
    if (!entry) {
      const s = store.getMeta().sync[code];
      return c.json(
        { error: s?.status === 'syncing' ? 'This term is still downloading. Try again in a minute.' : 'No data for this term yet.' },
        404,
      );
    }
    c.header('ETag', entry.etag);
    c.header('Cache-Control', 'no-cache');
    c.header('Vary', 'Accept-Encoding');
    if (c.req.header('If-None-Match') === entry.etag) return c.body(null, 304);
    c.header('Content-Type', 'application/json; charset=utf-8');
    if ((c.req.header('Accept-Encoding') ?? '').includes('gzip')) {
      c.header('Content-Encoding', 'gzip');
      return c.body(new Uint8Array(entry.gzip));
    }
    return c.body(entry.body);
  });

  app.get('/api/sync/status', (c) => {
    const meta = store.getMeta();
    return c.json({ busy: syncer.busy, termsFetchedAt: meta.termsFetchedAt, terms: meta.sync });
  });

  app.post('/api/sync/:code', async (c) => {
    if (production) return c.json({ error: 'Manual sync is disabled in production.' }, 403);
    const code = c.req.param('code').toUpperCase();
    if (!TERM_RE.test(code)) return c.json({ error: 'Unknown term code' }, 400);
    void syncer.tick({ force: [code] });
    return c.json({ started: true }, 202);
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  if (webDist && index !== null) {
    const rel = path.relative(process.cwd(), webDist);
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.use('/*', serveStatic({ root: rel }));
    app.get('*', (c) => c.html(index));
  }

  return app;
}

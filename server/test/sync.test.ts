import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rawSample } from '../../shared/test/helpers.ts';
import type { Catalog, RawCourse } from '../../shared/src/types.ts';
import { Store } from '../src/store.ts';
import { Syncer } from '../src/sync.ts';
import { UcsdClient } from '../src/upstream/ucsd.ts';
import { createApp } from '../src/app.ts';

// 18 real courses + 40 synthetic copies → forces two pages of 48.
const COURSES: RawCourse[] = [
  ...rawSample.courses,
  ...Array.from({ length: 40 }, (_, i) => ({
    ...rawSample.courses[0]!,
    module_code: `ZZZ-${100 + i}`,
    subject_code: 'ZZZ',
    course_code: String(100 + i),
    sections: rawSample.courses[0]!.sections.map((s) => ({ ...s, section_id: `Z${i}-${s.section_id}` })),
  })),
];

function fakeUpstream(opts: { refreshedAt?: string; breakCourses?: boolean; calls?: string[] } = {}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    opts.calls?.push(url.pathname);
    if (url.pathname.endsWith('/terms')) {
      return json({
        terms: [
          {
            term_code: 'WI27',
            term_name: 'Winter',
            calendar_year: '2027',
            course_count: COURSES.length,
            section_count: 0,
            meeting_count: 0,
            last_full_refresh_at: opts.refreshedAt ?? '2026-11-06 01:38:11+00',
            configured: true,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/filters')) return json({ subjects: [{ value: 'CSE', label: 'Computer Science and Engineering' }] });
    if (url.pathname.endsWith('/courses/search')) {
      const body = JSON.parse(String(init?.body));
      if (opts.breakCourses) return json({ total: 1, courses: [{ module_code: 'X' }] });
      return json({ total: COURSES.length, courses: COURSES.slice(body.offset, body.offset + body.limit) });
    }
    return json({ error: 'nope' }, 404);
  }) as typeof fetch;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tss-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeSyncer(fetchImpl: typeof fetch, store = new Store(dir)) {
  const client = new UcsdClient({ baseUrl: 'https://upstream.test', userAgent: 'test', requestDelayMs: 0, fetchImpl, sleep: async () => {} });
  return { store, syncer: new Syncer({ client, store, seatRefreshMin: 60, rawSnapshotsToKeep: 2, log: () => {} }) };
}

describe('Syncer', () => {
  it('downloads every page, normalizes, and writes the catalog + raw snapshot', async () => {
    const calls: string[] = [];
    const { store, syncer } = makeSyncer(fakeUpstream({ calls }));
    await syncer.tick();
    expect(calls.filter((c) => c.endsWith('/courses/search'))).toHaveLength(2);
    const cat = JSON.parse(store.readCatalog('WI27')!.body) as Catalog;
    expect(cat.courses.length).toBe(COURSES.length);
    expect(cat.term.name).toBe('Winter 2027');
    expect(store.getMeta().sync.WI27!.status).toBe('ok');
  });

  it('skips terms that are fresh and re-syncs when upstream refreshes', async () => {
    const { store, syncer } = makeSyncer(fakeUpstream());
    await syncer.tick();
    const t = store.getMeta().terms[0]!;
    expect(syncer.needsSync(t)).toBeNull();
    expect(syncer.needsSync({ ...t, last_full_refresh_at: '2026-11-10 00:00:00+00' })).toBe('upstream refreshed');
  });

  it('keeps the previous catalog when upstream changes shape', async () => {
    const store = new Store(dir);
    await makeSyncer(fakeUpstream(), store).syncer.tick();
    const before = store.readCatalog('WI27')!.etag;
    await makeSyncer(fakeUpstream({ breakCourses: true }), store).syncer.tick({ force: ['WI27'] });
    expect(store.getMeta().sync.WI27!.status).toBe('error');
    expect(store.getMeta().sync.WI27!.error).toMatch(/course missing/);
    expect(new Store(dir).readCatalog('WI27')!.etag).toBe(before);
  });
});

describe('HTTP API', () => {
  it('serves terms and a gzipped catalog with ETag revalidation', async () => {
    const { store, syncer } = makeSyncer(fakeUpstream());
    await syncer.tick();
    const app = createApp({ store, syncer, production: true });

    const terms = (await (await app.request('/api/terms')).json()) as { terms: unknown[] };
    expect(terms.terms[0]).toMatchObject({ code: 'WI27', name: 'Winter 2027', available: true });

    const res = await app.request('/api/terms/WI27/catalog', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const cat = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')) as Catalog;
    expect(cat.courses.length).toBe(COURSES.length);

    const etag = res.headers.get('etag')!;
    const again = await app.request('/api/terms/WI27/catalog', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
  });

  it('404s for unknown terms and blocks manual sync in production', async () => {
    const { store, syncer } = makeSyncer(fakeUpstream());
    const app = createApp({ store, syncer, production: true });
    expect((await app.request('/api/terms/SP99/catalog')).status).toBe(404);
    expect((await app.request('/api/terms/../catalog')).status).toBe(404);
    expect((await app.request('/api/sync/WI27', { method: 'POST' })).status).toBe(403);
  });
});

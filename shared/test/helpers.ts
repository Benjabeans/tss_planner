import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Catalog, Plan, PlanPick, RawCourse } from '../src/types.ts';
import { normalizeCatalog } from '../src/normalize.ts';
import { fingerprintPackage, indexCatalog, summarizePackage, type CatalogIndex } from '../src/plan.ts';

export const rawSample = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/wi27-sample.json', import.meta.url)), 'utf8'),
) as { term_code: string; courses: RawCourse[] };

export function sampleCatalog(): Catalog {
  return normalizeCatalog({
    term: { term_code: 'WI27', last_full_refresh_at: '2026-11-06 01:38:11+00' },
    courses: rawSample.courses,
    subjects: [...new Set(rawSample.courses.map((c) => c.subject_code))].map((s) => ({ value: s, label: s })),
    syncedAt: '2026-11-09T00:00:00.000Z',
  });
}

export function sampleIndex(): CatalogIndex {
  return indexCatalog(sampleCatalog());
}

export function courseByCode(index: CatalogIndex, displayCode: string) {
  const c = index.catalog.courses.find((x) => x.displayCode === displayCode);
  if (!c) throw new Error(`no course ${displayCode}`);
  return c;
}

export function pickFor(index: CatalogIndex, displayCode: string, pkgIndex = 0, overrides: Partial<PlanPick> = {}): PlanPick {
  const c = courseByCode(index, displayCode);
  const pkg = c.packages[pkgIndex]!;
  return {
    courseKey: c.key,
    packageId: pkg.id,
    color: 'blue',
    status: 'planned',
    fingerprint: fingerprintPackage(c, pkg),
    summaryAtAdd: summarizePackage(c, pkg),
    addedAt: '2026-11-09T00:00:00.000Z',
    ...overrides,
  };
}

export function emptyPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'p1',
    termCode: 'WI27',
    name: 'Plan A',
    picks: [],
    blocks: [],
    createdAt: '2026-11-09T00:00:00.000Z',
    updatedAt: '2026-11-09T00:00:00.000Z',
    ...overrides,
  };
}

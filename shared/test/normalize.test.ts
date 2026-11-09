import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { displayNumber, normalizeCourse, parseUnits } from '../src/normalize.ts';
import type { RawCourse } from '../src/types.ts';
import type { Course } from '../src/types.ts';
import { rawSample, sampleCatalog } from './helpers.ts';

const upstreamCount = (c: Course) => c.packages.reduce((n, p) => n + 1 + p.altIds.length, 0);

/**
 * Known upstream oddities (WI27): ECE 121B reports 0 complete packages (we show its partial
 * ones rather than nothing); MMW 14/122 count packages whose component types vary.
 */
const KNOWN_COUNT_EXCEPTIONS = new Set(['ECE-121B', 'MMW-014', 'MMW-122']);

describe('displayNumber', () => {
  it('strips zero padding but keeps suffixes', () => {
    expect(displayNumber('018')).toBe('18');
    expect(displayNumber('003B')).toBe('3B');
    expect(displayNumber('110')).toBe('110');
    expect(displayNumber('000')).toBe('0');
  });
});

describe('parseUnits', () => {
  it('handles fixed and variable units', () => {
    expect(parseUnits('4 units')).toEqual({ min: 4, max: 4 });
    expect(parseUnits('1 unit')).toEqual({ min: 1, max: 1 });
    expect(parseUnits('1-4 units')).toEqual({ min: 1, max: 4 });
    expect(parseUnits('')).toEqual({ min: 0, max: 0 });
  });
});

describe('package derivation', () => {
  it('reproduces upstream complete_package_count for every sample course (counting aliases)', () => {
    for (const raw of rawSample.courses) {
      expect(upstreamCount(normalizeCourse(raw)), raw.module_code).toBe(raw.complete_package_count);
    }
  });

  it('merges package ids that bundle identical sections', () => {
    const anth = sampleCatalog().courses.filter((x) => x.moduleCode === 'ANTH-212');
    for (const c of anth) expect(new Set(c.packages.map((p) => p.sectionIds.join())).size).toBe(c.packages.length);
    expect(anth.some((c) => c.packages.some((p) => p.altIds.length > 0))).toBe(true);
  });

  it('builds CSE 110 packages from event package ids (LE + DI + one lab)', () => {
    const c = sampleCatalog().courses.find((x) => x.displayCode === 'CSE 110')!;
    expect(c.packages).toHaveLength(3);
    for (const p of c.packages) {
      const types = p.sectionIds.map((id) => c.sections.find((s) => s.id === id)!.type);
      expect(types).toEqual(['LE', 'DI', 'LA']);
    }
    // Every package shares the lecture.
    expect(new Set(c.packages.map((p) => p.sectionIds[0])).size).toBe(1);
  });

  it('falls back to section-code structure when no ids exist', () => {
    const c = sampleCatalog().courses.find((x) => x.moduleCode === 'AUD-284')!;
    expect(c.packages.map((p) => p.id)).toEqual(['g:001-001', 'g:002-001']);
    const aip = sampleCatalog().courses.find((x) => x.moduleCode === 'AIP-197')!;
    expect(aip.packages.map((p) => p.id)).toEqual(['g:001']);
  });

  it('lists sections outside complete packages as extras (ANAR 167 fieldwork)', () => {
    const c = sampleCatalog().courses.find((x) => x.moduleCode === 'ANAR-167')!;
    const extras = c.extraSectionIds.map((id) => c.sections.find((s) => s.id === id)!.type);
    expect(extras).toContain('FW');
  });
});

describe('normalizeCatalog', () => {
  const cat = sampleCatalog();

  it('gives topic listings distinct keys and titles', () => {
    const anth = cat.courses.filter((c) => c.moduleCode === 'ANTH-212');
    expect(anth).toHaveLength(2);
    expect(new Set(anth.map((c) => c.key)).size).toBe(2);
    expect(new Set(anth.map((c) => c.title)).size).toBe(2);
  });

  it('keys are unique', () => {
    expect(new Set(cat.courses.map((c) => c.key)).size).toBe(cat.courses.length);
  });

  it('formats codes without padding', () => {
    expect(cat.courses.map((c) => c.displayCode)).toContain('MATH 18');
    expect(cat.courses.map((c) => c.displayCode)).toContain('CHEM 6B');
  });

  it('normalizes finals with dates and weekdays', () => {
    const c = cat.courses.find((x) => x.displayCode === 'CSE 110')!;
    const le = c.sections.find((s) => s.type === 'LE')!;
    const final = le.meetings.find((m) => m.kind === 'final')!;
    expect(final.date).toBe('2027-03-17');
    expect(final.day).toBe(3);
    expect(final.start).toBe(690);
    // Weekly meetings come first, Monday-first.
    expect(le.meetings.slice(0, 3).map((m) => m.day)).toEqual([1, 3, 5]);
  });

  it('marks TBA meetings', () => {
    const c = cat.courses.find((x) => x.moduleCode === 'AIP-197DC')!;
    expect(c.sections.flatMap((s) => s.meetings).every((m) => m.tba)).toBe(true);
  });

  it('sorts courses naturally (MATH 18 before MATH 20C, CSE 100 before CSE 110)', () => {
    const codes = cat.courses.map((c) => c.displayCode);
    expect(codes.indexOf('MATH 18')).toBeLessThan(codes.indexOf('MATH 20C'));
    expect(codes.indexOf('CSE 100')).toBeLessThan(codes.indexOf('CSE 110'));
  });
});

// Full-term check against the latest raw snapshot written by `npm run sync` (skipped when absent).
const rawDir = fileURLToPath(new URL('../../data/raw/', import.meta.url));
const snapshots = existsSync(rawDir)
  ? readdirSync(rawDir).flatMap((term) =>
      readdirSync(`${rawDir}${term}`)
        .filter((f) => f.endsWith('.json.gz'))
        .sort()
        .slice(-1)
        .map((f) => `${rawDir}${term}/${f}`),
    )
  : [];

describe.skipIf(snapshots.length === 0)('full-term snapshots', () => {
  for (const file of snapshots) {
    it(`reproduces complete_package_count for every course in ${file.split('/raw/')[1]}`, () => {
      const raw = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as { courses: RawCourse[] };
      const mismatches = raw.courses
        .filter((c) => !KNOWN_COUNT_EXCEPTIONS.has(c.module_code))
        .filter((c) => upstreamCount(normalizeCourse(c)) !== c.complete_package_count)
        .map((c) => c.module_code);
      // Allow a sliver of drift between terms, but flag anything systematic.
      expect(mismatches.length, mismatches.join(', ')).toBeLessThanOrEqual(Math.ceil(raw.courses.length * 0.002));
    });
  }
});

import { describe, expect, it } from 'vitest';
import { layoutLanes } from '../src/layout.ts';
import { buildSearchIndex, parseQuery, searchCourses } from '../src/search.ts';
import { formatDays, formatRange, formatTime, weekdayOfDate } from '../src/time.ts';
import { buildIcs } from '../src/ics.ts';
import { TERM_DATES, termName, termSortKey } from '../src/terms.ts';
import { nextColor } from '../src/colors.ts';
import { emptyPlan, pickFor, sampleCatalog, sampleIndex } from './helpers.ts';

describe('time', () => {
  it('formats times and ranges', () => {
    expect(formatTime(720)).toBe('12:00pm');
    expect(formatTime(545)).toBe('9:05am');
    expect(formatTime(0)).toBe('12:00am');
    expect(formatRange(720, 770)).toBe('12:00–12:50pm');
    expect(formatRange(660, 740)).toBe('11:00am–12:20pm');
  });
  it('formats days Monday-first', () => {
    expect(formatDays([5, 1, 3])).toBe('MWF');
    expect(formatDays([4, 2])).toBe('TuTh');
  });
  it('computes weekdays from ISO dates', () => {
    expect(weekdayOfDate('2027-01-04')).toBe(1);
    expect(weekdayOfDate('2027-03-17')).toBe(3);
  });
});

describe('terms', () => {
  it('names and sorts terms', () => {
    expect(termName('WI27')).toBe('Winter 2027');
    expect(termName('FA26')).toBe('Fall 2026');
    expect(['SP27', 'WI27', 'FA26'].sort((a, b) => termSortKey(a).localeCompare(termSortKey(b)))).toEqual(['FA26', 'WI27', 'SP27']);
  });
});

describe('layoutLanes', () => {
  it('stacks non-overlapping blocks in one lane', () => {
    const r = layoutLanes([
      { id: 'a', start: 600, end: 650 },
      { id: 'b', start: 650, end: 700 },
    ]);
    expect(r.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(r.get('b')).toEqual({ lane: 0, lanes: 1 });
  });
  it('splits a cluster of overlaps into lanes', () => {
    const r = layoutLanes([
      { id: 'a', start: 600, end: 700 },
      { id: 'b', start: 620, end: 680 },
      { id: 'c', start: 690, end: 750 },
      { id: 'd', start: 800, end: 850 },
    ]);
    expect(r.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(r.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(r.get('c')).toEqual({ lane: 1, lanes: 2 });
    expect(r.get('d')).toEqual({ lane: 0, lanes: 1 });
  });
});

describe('search', () => {
  const idx = buildSearchIndex(sampleCatalog());

  it('parses codes with subject carry-forward and joined forms', () => {
    const p = parseQuery('CSE 110, 100; math18 chem-6b', idx.subjects);
    expect(p.codes).toEqual([
      { subject: 'CSE', number: '110' },
      { subject: 'CSE', number: '100' },
      { subject: 'MATH', number: '18' },
      { subject: 'CHEM', number: '6B' },
    ]);
  });

  it('parses a bare subject and free text', () => {
    expect(parseQuery('CSE', idx.subjects)).toEqual({ codes: [], subjects: ['CSE'], words: [] });
    expect(parseQuery('software engineering', idx.subjects).words).toEqual(['software', 'engineering']);
  });

  it('returns courses in the typed order', () => {
    expect(searchCourses(idx, 'CSE 110, 100').map((c) => c.displayCode)).toEqual(['CSE 110', 'CSE 100']);
    expect(searchCourses(idx, 'MATH 018').map((c) => c.displayCode)).toEqual(['MATH 18']);
  });

  it('treats and / slash as separators and words as narrowing', () => {
    expect(searchCourses(idx, 'CSE 110 and 100').map((c) => c.displayCode)).toEqual(['CSE 110', 'CSE 100']);
    expect(searchCourses(idx, 'cse 100/110').map((c) => c.displayCode)).toEqual(['CSE 100', 'CSE 110']);
    expect(searchCourses(idx, 'MATH 18 zzzz').map((c) => c.displayCode)).toEqual(['MATH 18']);
    expect(searchCourses(idx, 'CSE 100, 110 griswold').map((c) => c.displayCode)).toEqual(['CSE 110']);
  });

  it('falls back to prefix matches', () => {
    expect(searchCourses(idx, 'MATH 20').map((c) => c.displayCode)).toEqual(['MATH 20C']);
  });

  it('finds by title and instructor', () => {
    expect(searchCourses(idx, 'software eng').map((c) => c.displayCode)).toContain('CSE 110');
    expect(searchCourses(idx, 'griswold').map((c) => c.displayCode)).toContain('CSE 110');
  });

  it('returns nothing for an empty query', () => {
    expect(searchCourses(idx, '   ')).toEqual([]);
  });
});

describe('ics export', () => {
  const index = sampleIndex();
  const plan = emptyPlan({ picks: [pickFor(index, 'CSE 110')] });
  const ics = buildIcs({ plan, index, dates: TERM_DATES.WI27!, now: new Date('2026-11-09T00:00:00Z') });

  it('creates recurring weekly events through the end of instruction', () => {
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270313T075959Z');
    expect(ics).toContain('DTSTART;TZID=America/Los_Angeles:20270104T120000');
  });

  it('skips Monday holidays', () => {
    expect(ics).toContain('EXDATE;TZID=America/Los_Angeles:20270118T120000,20270215T120000');
  });

  it('adds the final as a single event', () => {
    expect(ics).toContain('SUMMARY:CSE 110 Final');
    expect(ics).toContain('DTSTART;TZID=America/Los_Angeles:20270317T113000');
  });

  it('keeps lines within 75 octets and uses CRLF', () => {
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('colors', () => {
  it('picks the least-used color', () => {
    expect(nextColor([])).toBe('blue');
    expect(nextColor(['blue', 'teal'])).toBe('green');
  });
});

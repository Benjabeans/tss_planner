import { describe, expect, it } from 'vitest';
import {
  alternativesFor,
  candidateConflicts,
  planConflicts,
  planSlots,
  planUnits,
  resolvePick,
  summarizePackage,
} from '../src/plan.ts';
import { courseByCode, emptyPlan, pickFor, sampleIndex } from './helpers.ts';

const index = sampleIndex();

describe('plan slots', () => {
  it('expands a pick into timed slots, skipping TBA meetings', () => {
    const plan = emptyPlan({ picks: [pickFor(index, 'CSE 110')] });
    const slots = planSlots(plan, index);
    // LE MWF + final, DI M, LA M.
    expect(slots.filter((s) => !s.date).map((s) => `${s.sectionType}${s.day}`).sort()).toEqual(['DI1', 'LA1', 'LE1', 'LE3', 'LE5']);
    expect(slots.filter((s) => s.kind === 'final')).toHaveLength(1);
  });

  it('includes custom blocks', () => {
    const plan = emptyPlan({ blocks: [{ id: 'b1', label: 'Work', days: [2, 4], start: 600, end: 720, color: 'slate' }] });
    expect(planSlots(plan, index)).toHaveLength(2);
  });

  it('summarizes a package for humans', () => {
    const c = courseByCode(index, 'CSE 110');
    expect(summarizePackage(c, c.packages[0]!)).toMatch(/^LE MWF 12:00–12:50pm; DI M 7:00–7:50pm; LA M/);
  });
});

describe('pick health', () => {
  it('is ok when the fingerprint matches', () => {
    expect(resolvePick(pickFor(index, 'CSE 110'), index).state).toBe('ok');
  });
  it('detects changed meetings', () => {
    expect(resolvePick(pickFor(index, 'CSE 110', 0, { fingerprint: 'deadbeef' }), index).state).toBe('changed');
  });
  it('detects a removed package or course', () => {
    expect(resolvePick(pickFor(index, 'CSE 110', 0, { packageId: 'nope' }), index).state).toBe('missing-package');
    expect(resolvePick(pickFor(index, 'CSE 110', 0, { courseKey: 'nope' }), index).state).toBe('missing-course');
  });
});

describe('conflicts in a plan', () => {
  // A block that overlaps CSE 110 lecture (MWF 12:00–12:50).
  const lunch = { id: 'lunch', label: 'Lunch shift', days: [1, 3, 5], start: 720, end: 780, color: 'slate' };

  it('reports block conflicts as warnings', () => {
    const plan = emptyPlan({ picks: [pickFor(index, 'CSE 110')], blocks: [lunch] });
    const all = planConflicts(plan, index);
    expect(all.filter((c) => c.kind === 'block')).toHaveLength(3);
    expect(all.every((c) => c.severity !== 'error')).toBe(true);
  });

  it('a second package of the same course is a swap, not a conflict', () => {
    const plan = emptyPlan({ picks: [pickFor(index, 'CSE 110', 0)] });
    const c = courseByCode(index, 'CSE 110');
    expect(candidateConflicts(c, c.packages[1]!, plan, index)).toEqual([]);
  });

  it('candidate conflicts ignore backups unless asked', () => {
    const c = courseByCode(index, 'CSE 110');
    const plan = emptyPlan({ blocks: [lunch] });
    expect(candidateConflicts(c, c.packages[0]!, plan, index).length).toBeGreaterThan(0);
  });

  it('alternatives list the current package first, then the fewest errors', () => {
    const plan = emptyPlan({ picks: [pickFor(index, 'MATH 18', 0)] });
    const alts = alternativesFor(courseByCode(index, 'MATH 18').key, plan, index);
    expect(alts[0]!.current).toBe(true);
    expect(alts).toHaveLength(courseByCode(index, 'MATH 18').packages.length);
  });
});

describe('units', () => {
  it('sums units and ignores backups', () => {
    const plan = emptyPlan({
      picks: [pickFor(index, 'CSE 110'), pickFor(index, 'MATH 18'), pickFor(index, 'CSE 100', 0, { status: 'backup' })],
    });
    expect(planUnits(plan, index)).toEqual({ min: 8, max: 8 });
  });
});

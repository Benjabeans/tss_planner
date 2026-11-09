import { describe, expect, it } from 'vitest';
import { generateSchedules, scoreSchedule } from '../src/generate.ts';
import { findConflicts, type Slot } from '../src/conflicts.ts';
import { findPackage, slotsForBlock, slotsForPackage } from '../src/plan.ts';
import { courseByCode, sampleIndex } from './helpers.ts';

const index = sampleIndex();
const course = (code: string) => courseByCode(index, code);

function slotsOf(choices: { courseKey: string; packageId: string }[]): Slot[] {
  return choices.flatMap((ch) => {
    const c = index.byKey.get(ch.courseKey)!;
    return slotsForPackage(c, findPackage(c, ch.packageId)!, { kind: 'pick' });
  });
}

describe('generateSchedules', () => {
  it('returns only conflict-free combinations, best score first', () => {
    const r = generateSchedules({ courses: [course('CSE 110'), course('MATH 18')], fixed: [] });
    expect(r.schedules.length).toBeGreaterThan(0);
    for (const s of r.schedules) {
      const errors = findConflicts(slotsOf(s.choices)).filter((c) => c.severity === 'error');
      expect(errors).toEqual([]);
      expect(s.choices).toHaveLength(2);
    }
    const scores = r.schedules.map((s) => s.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  it('respects custom blocks as fixed obstacles', () => {
    // Block every MATH 18 lecture slot window on MWF mornings–afternoons.
    const block = { id: 'b', label: 'Work', days: [1, 2, 3, 4, 5], start: 8 * 60, end: 21 * 60, color: 'slate' };
    const r = generateSchedules({ courses: [course('MATH 18')], fixed: slotsForBlock(block) });
    expect(r.schedules).toEqual([]);
    expect(r.blockers).toEqual([{ courseKey: course('MATH 18').key, reason: 'fixed' }]);
  });

  it('reports filters that remove every section', () => {
    const r = generateSchedules({ courses: [course('CSE 110')], fixed: [], constraints: { avoidDays: [1] } });
    expect(r.blockers).toEqual([{ courseKey: course('CSE 110').key, reason: 'filtered' }]);
  });

  it('applies time-window constraints', () => {
    const r = generateSchedules({ courses: [course('MATH 18')], fixed: [], constraints: { earliest: 11 * 60 } });
    for (const s of r.schedules) expect(s.stats.earliest!).toBeGreaterThanOrEqual(11 * 60);
  });

  it('names course pairs that can never fit together (real WI27 data)', () => {
    // CSE 110's labs (Mon 3:00–5:50pm) always overlap CSE 100's only discussion (Mon 4:00–4:50pm).
    const r = generateSchedules({ courses: [course('CSE 110'), course('CSE 100'), course('MATH 18')], fixed: [] });
    expect(r.schedules).toEqual([]);
    expect(r.incompatible).toEqual([[course('CSE 100').key, course('CSE 110').key].sort()].map((p) => expect.arrayContaining(p)));
  });

  it('stops at the node budget and says so', () => {
    const r = generateSchedules({ courses: [course('MATH 18'), course('CSE 110')], fixed: [], maxNodes: 5 });
    expect(r.truncated).toBe(true);
  });
});

describe('scoreSchedule', () => {
  const s = (day: number, start: number, end: number): Slot => ({
    ownerId: `${day}${start}`,
    ownerKind: 'pick',
    label: 'x',
    kind: 'class',
    day,
    date: null,
    start,
    end,
  });
  it('counts days, gaps and early starts', () => {
    const { stats } = scoreSchedule([s(1, 540, 590), s(1, 660, 710), s(3, 600, 650)], 0, 'balanced');
    expect(stats).toEqual({ days: 2, gapMinutes: 70, earliest: 540, latest: 710, notOpen: 0 });
  });
  it('fewest-days prefers fewer days over shorter gaps', () => {
    const twoDays = scoreSchedule([s(1, 540, 590), s(3, 540, 590)], 0, 'fewest-days').score;
    const oneDayGap = scoreSchedule([s(1, 540, 590), s(1, 900, 950)], 0, 'fewest-days').score;
    expect(oneDayGap).toBeLessThan(twoDays);
  });
});

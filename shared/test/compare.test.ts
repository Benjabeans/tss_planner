import { describe, expect, it } from 'vitest';
import { compareSnapshots, sectionChanges, snapshotPlan, withChoices, type PlanSnapshot } from '../src/compare.ts';
import { generateSchedules } from '../src/generate.ts';
import type { Slot } from '../src/conflicts.ts';
import { findPackage, slotsForPackage } from '../src/plan.ts';
import { courseByCode, emptyPlan, pickFor, sampleIndex } from './helpers.ts';

const index = sampleIndex();
const course = (code: string) => courseByCode(index, code);

const snap = (stats: Partial<PlanSnapshot['stats']>, rest: Partial<PlanSnapshot> = {}): PlanSnapshot => ({
  stats: { days: 3, gapMinutes: 120, earliest: 540, latest: 1000, notOpen: 0, ...stats },
  conflicts: 0,
  warnings: 0,
  ...rest,
});

describe('compareSnapshots', () => {
  it('describes improvements and regressions, most important first', () => {
    const base = snap({}, { conflicts: 2 });
    const next = snap({ days: 2, gapMinutes: 60, earliest: 600, latest: 1000, notOpen: 1 });
    expect(compareSnapshots(base, next)).toEqual([
      { text: 'fixes 2 conflicts', tone: 'good' },
      { text: '1 fewer day on campus', tone: 'good' },
      { text: '1h less between classes', tone: 'good' },
      { text: '1 more full or waitlisted', tone: 'bad' },
      { text: 'starts 1h later', tone: 'neutral' },
    ]);
  });

  it('says how many conflicts are left when only some are fixed', () => {
    const texts = compareSnapshots(snap({}, { conflicts: 3 }), snap({}, { conflicts: 1 })).map((d) => d.text);
    expect(texts).toEqual(['fixes 2 conflicts', '1 conflict left']);
  });

  it('ignores gap changes under 10 minutes and returns nothing when equal', () => {
    expect(compareSnapshots(snap({}), snap({ gapMinutes: 125 }))).toEqual([]);
  });
});

describe('snapshotPlan', () => {
  it('counts conflicts like the header and drops them for a generated option', () => {
    const cse110 = course('CSE 110');
    const math18 = course('MATH 18');
    // Find a CSE 110 package that collides with MATH 18's first package, so the plan starts with a conflict.
    const mathSlots = slotsForPackage(math18, math18.packages[0]!, { kind: 'pick' });
    const clashing = cse110.packages.findIndex((p) =>
      slotsForPackage(cse110, p, { kind: 'pick' }).some((a) =>
        mathSlots.some((b) => !a.date && !b.date && a.day === b.day && a.start < b.end && b.start < a.end),
      ),
    );
    expect(clashing).toBeGreaterThanOrEqual(0);
    const plan = emptyPlan({ picks: [pickFor(index, 'CSE 110', clashing), pickFor(index, 'MATH 18', 0)] });
    const keys = plan.picks.map((p) => p.courseKey);
    const base = snapshotPlan(plan, index, { courseKeys: keys });
    expect(base.conflicts).toBeGreaterThan(0);

    const option = generateSchedules({ courses: [cse110, math18], fixed: [] }).schedules[0]!;
    const next = snapshotPlan(withChoices(plan, index, option.choices), index, { courseKeys: keys });
    expect(next.conflicts).toBe(0);
    // The finder's own stats and the snapshot agree when nothing is locked.
    expect(next.stats).toEqual(option.stats);
    expect(compareSnapshots(base, next)[0]).toEqual({ text: `fixes ${base.conflicts} conflict${base.conflicts === 1 ? '' : 's'}`, tone: 'good' });
  });

  it('leaves backups out of days and gaps', () => {
    const plan = emptyPlan({ picks: [pickFor(index, 'MATH 18', 0), pickFor(index, 'CSE 110', 0, { status: 'backup' })] });
    const withBackup = snapshotPlan(plan, index, { courseKeys: [] });
    const without = snapshotPlan(emptyPlan({ picks: [plan.picks[0]!] }), index, { courseKeys: [] });
    expect(withBackup.stats).toEqual(without.stats);
  });
});

describe('sectionChanges', () => {
  it('pairs old and new sections by type and skips unchanged courses', () => {
    const cse110 = course('CSE 110');
    const plan = emptyPlan({ picks: [pickFor(index, 'CSE 110', 0), pickFor(index, 'MATH 18', 0)] });
    const target = cse110.packages.find((p) => p.sectionIds[0] === cse110.packages[0]!.sectionIds[0] && p.id !== cse110.packages[0]!.id);
    expect(target).toBeDefined();
    const changes = sectionChanges(plan, index, [
      { courseKey: cse110.key, packageId: target!.id },
      { courseKey: plan.picks[1]!.courseKey, packageId: plan.picks[1]!.packageId },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.courseKey).toBe(cse110.key);
    for (const swap of changes[0]!.swaps) {
      // The shared lecture stays put; only sections that differ are listed, matched by type.
      expect(swap.from?.id).not.toBe(swap.to?.id);
      if (swap.from && swap.to) expect(swap.from.type).toBe(swap.to.type);
    }
    expect(changes[0]!.swaps.some((s) => s.type === 'LE')).toBe(false);
  });
});

describe('generateSchedules with locked courses', () => {
  it('counts locked courses in days on campus', () => {
    // A locked class on Saturday, a day CSE 110 never meets: every option spends one more day on campus.
    const locked: Slot = { ownerId: 'locked', ownerKind: 'pick', label: 'X', kind: 'class', day: 6, date: null, start: 600, end: 650 };
    const r = generateSchedules({ courses: [course('CSE 110')], fixed: [locked] });
    expect(r.schedules.length).toBeGreaterThan(0);
    const c = course('CSE 110');
    for (const s of r.schedules) {
      const own = slotsForPackage(c, findPackage(c, s.choices[0]!.packageId)!, { kind: 'candidate' });
      expect(s.stats.days).toBe(new Set([6, ...own.filter((x) => !x.date).map((x) => x.day)]).size);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { compareSlots, findConflicts, findCrossConflicts, groupConflicts, worstSeverity, type Slot } from '../src/conflicts.ts';

let n = 0;
function slot(p: Partial<Slot> & Pick<Slot, 'day' | 'start' | 'end'>): Slot {
  return {
    ownerId: p.ownerId ?? `c${n++}`,
    ownerKind: p.ownerKind ?? 'pick',
    label: p.label ?? 'X',
    kind: p.kind ?? 'class',
    date: p.date ?? null,
    sectionId: p.sectionId ?? `s${n++}`,
    ...p,
  };
}

describe('weekly class conflicts', () => {
  it('detects an overlap and reports the overlapping interval', () => {
    const a = slot({ ownerId: 'CSE110', day: 3, start: 720, end: 770 });
    const b = slot({ ownerId: 'MATH18', day: 3, start: 740, end: 790 });
    const c = compareSlots(a, b)!;
    expect(c.kind).toBe('class');
    expect(c.severity).toBe('error');
    expect([c.start, c.end]).toEqual([740, 770]);
  });

  it('touching meetings do not conflict', () => {
    expect(compareSlots(slot({ day: 1, start: 720, end: 770 }), slot({ day: 1, start: 770, end: 820 }))).toBeNull();
  });

  it('different days do not conflict', () => {
    expect(compareSlots(slot({ day: 1, start: 720, end: 770 }), slot({ day: 2, start: 720, end: 770 }))).toBeNull();
  });

  it('meetings of the same course never conflict with each other', () => {
    const a = slot({ ownerId: 'X', day: 1, start: 720, end: 770 });
    const b = slot({ ownerId: 'X', day: 1, start: 720, end: 770 });
    expect(compareSlots(a, b)).toBeNull();
  });

  it('reports tight transitions only when enabled', () => {
    const a = slot({ day: 1, start: 600, end: 650 });
    const b = slot({ day: 1, start: 655, end: 705 });
    expect(compareSlots(a, b)).toBeNull();
    const c = compareSlots(a, b, { tightGapMin: 10 })!;
    expect(c.kind).toBe('tight');
    expect(c.severity).toBe('info');
    expect([c.start, c.end]).toEqual([650, 655]);
  });

  it('downgrades conflicts involving a backup to info', () => {
    const a = slot({ day: 1, start: 600, end: 650, status: 'backup' });
    const b = slot({ day: 1, start: 600, end: 650, status: 'planned' });
    expect(compareSlots(a, b)!.severity).toBe('info');
  });

  it('keeps a backup overlapping an enrolled course as a warning', () => {
    const a = slot({ day: 1, start: 600, end: 650, status: 'backup' });
    const b = slot({ day: 1, start: 600, end: 650, status: 'enrolled' });
    expect(compareSlots(a, b)!.severity).toBe('warning');
  });

  it('flags conflicts that involve an enrolled course', () => {
    const a = slot({ day: 1, start: 600, end: 650, status: 'enrolled' });
    const b = slot({ day: 1, start: 600, end: 650 });
    expect(compareSlots(a, b)!.involvesEnrolled).toBe(true);
  });
});

describe('custom blocks', () => {
  it('a class over a custom block is a warning', () => {
    const work = slot({ ownerKind: 'block', kind: 'block', day: 2, start: 840, end: 1020 });
    const lab = slot({ day: 2, start: 900, end: 1010 });
    const c = compareSlots(work, lab)!;
    expect(c.kind).toBe('block');
    expect(c.severity).toBe('warning');
  });
});

describe('dated meetings', () => {
  it('a midterm conflicts with a weekly class on the same weekday', () => {
    // 2027-02-01 is a Monday.
    const mid = slot({ kind: 'midterm', date: '2027-02-01', day: 1, start: 1140, end: 1250 });
    const dis = slot({ day: 1, start: 1140, end: 1190 });
    const c = compareSlots(mid, dis)!;
    expect(c.kind).toBe('dated');
    expect(c.severity).toBe('warning');
    expect(c.date).toBe('2027-02-01');
    expect(compareSlots(mid, slot({ day: 2, start: 1140, end: 1190 }))).toBeNull();
  });

  it('finals conflict only with finals on the same date', () => {
    const f1 = slot({ kind: 'final', date: '2027-03-17', day: 3, start: 690, end: 869 });
    const f2 = slot({ kind: 'final', date: '2027-03-17', day: 3, start: 800, end: 979 });
    const f3 = slot({ kind: 'final', date: '2027-03-18', day: 4, start: 690, end: 869 });
    expect(compareSlots(f1, f2)!.kind).toBe('final');
    expect(compareSlots(f1, f2)!.severity).toBe('error');
    expect(compareSlots(f1, f3)).toBeNull();
  });

  it('two exams on the same date and time are an error (exam ↔ exam)', () => {
    const m1 = slot({ kind: 'midterm', date: '2027-02-03', day: 3, start: 1140, end: 1260 });
    const m2 = slot({ kind: 'midterm', date: '2027-02-03', day: 3, start: 1200, end: 1310 });
    const c = compareSlots(m1, m2)!;
    expect(c.kind).toBe('exam');
    expect(c.severity).toBe('error');
    const other = slot({ kind: 'other', date: '2027-02-03', day: 3, start: 1200, end: 1310 });
    expect(compareSlots(m1, other)!.kind).toBe('dated');
  });

  it('finals never conflict with weekly classes', () => {
    const f = slot({ kind: 'final', date: '2027-03-17', day: 3, start: 690, end: 869 });
    expect(compareSlots(f, slot({ day: 3, start: 720, end: 770 }))).toBeNull();
  });
});

describe('aggregation', () => {
  it('finds all pairwise conflicts, sorted errors first', () => {
    const a = slot({ ownerId: 'A', day: 1, start: 600, end: 650 });
    const b = slot({ ownerId: 'B', day: 1, start: 620, end: 670 });
    const c = slot({ ownerId: 'C', day: 1, start: 675, end: 725 });
    const all = findConflicts([a, b, c], { tightGapMin: 10 });
    expect(all.map((x) => x.kind)).toEqual(['class', 'tight']);
    expect(worstSeverity(all)).toBe('error');
    expect(worstSeverity([])).toBeNull();
  });

  it('cross conflicts only compare across the two sets', () => {
    const left = [slot({ ownerId: 'A', day: 1, start: 600, end: 650 }), slot({ ownerId: 'A2', day: 1, start: 600, end: 650 })];
    const right = [slot({ ownerId: 'B', day: 1, start: 630, end: 700 })];
    expect(findCrossConflicts(left, right)).toHaveLength(2);
  });

  it('groups conflicts by the pair of owners', () => {
    const a1 = slot({ ownerId: 'A', day: 1, start: 600, end: 650 });
    const a2 = slot({ ownerId: 'A', day: 3, start: 600, end: 650 });
    const b1 = slot({ ownerId: 'B', day: 1, start: 600, end: 650 });
    const b2 = slot({ ownerId: 'B', day: 3, start: 600, end: 650 });
    const groups = groupConflicts(findConflicts([a1, a2, b1, b2]));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.conflicts).toHaveLength(2);
    expect(groups[0]!.owners).toEqual(['A', 'B']);
  });
});

import type { Day, MeetingKind, PickStatus } from './types.ts';
import { overlaps } from './time.ts';

export type SlotOwnerKind = 'pick' | 'block' | 'candidate';

/** One timed occurrence pattern on the calendar (TBA meetings never become slots). */
export interface Slot {
  /** Course key for picks/candidates, block id for custom blocks. */
  ownerId: string;
  ownerKind: SlotOwnerKind;
  /** "CSE 110 LE", or a custom block's label. */
  label: string;
  courseKey?: string;
  sectionId?: string;
  sectionType?: string;
  kind: MeetingKind | 'block';
  day: Day;
  /** Set for one-off meetings (finals, midterms, special sessions). */
  date: string | null;
  start: number;
  end: number;
  status?: PickStatus;
}

export type ConflictKind =
  /** Weekly class vs weekly class. */
  | 'class'
  /** Final vs final on the same date. */
  | 'final'
  /** Two exams (midterm/final) on the same date and time. */
  | 'exam'
  /** A dated meeting (midterm, one-off) vs a weekly class or another dated meeting. */
  | 'dated'
  /** Anything vs a custom block. */
  | 'block'
  /** Less than `tightGapMin` between two classes on the same day. */
  | 'tight';

export type Severity = 'error' | 'warning' | 'info';

export interface Conflict {
  id: string;
  kind: ConflictKind;
  severity: Severity;
  a: Slot;
  b: Slot;
  day: Day;
  date: string | null;
  /** The overlapping interval (for "tight", the gap between the two). */
  start: number;
  end: number;
  involvesEnrolled: boolean;
}

export interface ConflictOptions {
  /** Report back-to-back classes with a gap smaller than this (minutes). 0 disables. */
  tightGapMin?: number;
}

const BASE_SEVERITY: Record<ConflictKind, Severity> = {
  class: 'error',
  final: 'error',
  exam: 'error',
  dated: 'warning',
  block: 'warning',
  tight: 'info',
};

export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function sameOwner(a: Slot, b: Slot): boolean {
  return a.ownerId === b.ownerId && a.ownerKind === b.ownerKind;
}

function makeConflict(kind: ConflictKind, a: Slot, b: Slot, start: number, end: number, date: string | null): Conflict {
  // Backups are contingencies, so their overlaps are only notes — except against a course
  // you're enrolled in, which a backup could never be taken alongside.
  const backup = a.status === 'backup' || b.status === 'backup';
  const enrolled = a.status === 'enrolled' || b.status === 'enrolled';
  const base = BASE_SEVERITY[kind];
  const severity: Severity = !backup ? base : enrolled && base !== 'info' ? 'warning' : 'info';
  const ends = [a, b].map((s) => `${s.ownerKind}:${s.ownerId}:${s.sectionId ?? ''}`).sort();
  return {
    id: `${kind}|${ends.join('~')}|${date ?? a.day}|${start}`,
    kind,
    severity,
    a,
    b,
    day: a.date ? a.day : b.day,
    date,
    start,
    end,
    involvesEnrolled: a.status === 'enrolled' || b.status === 'enrolled',
  };
}

/** Compare one pair of slots. Returns null when they don't interact. */
export function compareSlots(a: Slot, b: Slot, opts: ConflictOptions = {}): Conflict | null {
  if (sameOwner(a, b)) return null;
  const tight = opts.tightGapMin ?? 0;

  // Weekly vs weekly.
  if (!a.date && !b.date) {
    if (a.day !== b.day) return null;
    if (overlaps(a.start, a.end, b.start, b.end)) {
      const kind: ConflictKind = a.kind === 'block' || b.kind === 'block' ? 'block' : 'class';
      return makeConflict(kind, a, b, Math.max(a.start, b.start), Math.min(a.end, b.end), null);
    }
    if (tight > 0 && a.kind !== 'block' && b.kind !== 'block') {
      const [first, second] = a.start <= b.start ? [a, b] : [b, a];
      const gap = second.start - first.end;
      if (gap >= 0 && gap < tight) return makeConflict('tight', first, second, first.end, second.start, null);
    }
    return null;
  }

  // Dated vs dated: same calendar date.
  if (a.date && b.date) {
    if (a.date !== b.date || !overlaps(a.start, a.end, b.start, b.end)) return null;
    const exam = (x: Slot) => x.kind === 'final' || x.kind === 'midterm';
    const kind: ConflictKind = a.kind === 'final' && b.kind === 'final' ? 'final' : exam(a) && exam(b) ? 'exam' : 'dated';
    return makeConflict(kind, a, b, Math.max(a.start, b.start), Math.min(a.end, b.end), a.date);
  }

  // Weekly vs dated. Finals happen in finals week, when weekly classes don't meet.
  const weekly = a.date ? b : a;
  const dated = a.date ? a : b;
  if (dated.kind === 'final') return null;
  if (weekly.day !== dated.day || !overlaps(weekly.start, weekly.end, dated.start, dated.end)) return null;
  const kind: ConflictKind = weekly.kind === 'block' ? 'block' : 'dated';
  return makeConflict(kind, a, b, Math.max(a.start, b.start), Math.min(a.end, b.end), dated.date);
}

/** All conflicts among a set of slots. */
export function findConflicts(slots: Slot[], opts: ConflictOptions = {}): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const c = compareSlots(slots[i]!, slots[j]!, opts);
      if (c) out.push(c);
    }
  }
  return sortConflicts(dedupe(out));
}

/** Conflicts between two sets (e.g. a candidate package vs the current plan). */
export function findCrossConflicts(left: Slot[], right: Slot[], opts: ConflictOptions = {}): Conflict[] {
  const out: Conflict[] = [];
  for (const a of left) {
    for (const b of right) {
      const c = compareSlots(a, b, opts);
      if (c) out.push(c);
    }
  }
  return sortConflicts(dedupe(out));
}

function dedupe(list: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export function sortConflicts(list: Conflict[]): Conflict[] {
  return list.sort(
    (x, y) =>
      SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
      (x.date ?? '').localeCompare(y.date ?? '') ||
      ((x.day + 6) % 7) - ((y.day + 6) % 7) ||
      x.start - y.start,
  );
}

export function worstSeverity(list: Conflict[]): Severity | null {
  let best: Severity | null = null;
  for (const c of list) if (best === null || SEVERITY_RANK[c.severity] < SEVERITY_RANK[best]) best = c.severity;
  return best;
}

export interface ConflictGroup {
  /** Sorted pair of owner ids. */
  owners: [string, string];
  conflicts: Conflict[];
  severity: Severity;
}

/** Group conflicts by the two things that collide (course ↔ course, course ↔ block). */
export function groupConflicts(list: Conflict[]): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>();
  for (const c of list) {
    const owners = [c.a.ownerId, c.b.ownerId].sort() as [string, string];
    const k = owners.join('~');
    if (!groups.has(k)) groups.set(k, { owners, conflicts: [], severity: c.severity });
    const g = groups.get(k)!;
    g.conflicts.push(c);
    if (SEVERITY_RANK[c.severity] < SEVERITY_RANK[g.severity]) g.severity = c.severity;
  }
  return [...groups.values()].sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
}

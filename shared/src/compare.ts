/**
 * Comparing a plan with a rearranged version of itself (schedule finder options):
 * the same week-level numbers for both, the differences in words, and section-by-section changes.
 */
import type { Plan, SeatStatus, Section } from './types.ts';
import { findConflicts, groupConflicts, type ConflictOptions } from './conflicts.ts';
import { findPackage, packageSections, planSlots, resolvePick, type CatalogIndex } from './plan.ts';
import { scoreSchedule, type ScheduleStats } from './generate.ts';
import { summarizeWeekly } from './time.ts';

export interface Choice {
  courseKey: string;
  packageId: string;
}

/** The plan with these courses switched to the given packages. Unknown ids are ignored. */
export function withChoices(plan: Plan, index: CatalogIndex, choices: Choice[]): Plan {
  const byKey = new Map(choices.map((c) => [c.courseKey, c.packageId]));
  return {
    ...plan,
    picks: plan.picks.map((p) => {
      const id = byKey.get(p.courseKey);
      if (!id || id === p.packageId) return p;
      const course = index.byKey.get(p.courseKey);
      const pkg = course ? findPackage(course, id) : null;
      return pkg ? { ...p, packageId: pkg.id, sectionIds: pkg.sectionIds } : p;
    }),
  };
}

export interface PlanSnapshot {
  /** Weekly classes of planned and enrolled courses (backups and blocked-off time don't count). */
  stats: ScheduleStats;
  /** Error-level conflicts, counted like the header: weekly course pairs plus finals clashes. */
  conflicts: number;
  /** Warning-level course pairs (e.g. a class during a one-time meeting). */
  warnings: number;
}

/**
 * Week-level numbers for a plan. `notOpen` counts only `courseKeys` (the courses being
 * rearranged), so it lines up with the generator's own count.
 */
export function snapshotPlan(
  plan: Plan,
  index: CatalogIndex,
  opts: { courseKeys: Iterable<string>; conflictOptions?: ConflictOptions },
): PlanSnapshot {
  const slots = planSlots(plan, index);
  const conflicts = findConflicts(slots, opts.conflictOptions);
  const weekly = groupConflicts(conflicts.filter((c) => c.kind !== 'final'));
  const finals = conflicts.filter((c) => c.kind === 'final' && c.severity === 'error').length;
  const keys = new Set(opts.courseKeys);
  let notOpen = 0;
  for (const p of plan.picks) {
    if (p.status === 'backup' || !keys.has(p.courseKey)) continue;
    const pkg = resolvePick(p, index).pkg;
    if (pkg && pkg.status !== 'open') notOpen++;
  }
  const { stats } = scoreSchedule(
    slots.filter((s) => s.status !== 'backup'),
    notOpen,
    'balanced',
  );
  return {
    stats,
    conflicts: weekly.filter((g) => g.severity === 'error').length + finals,
    warnings: weekly.filter((g) => g.severity === 'warning').length,
  };
}

export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface Delta {
  text: string;
  tone: DeltaTone;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** What changes going from `base` to `next`, most important first. Equal numbers are left out. */
export function compareSnapshots(base: PlanSnapshot, next: PlanSnapshot): Delta[] {
  const out: Delta[] = [];

  const fixed = base.conflicts - next.conflicts;
  if (fixed > 0) out.push({ text: `fixes ${plural(fixed, 'conflict')}`, tone: 'good' });
  if (fixed < 0) out.push({ text: plural(-fixed, 'new conflict'), tone: 'bad' });
  if (next.conflicts > 0 && fixed > 0) out.push({ text: `${plural(next.conflicts, 'conflict')} left`, tone: 'bad' });

  const warned = next.warnings - base.warnings;
  if (warned < 0) out.push({ text: `clears ${plural(-warned, 'warning')}`, tone: 'good' });
  if (warned > 0) out.push({ text: plural(warned, 'new warning'), tone: 'bad' });

  const a = base.stats;
  const b = next.stats;
  const days = b.days - a.days;
  if (days < 0) out.push({ text: `${plural(-days, 'fewer day')} on campus`, tone: 'good' });
  if (days > 0) out.push({ text: `${plural(days, 'more day')} on campus`, tone: 'bad' });

  // Small gap changes are noise next to a 50-minute class.
  const gap = b.gapMinutes - a.gapMinutes;
  if (gap <= -10) out.push({ text: `${formatDuration(-gap)} less between classes`, tone: 'good' });
  if (gap >= 10) out.push({ text: `${formatDuration(gap)} more between classes`, tone: 'bad' });

  const seats = b.notOpen - a.notOpen;
  if (seats < 0) out.push({ text: `${-seats} fewer full or waitlisted`, tone: 'good' });
  if (seats > 0) out.push({ text: `${seats} more full or waitlisted`, tone: 'bad' });

  // Earlier or later is a matter of taste, so these stay neutral.
  if (a.earliest !== null && b.earliest !== null && a.earliest !== b.earliest) {
    const d = b.earliest - a.earliest;
    out.push({ text: `starts ${formatDuration(Math.abs(d))} ${d > 0 ? 'later' : 'earlier'}`, tone: 'neutral' });
  }
  if (a.latest !== null && b.latest !== null && a.latest !== b.latest) {
    const d = b.latest - a.latest;
    out.push({ text: `done ${formatDuration(Math.abs(d))} ${d > 0 ? 'later' : 'earlier'}`, tone: 'neutral' });
  }
  return out;
}

export interface SectionSwap {
  /** Section type, e.g. "LA". */
  type: string;
  from: Section | null;
  to: Section | null;
}

export interface CourseChange {
  courseKey: string;
  displayCode: string;
  swaps: SectionSwap[];
  /** Seat status of the new package. */
  status: SeatStatus;
}

/** "M 3:00–5:50pm", or "TBA" for sections without a weekly time. */
export function sectionWhen(s: Section): string {
  return summarizeWeekly(s.meetings).join(', ') || 'TBA';
}

/**
 * Section-by-section changes from the plan to `choices`, paired by section type
 * (the old lab next to the new lab). Courses whose sections stay the same are left out.
 */
export function sectionChanges(plan: Plan, index: CatalogIndex, choices: Choice[]): CourseChange[] {
  const out: CourseChange[] = [];
  for (const choice of choices) {
    const course = index.byKey.get(choice.courseKey);
    const next = course ? findPackage(course, choice.packageId) : null;
    if (!course || !next) continue;
    const pick = plan.picks.find((p) => p.courseKey === choice.courseKey);
    const prev = pick ? resolvePick(pick, index).pkg : null;
    const before = prev ? packageSections(course, prev) : [];
    const after = packageSections(course, next);
    const removed = before.filter((s) => !next.sectionIds.includes(s.id));
    const added = after.filter((s) => !prev?.sectionIds.includes(s.id));
    if (removed.length === 0 && added.length === 0) continue;

    const types = [...new Set([...removed, ...added].map((s) => s.type))];
    const swaps: SectionSwap[] = [];
    for (const type of types) {
      const from = removed.filter((s) => s.type === type);
      const to = added.filter((s) => s.type === type);
      for (let i = 0; i < Math.max(from.length, to.length); i++) swaps.push({ type, from: from[i] ?? null, to: to[i] ?? null });
    }
    out.push({ courseKey: course.key, displayCode: course.displayCode, swaps, status: next.status });
  }
  return out;
}

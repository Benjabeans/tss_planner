import type { Course, Package } from './types.ts';
import type { Slot } from './conflicts.ts';
import { compareSlots } from './conflicts.ts';
import { packageFootprint, slotsForPackage } from './plan.ts';

export type Preference = 'balanced' | 'fewest-days' | 'compact' | 'later';

export interface GenerateConstraints {
  openOnly?: boolean;
  /** Weekdays to keep free. */
  avoidDays?: number[];
  /** No weekly class before this (minutes). */
  earliest?: number | null;
  /** No weekly class after this (minutes). */
  latest?: number | null;
}

export interface GenerateInput {
  courses: Course[];
  /** Things every schedule must avoid (enrolled courses, custom blocks). */
  fixed: Slot[];
  constraints?: GenerateConstraints;
  preference?: Preference;
  limit?: number;
  /** Search budget (packages tried). */
  maxNodes?: number;
}

export interface ScheduleStats {
  days: number;
  gapMinutes: number;
  earliest: number | null;
  latest: number | null;
  notOpen: number;
}

export interface GeneratedSchedule {
  choices: { courseKey: string; packageId: string }[];
  score: number;
  stats: ScheduleStats;
}

export interface Blocker {
  courseKey: string;
  reason: 'filtered' | 'fixed';
}

export interface GenerateResult {
  schedules: GeneratedSchedule[];
  explored: number;
  truncated: boolean;
  /** Courses with no usable section at all. */
  blockers: Blocker[];
  /** Pairs of courses that can never fit together (only computed when nothing fits). */
  incompatible: [string, string][];
}

interface Option {
  pkg: Package;
  slots: Slot[];
}

const WEIGHTS: Record<Preference, { day: number; gap: number; early: number; notOpen: number }> = {
  balanced: { day: 40, gap: 0.5, early: 0.4, notOpen: 150 },
  'fewest-days': { day: 200, gap: 0.2, early: 0.1, notOpen: 150 },
  compact: { day: 20, gap: 2, early: 0.1, notOpen: 150 },
  later: { day: 20, gap: 0.3, early: 2, notOpen: 150 },
};

/** Hard conflicts only: anything that would show as an error, plus custom-block overlaps. */
function clashes(a: Slot, b: Slot): boolean {
  const c = compareSlots(a, b);
  return c !== null && (c.kind === 'class' || c.kind === 'final' || c.kind === 'block');
}

function clashesAny(slots: Slot[], against: Slot[]): boolean {
  for (const a of slots) for (const b of against) if (clashes(a, b)) return true;
  return false;
}

function optionsFor(course: Course, fixed: Slot[], k: GenerateConstraints): { options: Option[]; blocker: Blocker['reason'] | null } {
  const filtered = course.packages.filter((pkg) => {
    if (k.openOnly && pkg.status !== 'open') return false;
    const fp = packageFootprint(course, pkg);
    if (k.avoidDays?.some((d) => fp.days.has(d))) return false;
    if (k.earliest != null && fp.earliest !== null && fp.earliest < k.earliest) return false;
    if (k.latest != null && fp.latest !== null && fp.latest > k.latest) return false;
    return true;
  });
  if (filtered.length === 0) return { options: [], blocker: 'filtered' };
  const options = filtered
    .map((pkg) => ({ pkg, slots: slotsForPackage(course, pkg, { kind: 'candidate' }) }))
    .filter((o) => !clashesAny(o.slots, fixed));
  return { options, blocker: options.length === 0 ? 'fixed' : null };
}

export function scoreSchedule(slots: Slot[], notOpen: number, preference: Preference): { score: number; stats: ScheduleStats } {
  const byDay = new Map<number, Slot[]>();
  for (const s of slots) {
    if (s.date || s.kind === 'block') continue;
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day)!.push(s);
  }
  let gap = 0;
  let early = 0;
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start);
    let end = list[0]!.start;
    for (const s of list) {
      if (s.start > end) gap += s.start - end;
      end = Math.max(end, s.end);
    }
    const first = list[0]!.start;
    early += Math.max(0, 10 * 60 - first);
    earliest = earliest === null ? first : Math.min(earliest, first);
    latest = latest === null ? end : Math.max(latest, end);
  }
  const w = WEIGHTS[preference];
  const days = byDay.size;
  return {
    score: days * w.day + gap * w.gap + early * w.early + notOpen * w.notOpen,
    stats: { days, gapMinutes: gap, earliest, latest, notOpen },
  };
}

/**
 * Find conflict-free section combinations for a set of courses, best first.
 * Depth-first search over packages, most-constrained course first, with a node budget.
 */
export function generateSchedules(input: GenerateInput): GenerateResult {
  const { courses, fixed, constraints = {}, preference = 'balanced', limit = 12, maxNodes = 150_000 } = input;
  const blockers: Blocker[] = [];
  const domains: { course: Course; options: Option[] }[] = [];
  for (const course of courses) {
    const { options, blocker } = optionsFor(course, fixed, constraints);
    if (blocker) blockers.push({ courseKey: course.key, reason: blocker });
    domains.push({ course, options });
  }
  if (blockers.length) return { schedules: [], explored: 0, truncated: false, blockers, incompatible: [] };

  domains.sort((a, b) => a.options.length - b.options.length);
  const best: GeneratedSchedule[] = [];
  const seen = new Set<string>();
  const chosen: Option[] = [];
  let explored = 0;
  let truncated = false;

  const record = () => {
    const slots = chosen.flatMap((o) => o.slots);
    const notOpen = chosen.filter((o) => o.pkg.status !== 'open').length;
    const { score, stats } = scoreSchedule(slots, notOpen, preference);
    if (best.length >= limit && score >= best[best.length - 1]!.score) return;
    // Identical weekly footprints (e.g. alias packages) would look like duplicates to the user.
    const sig = chosen.map((o, i) => `${domains[i]!.course.key}=${o.pkg.id}`).join('&');
    if (seen.has(sig)) return;
    seen.add(sig);
    best.push({
      choices: chosen.map((o, i) => ({ courseKey: domains[i]!.course.key, packageId: o.pkg.id })),
      score,
      stats,
    });
    best.sort((a, b) => a.score - b.score);
    if (best.length > limit) best.pop();
  };

  const dfs = (depth: number) => {
    if (truncated) return;
    if (depth === domains.length) {
      record();
      return;
    }
    const placed = chosen.flatMap((o) => o.slots);
    for (const opt of domains[depth]!.options) {
      if (++explored > maxNodes) {
        truncated = true;
        return;
      }
      if (clashesAny(opt.slots, placed)) continue;
      chosen.push(opt);
      dfs(depth + 1);
      chosen.pop();
    }
  };
  dfs(0);

  let incompatible: [string, string][] = [];
  if (best.length === 0 && !truncated) {
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const a = domains[i]!;
        const b = domains[j]!;
        const ok = a.options.some((x) => b.options.some((y) => !clashesAny(x.slots, y.slots)));
        if (!ok) incompatible.push([a.course.key, b.course.key]);
      }
    }
  }
  return { schedules: best, explored, truncated, blockers, incompatible };
}

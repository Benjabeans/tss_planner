import type { Catalog, Course, CustomBlock, Meeting, Package, Plan, PlanPick, Section } from './types.ts';
import type { Conflict, ConflictOptions, Slot } from './conflicts.ts';
import { findConflicts, findCrossConflicts } from './conflicts.ts';
import { formatDate, formatRange, summarizeWeekly, DAY_SHORT } from './time.ts';

export interface CatalogIndex {
  catalog: Catalog;
  byKey: Map<string, Course>;
  sectionById: Map<string, Section>;
  /** module code → listings (topic courses share a module code). */
  byModule: Map<string, Course[]>;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
  const byKey = new Map<string, Course>();
  const sectionById = new Map<string, Section>();
  const byModule = new Map<string, Course[]>();
  for (const c of catalog.courses) {
    byKey.set(c.key, c);
    for (const s of c.sections) sectionById.set(s.id, s);
    if (!byModule.has(c.moduleCode)) byModule.set(c.moduleCode, []);
    byModule.get(c.moduleCode)!.push(c);
  }
  return { catalog, byKey, sectionById, byModule };
}

export function packageSections(course: Course, pkg: Package): Section[] {
  const byId = new Map(course.sections.map((s) => [s.id, s]));
  return pkg.sectionIds.map((id) => byId.get(id)).filter((s): s is Section => !!s);
}

export function findPackage(course: Course, packageId: string): Package | null {
  return course.packages.find((p) => p.id === packageId) ?? null;
}

export function isSchedulable(m: Meeting): m is Meeting & { day: number; start: number; end: number } {
  return !m.tba && m.day !== null && m.start !== null && m.end !== null;
}

/** Slots for every timed meeting of a package. */
export function slotsForPackage(
  course: Course,
  pkg: Package,
  owner: { kind: 'pick' | 'candidate'; status?: PlanPick['status'] },
): Slot[] {
  const out: Slot[] = [];
  for (const s of packageSections(course, pkg)) {
    for (const m of s.meetings) {
      if (!isSchedulable(m)) continue;
      out.push({
        ownerId: course.key,
        ownerKind: owner.kind,
        label: `${course.displayCode} ${m.kind === 'final' ? 'Final' : m.kind === 'midterm' ? 'Midterm' : s.type}`,
        courseKey: course.key,
        sectionId: s.id,
        sectionType: s.type,
        kind: m.kind,
        day: m.day,
        date: m.date,
        start: m.start,
        end: m.end,
        status: owner.status,
      });
    }
  }
  return out;
}

export function slotsForBlock(block: CustomBlock): Slot[] {
  return block.days.map((day) => ({
    ownerId: block.id,
    ownerKind: 'block' as const,
    label: block.label,
    kind: 'block' as const,
    day,
    date: null,
    start: block.start,
    end: block.end,
  }));
}

export type PickResolution =
  | { state: 'ok' | 'changed'; course: Course; pkg: Package }
  | { state: 'missing-package'; course: Course; pkg: null }
  | { state: 'missing-course'; course: null; pkg: null };

export function resolvePick(pick: PlanPick, index: CatalogIndex): PickResolution {
  const course = index.byKey.get(pick.courseKey);
  if (!course) return { state: 'missing-course', course: null, pkg: null };
  const pkg = findPackage(course, pick.packageId);
  if (!pkg) return { state: 'missing-package', course, pkg: null };
  const state = fingerprintPackage(course, pkg) === pick.fingerprint ? 'ok' : 'changed';
  return { state, course, pkg };
}

/** All slots of a plan. Picks whose package no longer exists contribute nothing. */
export function planSlots(plan: Plan, index: CatalogIndex, opts: { excludeCourseKey?: string } = {}): Slot[] {
  const out: Slot[] = [];
  for (const pick of plan.picks) {
    if (pick.courseKey === opts.excludeCourseKey) continue;
    const r = resolvePick(pick, index);
    if (!r.pkg) continue;
    out.push(...slotsForPackage(r.course, r.pkg, { kind: 'pick', status: pick.status }));
  }
  for (const b of plan.blocks) out.push(...slotsForBlock(b));
  return out;
}

export const DEFAULT_CONFLICT_OPTIONS: ConflictOptions = { tightGapMin: 10 };

export function planConflicts(plan: Plan, index: CatalogIndex, opts: ConflictOptions = DEFAULT_CONFLICT_OPTIONS): Conflict[] {
  return findConflicts(planSlots(plan, index), opts);
}

/**
 * Conflicts a package would create if added to the plan. The course's own pick (if any)
 * is excluded — choosing another package of the same course is a swap, not a conflict.
 * Backups don't block, so they are excluded too unless `includeBackups` is set.
 */
export function candidateConflicts(
  course: Course,
  pkg: Package,
  plan: Plan,
  index: CatalogIndex,
  opts: { includeBackups?: boolean } = {},
): Conflict[] {
  const others = planSlots(plan, index, { excludeCourseKey: course.key }).filter(
    (s) => opts.includeBackups || s.status !== 'backup',
  );
  const status = plan.picks.find((p) => p.courseKey === course.key)?.status;
  return findCrossConflicts(slotsForPackage(course, pkg, { kind: 'candidate', status }), others);
}

export interface Alternative {
  pkg: Package;
  conflicts: Conflict[];
  current: boolean;
}

/** Every package of a course, with the conflicts each would have against the rest of the plan. */
export function alternativesFor(courseKey: string, plan: Plan, index: CatalogIndex): Alternative[] {
  const course = index.byKey.get(courseKey);
  if (!course) return [];
  const currentId = plan.picks.find((p) => p.courseKey === courseKey)?.packageId;
  return course.packages
    .map((pkg) => ({ pkg, conflicts: candidateConflicts(course, pkg, plan, index), current: pkg.id === currentId }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        a.conflicts.filter((c) => c.severity === 'error').length - b.conflicts.filter((c) => c.severity === 'error').length ||
        statusRank(a.pkg) - statusRank(b.pkg) ||
        (b.pkg.seatsAvailable ?? 0) - (a.pkg.seatsAvailable ?? 0),
    );
}

function statusRank(p: Package): number {
  return p.status === 'open' ? 0 : p.status === 'waitlist_only' ? 1 : 2;
}

export function planUnits(plan: Plan, index: CatalogIndex): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const pick of plan.picks) {
    if (pick.status === 'backup') continue;
    const c = index.byKey.get(pick.courseKey);
    if (!c) continue;
    min += c.unitsMin;
    max += c.unitsMax;
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Fingerprints & summaries
// ---------------------------------------------------------------------------

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function fingerprintPackage(course: Course, pkg: Package): string {
  const parts = packageSections(course, pkg).map((s) => [
    s.id,
    s.meetings.map((m) => [m.kind, m.day, m.date, m.start, m.end, m.tba]),
  ]);
  return fnv1a(JSON.stringify(parts));
}

/** "LE MWF 12:00–12:50pm; DI M 7:00–7:50pm" */
export function summarizePackage(course: Course, pkg: Package): string {
  return packageSections(course, pkg)
    .map((s) => {
      const weekly = summarizeWeekly(s.meetings);
      return `${s.type} ${weekly.length ? weekly.join(', ') : 'TBA'}`;
    })
    .join('; ');
}

export function describeMeeting(m: Meeting): string {
  if (m.tba || m.start === null || m.end === null) return 'TBA';
  const when = m.date ? formatDate(m.date, { weekday: true }) : m.day !== null ? DAY_SHORT[m.day] : '';
  return `${when} ${formatRange(m.start, m.end)}`;
}

/** Weekly footprint used by filters: which days, earliest start, latest end. */
export function packageFootprint(course: Course, pkg: Package): { days: Set<number>; earliest: number | null; latest: number | null; hasTba: boolean } {
  const days = new Set<number>();
  let earliest: number | null = null;
  let latest: number | null = null;
  let hasTba = false;
  for (const s of packageSections(course, pkg)) {
    for (const m of s.meetings) {
      if (m.kind !== 'class' || m.date) continue;
      if (!isSchedulable(m)) {
        hasTba = true;
        continue;
      }
      days.add(m.day);
      earliest = earliest === null ? m.start : Math.min(earliest, m.start);
      latest = latest === null ? m.end : Math.max(latest, m.end);
    }
  }
  return { days, earliest, latest, hasTba };
}

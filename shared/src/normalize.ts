import type {
  Catalog,
  Course,
  Meeting,
  MeetingKind,
  Package,
  RawCourse,
  RawMeeting,
  RawSection,
  RawSubject,
  RawTerm,
  SeatStatus,
  Section,
} from './types.ts';
import { dayFromCode, weekdayOfDate } from './time.ts';
import { termName } from './terms.ts';

export const TYPE_NAMES: Record<string, string> = {
  LE: 'Lecture',
  DI: 'Discussion',
  LA: 'Lab',
  SE: 'Seminar',
  IN: 'Independent study',
  CL: 'Clinical',
  TU: 'Tutorial',
  PR: 'Practicum',
  ST: 'Studio',
  CO: 'Conference',
  FW: 'Fieldwork',
  OT: 'Other',
  IT: 'Internship',
};

/** Display order of component types inside a package. */
const TYPE_ORDER = ['LE', 'SE', 'ST', 'DI', 'LA', 'TU', 'CL', 'PR', 'CO', 'FW', 'IN', 'IT', 'OT'];

/** "018" → "18", "003B" → "3B", "110" → "110". */
export function displayNumber(code: string): string {
  return code.replace(/^0+(?=\d)/, '');
}

export function courseKeyOf(raw: Pick<RawCourse, 'module_code' | 'section_family' | 'course_title'>): string {
  return `${raw.module_code}|${raw.section_family ?? ''}|${raw.course_title ?? ''}`;
}

export function parseUnits(display: string): { min: number; max: number } {
  const nums = (display.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function normalizeMeeting(m: RawMeeting): Meeting {
  const kind: MeetingKind = (['class', 'final', 'midterm', 'other'] as const).includes(m.meeting_kind as MeetingKind)
    ? (m.meeting_kind as MeetingKind)
    : 'other';
  const date = m.specific_date || null;
  const timed = m.start_minutes !== null && m.end_minutes !== null && m.end_minutes > m.start_minutes;
  const day = date ? weekdayOfDate(date) : dayFromCode(m.day_code);
  return {
    kind,
    day,
    date,
    start: timed ? m.start_minutes : null,
    end: timed ? m.end_minutes : null,
    tba: m.is_tba || !timed || day === null,
    remote: m.is_remote,
  };
}

function sectionStatus(s: RawSection): SeatStatus {
  if (s.status === 'waitlist_only') return 'waitlist_only';
  if (s.seats_available !== null && s.seats_available <= 0) return 'full';
  return 'open';
}

function normalizeSection(s: RawSection): Section {
  const [group = '000', sub = '000', type = 'OT'] = s.section_code.split('-');
  const hasWaitlist = s.waitlist_capacity !== null || s.waitlist_enrolled !== null || s.waitlist_available !== null;
  const meetings = s.meetings.map(normalizeMeeting).sort(compareMeetings);
  return {
    id: s.section_id,
    code: s.section_code,
    group,
    sub,
    type,
    typeName: TYPE_NAMES[type] ?? type,
    instructors: s.instructors ?? [],
    capacity: s.capacity,
    enrolled: s.enrolled,
    seatsAvailable: s.seats_available,
    waitlist: hasWaitlist
      ? { capacity: s.waitlist_capacity, enrolled: s.waitlist_enrolled, available: s.waitlist_available }
      : null,
    status: sectionStatus(s),
    meetings,
    text: s.section_text ?? [],
  };
}

function compareMeetings(a: Meeting, b: Meeting): number {
  const kindRank = (m: Meeting) => (m.kind === 'class' && !m.date ? 0 : m.kind === 'midterm' ? 1 : m.kind === 'final' ? 3 : 2);
  const dayRank = (m: Meeting) => (m.day === null ? 9 : (m.day + 6) % 7);
  return (
    kindRank(a) - kindRank(b) ||
    (a.date ?? '').localeCompare(b.date ?? '') ||
    dayRank(a) - dayRank(b) ||
    (a.start ?? 0) - (b.start ?? 0)
  );
}

function compareSections(a: Section, b: Section): number {
  const t = (s: Section) => {
    const i = TYPE_ORDER.indexOf(s.type);
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return a.group.localeCompare(b.group) || a.sub.localeCompare(b.sub) || t(a) - t(b) || a.code.localeCompare(b.code);
}

function packageFrom(id: string, sections: Section[]): Package {
  const sorted = [...sections].sort(compareSections);
  const seats = sorted.map((s) => s.seatsAvailable).filter((n): n is number => n !== null);
  const seatsAvailable = seats.length ? Math.min(...seats) : null;
  let status: SeatStatus = 'open';
  if (sorted.some((s) => s.status === 'waitlist_only')) status = 'waitlist_only';
  else if (sorted.some((s) => s.status === 'full')) status = 'full';
  return { id, altIds: [], sectionIds: sorted.map((s) => s.id), seatsAvailable, status };
}

/** Section-code structure: each group's "000" section plus each child sub-number. */
function structuralPackages(sections: Section[]): Package[] {
  const groups = new Map<string, Map<string, Section[]>>();
  for (const s of sections) {
    if (!groups.has(s.group)) groups.set(s.group, new Map());
    const subs = groups.get(s.group)!;
    if (!subs.has(s.sub)) subs.set(s.sub, []);
    subs.get(s.sub)!.push(s);
  }
  const out: Package[] = [];
  for (const [group, subs] of groups) {
    const base = subs.get('000') ?? [];
    const kids = [...subs.keys()].filter((k) => k !== '000').sort();
    if (kids.length === 0) out.push(packageFrom(`g:${group}`, base));
    else for (const k of kids) out.push(packageFrom(`g:${group}-${k}`, [...base, ...subs.get(k)!]));
  }
  return out;
}

const numericIdOrder = (a: string, b: string) => (a.length - b.length) || a.localeCompare(b);

/**
 * Derive the bookable packages of a course (see DESIGN.md §2.3).
 *
 * 1. With upstream event-package ids: a package is complete when it covers every
 *    instruction type that its section group (e.g. "004") has among packaged sections.
 *    Groups can differ — one lecture may come with labs, another without.
 * 2. Without ids (or when no id-package is complete): group by section code.
 */
export function derivePackages(raw: RawSection[], sections: Section[]): { packages: Package[]; extraSectionIds: string[] } {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const packaged = raw.filter((s) => s.event_package_ids?.length);

  let packages: Package[] = [];
  if (packaged.length > 0) {
    const members = new Map<string, Section[]>();
    const groupTypes = new Map<string, Set<string>>();
    for (const r of packaged) {
      const sec = byId.get(r.section_id)!;
      if (!groupTypes.has(sec.group)) groupTypes.set(sec.group, new Set());
      groupTypes.get(sec.group)!.add(sec.type);
      for (const pid of r.event_package_ids) {
        if (!members.has(pid)) members.set(pid, []);
        members.get(pid)!.push(sec);
      }
    }
    const isComplete = (ss: Section[]) => {
      const need = new Set<string>();
      for (const g of new Set(ss.map((x) => x.group))) for (const t of groupTypes.get(g) ?? []) need.add(t);
      const have = new Set(ss.map((x) => x.type));
      return need.size === have.size && [...need].every((t) => have.has(t));
    };
    // Upstream often has several package ids for the exact same sections (e.g. separate
    // seat pools). For planning they are one choice: the lowest id is primary, the rest
    // are aliases so saved picks keep resolving if upstream reshuffles ids.
    const bySig = new Map<string, { ids: string[]; ss: Section[] }>();
    for (const [pid, ss] of members) {
      if (!isComplete(ss)) continue;
      const sig = [...ss].sort(compareSections).map((x) => x.id).join(',');
      if (!bySig.has(sig)) bySig.set(sig, { ids: [], ss });
      bySig.get(sig)!.ids.push(pid);
    }
    for (const { ids, ss } of bySig.values()) {
      ids.sort(numericIdOrder);
      const pkg = packageFrom(ids[0]!, ss);
      pkg.altIds = ids.slice(1);
      packages.push(pkg);
    }
  }
  // Never leave a course with sections unplannable.
  if (packages.length === 0) packages = structuralPackages(sections);

  packages.sort((a, b) => {
    const sa = byId.get(a.sectionIds[0]!)!;
    const sb = byId.get(b.sectionIds[0]!)!;
    for (let i = 0; i < Math.max(a.sectionIds.length, b.sectionIds.length); i++) {
      const x = byId.get(a.sectionIds[i] ?? '');
      const y = byId.get(b.sectionIds[i] ?? '');
      if (!x || !y) return a.sectionIds.length - b.sectionIds.length;
      const c = compareSections(x, y);
      if (c !== 0) return c;
    }
    return compareSections(sa, sb);
  });

  const inPackage = new Set(packages.flatMap((p) => p.sectionIds));
  const extraSectionIds = sections.filter((s) => !inPackage.has(s.id)).map((s) => s.id);
  return { packages, extraSectionIds };
}

export function normalizeCourse(raw: RawCourse): Course {
  const sections = raw.sections.map(normalizeSection).sort(compareSections);
  const { packages, extraSectionIds } = derivePackages(raw.sections, sections);
  const number = displayNumber(raw.course_code);
  const units = parseUnits(raw.units_display ?? '');
  const title = (raw.course_title || raw.module_name || '').trim();
  return {
    key: courseKeyOf(raw),
    subject: raw.subject_code,
    number,
    displayCode: `${raw.subject_code} ${number}`,
    moduleCode: raw.module_code,
    title,
    moduleTitle: raw.course_title && raw.module_name && raw.course_title !== raw.module_name ? raw.module_name : null,
    subjectName: raw.subject_name,
    level: raw.academic_level,
    units: raw.units_display ?? '',
    unitsMin: units.min,
    unitsMax: units.max,
    prereqs: raw.prerequisites ?? [],
    restrictions: raw.restrictions ?? [],
    fees: raw.course_fees ?? [],
    isTopic: raw.is_topic_course,
    family: raw.section_family,
    instructors: raw.instructors ?? [],
    sections,
    packages,
    extraSectionIds,
  };
}

/** Compare course numbers naturally: 2 < 10A < 10B < 100. */
export function compareCourseNumbers(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (na !== nb) return (Number.isNaN(na) ? Infinity : na) - (Number.isNaN(nb) ? Infinity : nb);
  return a.localeCompare(b);
}

export function compareCourses(a: Course, b: Course): number {
  return a.subject.localeCompare(b.subject) || compareCourseNumbers(a.number, b.number) || a.title.localeCompare(b.title);
}

export function normalizeCatalog(args: {
  term: RawTerm | { term_code: string; last_full_refresh_at: string | null };
  courses: RawCourse[];
  subjects: RawSubject[];
  syncedAt?: string;
}): Catalog {
  const seen = new Set<string>();
  const courses: Course[] = [];
  for (const raw of args.courses) {
    const c = normalizeCourse(raw);
    // Pagination can repeat a listing; identical keys with identical first sections are duplicates.
    const sig = `${c.key}#${c.sections[0]?.id ?? ''}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    courses.push(c);
  }
  courses.sort(compareCourses);
  // Guarantee key uniqueness (should already hold; suffix as a last resort).
  const keyCount = new Map<string, number>();
  for (const c of courses) {
    const n = keyCount.get(c.key) ?? 0;
    keyCount.set(c.key, n + 1);
    if (n > 0) c.key = `${c.key}#${n}`;
  }
  const code = args.term.term_code;
  return {
    version: 1,
    term: {
      code,
      name: termName(code),
      refreshedAt: args.term.last_full_refresh_at,
      syncedAt: args.syncedAt ?? new Date().toISOString(),
      courseCount: courses.length,
      sectionCount: courses.reduce((n, c) => n + c.sections.length, 0),
    },
    subjects: args.subjects.map((s) => ({ code: s.value, name: s.label })).sort((a, b) => a.code.localeCompare(b.code)),
    courses,
  };
}

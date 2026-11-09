// ---------------------------------------------------------------------------
// Upstream (UCSD Class Planner public API) shapes. Only the fields we rely on.
// ---------------------------------------------------------------------------

export interface RawMeeting {
  meeting_kind: string;
  day_code: string | null;
  specific_date: string | null;
  start_minutes: number | null;
  end_minutes: number | null;
  is_remote: boolean;
  is_tba: boolean;
}

export interface RawSection {
  section_id: string;
  section_code: string;
  instruction_type_name: string;
  event_package_ids: string[];
  capacity: number | null;
  enrolled: number | null;
  seats_available: number | null;
  waitlist_capacity: number | null;
  waitlist_enrolled: number | null;
  waitlist_available: number | null;
  status: string;
  instructors: string[];
  meetings: RawMeeting[];
  section_text: string[];
}

export interface RawCourse {
  term_code: string;
  subject_code: string;
  course_code: string;
  module_code: string;
  module_name: string;
  course_title: string | null;
  subject_name: string;
  academic_level: string;
  complete_package_count: number;
  units_display: string;
  course_fees: string[];
  prerequisites: string[];
  restrictions: string[];
  is_topic_course: boolean;
  section_family: string | null;
  instructors: string[];
  sections: RawSection[];
}

export interface RawTerm {
  term_code: string;
  term_name: string | null;
  calendar_year: string | null;
  course_count: number;
  section_count: number;
  meeting_count: number;
  last_full_refresh_at: string | null;
  configured: boolean;
}

export interface RawSubject {
  value: string;
  label: string;
  count?: number;
}

// ---------------------------------------------------------------------------
// Normalized catalog (server → client).
// ---------------------------------------------------------------------------

/** 0 = Sunday … 6 = Saturday (JS Date convention). */
export type Day = number;

export type MeetingKind = 'class' | 'final' | 'midterm' | 'other';

export interface Meeting {
  kind: MeetingKind;
  /** Weekday. For dated meetings this is the weekday of `date`. */
  day: Day | null;
  /** ISO date for one-off meetings (finals, midterms, special sessions). */
  date: string | null;
  /** Minutes after midnight. */
  start: number | null;
  end: number | null;
  tba: boolean;
  remote: boolean;
}

export type SeatStatus = 'open' | 'full' | 'waitlist_only';

export interface Section {
  id: string;
  /** e.g. "001-001-DI" */
  code: string;
  group: string;
  sub: string;
  /** Two-letter type, e.g. "LE", "DI", "LA". */
  type: string;
  typeName: string;
  instructors: string[];
  capacity: number | null;
  enrolled: number | null;
  seatsAvailable: number | null;
  waitlist: { capacity: number | null; enrolled: number | null; available: number | null } | null;
  status: SeatStatus;
  meetings: Meeting[];
  text: string[];
}

export interface Package {
  /** Upstream event-package id, or "g:<group>[-<sub>]" when derived from section codes. */
  id: string;
  /** Other upstream package ids that bundle exactly the same sections. */
  altIds: string[];
  sectionIds: string[];
  /** Smallest seat count among components (null when unknown). */
  seatsAvailable: number | null;
  status: SeatStatus;
}

export type Level = 'LD' | 'UD' | 'GR' | string;

export interface Course {
  /** Stable listing identity: module code | section family | course title. */
  key: string;
  subject: string;
  /** Display number without zero padding, e.g. "18", "3B", "110". */
  number: string;
  /** e.g. "MATH 18" */
  displayCode: string;
  moduleCode: string;
  title: string;
  /** Generic module title when `title` is a topic title. */
  moduleTitle: string | null;
  subjectName: string;
  level: Level;
  units: string;
  unitsMin: number;
  unitsMax: number;
  prereqs: string[];
  restrictions: string[];
  fees: string[];
  isTopic: boolean;
  family: string | null;
  instructors: string[];
  sections: Section[];
  packages: Package[];
  /** Sections that are not part of any complete package (e.g. optional fieldwork). */
  extraSectionIds: string[];
}

export interface TermInfo {
  code: string;
  name: string;
  refreshedAt: string | null;
  syncedAt: string;
  courseCount: number;
  sectionCount: number;
}

export interface Subject {
  code: string;
  name: string;
}

export interface Catalog {
  version: 1;
  term: TermInfo;
  subjects: Subject[];
  courses: Course[];
}

export interface TermSummary {
  code: string;
  name: string;
  refreshedAt: string | null;
  syncedAt: string | null;
  courseCount: number;
  available: boolean;
}

// ---------------------------------------------------------------------------
// Plans (client-side in v1).
// ---------------------------------------------------------------------------

export type PickStatus = 'planned' | 'enrolled' | 'waitlisted' | 'backup';

export interface PlanPick {
  courseKey: string;
  packageId: string;
  color: string;
  status: PickStatus;
  /** Hash of the package's meetings when it was added; detects upstream changes. */
  fingerprint: string;
  /** Human-readable meetings at add time, for "times changed" messages. */
  summaryAtAdd: string;
  addedAt: string;
}

export interface CustomBlock {
  id: string;
  label: string;
  days: Day[];
  start: number;
  end: number;
  color: string;
}

export interface Plan {
  id: string;
  termCode: string;
  name: string;
  picks: PlanPick[];
  blocks: CustomBlock[];
  createdAt: string;
  updatedAt: string;
}

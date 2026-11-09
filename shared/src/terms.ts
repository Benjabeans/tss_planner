export interface TermDates {
  instructionBegins: string;
  instructionEnds: string;
  finalsBegin: string;
  finalsEnd: string;
  /** Weekday holidays with no instruction. */
  holidays: string[];
}

/**
 * UC San Diego 2026–27 academic calendar
 * (blink.ucsd.edu/instructors/resources/academic/calendars/2026.html).
 * Add next year's dates here when they are published.
 */
export const TERM_DATES: Record<string, TermDates> = {
  FA26: {
    instructionBegins: '2026-09-24',
    instructionEnds: '2026-12-04',
    finalsBegin: '2026-12-05',
    finalsEnd: '2026-12-12',
    holidays: ['2026-11-11', '2026-11-26', '2026-11-27'],
  },
  WI27: {
    instructionBegins: '2027-01-04',
    instructionEnds: '2027-03-12',
    finalsBegin: '2027-03-13',
    finalsEnd: '2027-03-20',
    holidays: ['2027-01-18', '2027-02-15'],
  },
  SP27: {
    instructionBegins: '2027-03-29',
    instructionEnds: '2027-06-04',
    finalsBegin: '2027-06-05',
    finalsEnd: '2027-06-11',
    holidays: ['2027-05-31'],
  },
};

const SEASONS: Record<string, string> = {
  FA: 'Fall',
  WI: 'Winter',
  SP: 'Spring',
  S1: 'Summer Session I',
  S2: 'Summer Session II',
  S3: 'Special Summer',
  SU: 'Summer',
};

/** "WI27" → "Winter 2027". */
export function termName(code: string): string {
  const season = SEASONS[code.slice(0, 2)] ?? code.slice(0, 2);
  const yy = code.slice(2);
  return /^\d{2}$/.test(yy) ? `${season} 20${yy}` : code;
}

/** Sort key so terms list chronologically: FA26 < WI27 < SP27 < S127. */
export function termSortKey(code: string): string {
  const order = ['WI', 'SP', 'S1', 'S2', 'S3', 'SU', 'FA'];
  const i = order.indexOf(code.slice(0, 2));
  return `${code.slice(2)}-${i === -1 ? 9 : i}`;
}

/** Undergraduate booking unit caps (students.ucsd.edu booking guide, 2026). */
export const UNIT_CAPS = [
  { id: 'first', label: 'First pass', units: 11.5 },
  { id: 'second', label: 'Second pass', units: 19.5 },
  { id: 'term', label: 'From day 1', units: 22 },
] as const;

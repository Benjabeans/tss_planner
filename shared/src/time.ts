import type { Day, Meeting } from './types.ts';

export const DAY_SHORT = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'] as const;
export const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Monday-first display order. */
export const WEEK_ORDER: Day[] = [1, 2, 3, 4, 5, 6, 0];

const UPSTREAM_DAY: Record<string, Day> = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };

export function dayFromCode(code: string | null | undefined): Day | null {
  if (!code) return null;
  return UPSTREAM_DAY[code] ?? null;
}

/** Weekday (0 = Sunday) of an ISO date, independent of the local timezone. */
export function weekdayOfDate(iso: string): Day {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}

export function formatDate(iso: string, opts: { weekday?: boolean } = {}): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  return t.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(opts.weekday ? { weekday: 'short' } : {}),
  });
}

/** 720 → "12:00pm", 545 → "9:05am". */
export function formatTime(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')}${suffix}`;
}

/** "12:00–12:50pm" or "11:00am–12:20pm". */
export function formatRange(start: number, end: number): string {
  const s = formatTime(start);
  const e = formatTime(end);
  const sameMeridiem = s.slice(-2) === e.slice(-2);
  return `${sameMeridiem ? s.slice(0, -2) : s}–${e}`;
}

/** Short hour label for calendar gutters: 480 → "8am". */
export function formatHour(min: number): string {
  const h24 = Math.floor(min / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${h24 >= 12 ? 'pm' : 'am'}`;
}

/** [1,3,5] → "MWF", [2,4] → "TuTh". */
export function formatDays(days: Iterable<Day>): string {
  const set = new Set(days);
  return WEEK_ORDER.filter((d) => set.has(d))
    .map((d) => DAY_SHORT[d])
    .join('');
}

/** Groups weekly class meetings with identical times: "MWF 12:00–12:50pm". */
export function summarizeWeekly(meetings: Meeting[]): string[] {
  const byTime = new Map<string, Set<Day>>();
  for (const m of meetings) {
    if (m.kind !== 'class' || m.date || m.tba || m.day === null || m.start === null || m.end === null) continue;
    const k = `${m.start}-${m.end}`;
    if (!byTime.has(k)) byTime.set(k, new Set());
    byTime.get(k)!.add(m.day);
  }
  return [...byTime.entries()]
    .sort((a, b) => Number(a[0].split('-')[0]) - Number(b[0].split('-')[0]))
    .map(([k, days]) => {
      const [s, e] = k.split('-').map(Number);
      return `${formatDays(days)} ${formatRange(s!, e!)}`;
    });
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

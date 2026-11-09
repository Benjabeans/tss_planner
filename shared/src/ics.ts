import type { Course, Plan } from './types.ts';
import type { CatalogIndex } from './plan.ts';
import { isSchedulable, packageSections, resolvePick } from './plan.ts';
import type { TermDates } from './terms.ts';
import { addDays, weekdayOfDate } from './time.ts';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curLen + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function localStamp(date: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${date.replace(/-/g, '')}T${hh}${mm}00`;
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** First date on/after `from` whose weekday is in `days`. */
function firstOnOrAfter(from: string, days: Set<number>): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (days.has(weekdayOfDate(d))) return d;
  }
  return from;
}

export interface IcsOptions {
  plan: Plan;
  index: CatalogIndex;
  dates: TermDates;
  now?: Date;
  includeBackups?: boolean;
}

/** Build an .ics calendar for a plan: weekly classes repeat through instruction; exams are single events. */
export function buildIcs({ plan, index, dates, now = new Date(), includeBackups = false }: IcsOptions): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TSS Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(plan.name)}`,
    ...VTIMEZONE,
  ];
  const stamp = utcStamp(now);
  // UNTIL must be UTC; 07:59:59Z the next day is still the last instruction day in Pacific time.
  const until = `${addDays(dates.instructionEnds, 1).replace(/-/g, '')}T075959Z`;

  const event = (uid: string, summary: string, description: string, body: string[]) => {
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(summary)}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    lines.push(...body, 'END:VEVENT');
  };

  for (const pick of plan.picks) {
    if (pick.status === 'backup' && !includeBackups) continue;
    const r = resolvePick(pick, index);
    if (!r.pkg) continue;
    const course: Course = r.course;
    for (const s of packageSections(course, r.pkg)) {
      const desc = [`${course.title}`, `Section ${s.code} (${s.id})`, s.instructors.join(', ')].filter(Boolean).join('\n');
      // Weekly meetings with identical times share one recurring event.
      const weekly = new Map<string, Set<number>>();
      s.meetings.forEach((m, i) => {
        if (!isSchedulable(m)) return;
        const uid = `${plan.id}-${s.id.replace(/\s+/g, '')}-${i}@tss-planner`;
        if (m.date) {
          const label = m.kind === 'final' ? 'Final' : m.kind === 'midterm' ? 'Midterm' : s.type;
          event(uid, `${course.displayCode} ${label}`, desc, [
            `DTSTART;TZID=America/Los_Angeles:${localStamp(m.date, m.start)}`,
            `DTEND;TZID=America/Los_Angeles:${localStamp(m.date, m.end)}`,
          ]);
          return;
        }
        if (m.kind !== 'class') return;
        const k = `${m.start}-${m.end}`;
        if (!weekly.has(k)) weekly.set(k, new Set());
        weekly.get(k)!.add(m.day);
      });
      for (const [k, days] of weekly) {
        const [start, end] = k.split('-').map(Number) as [number, number];
        const first = firstOnOrAfter(dates.instructionBegins, days);
        const exdates = dates.holidays.filter((h) => days.has(weekdayOfDate(h)));
        const body = [
          `DTSTART;TZID=America/Los_Angeles:${localStamp(first, start)}`,
          `DTEND;TZID=America/Los_Angeles:${localStamp(first, end)}`,
          `RRULE:FREQ=WEEKLY;BYDAY=${[...days].sort().map((d) => BYDAY[d]).join(',')};UNTIL=${until}`,
        ];
        if (exdates.length) body.push(`EXDATE;TZID=America/Los_Angeles:${exdates.map((d) => localStamp(d, start)).join(',')}`);
        event(`${plan.id}-${s.id.replace(/\s+/g, '')}-w${k}@tss-planner`, `${course.displayCode} ${s.type}`, desc, body);
      }
    }
  }

  for (const b of plan.blocks) {
    const days = new Set(b.days);
    if (!days.size) continue;
    const first = firstOnOrAfter(dates.instructionBegins, days);
    event(`${plan.id}-${b.id}@tss-planner`, b.label, '', [
      `DTSTART;TZID=America/Los_Angeles:${localStamp(first, b.start)}`,
      `DTEND;TZID=America/Los_Angeles:${localStamp(first, b.end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${[...days].sort().map((d) => BYDAY[d]).join(',')};UNTIL=${until}`,
    ]);
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

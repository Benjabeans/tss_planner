import type { Conflict } from '@shared/conflicts.ts';
import { DAY_ABBR, formatDate, formatRange } from '@shared/time.ts';

export function whenOf(c: Conflict): string {
  const day = c.date ? formatDate(c.date, { weekday: true }) : DAY_ABBR[c.day];
  return `${day} ${formatRange(c.start, c.end)}`;
}

/** One-line, plain-language explanation of a conflict. */
export function describeConflict(c: Conflict): string {
  const a = c.a.label;
  const b = c.b.label;
  switch (c.kind) {
    case 'class':
      return `${a} and ${b} overlap ${whenOf(c)}`;
    case 'final':
      return `Finals overlap: ${a} and ${b}, ${whenOf(c)}`;
    case 'exam':
      return `Exams overlap: ${a} and ${b}, ${whenOf(c)}`;
    case 'dated':
      return `${c.a.date ? a : b} falls on ${c.a.date ? b : a}, ${whenOf(c)}`;
    case 'block': {
      const block = c.a.kind === 'block' ? c.a : c.b;
      const other = c.a.kind === 'block' ? c.b : c.a;
      return `${other.label} runs into “${block.label}”, ${whenOf(c)}`;
    }
    case 'tight': {
      const gap = c.end - c.start;
      return `${gap === 0 ? 'No break' : `Only ${gap} min`} between ${a} and ${b} on ${DAY_ABBR[c.day]}`;
    }
  }
}

/** Short phrase for chips: "Conflicts with MATH 18". */
export function chipText(conflicts: Conflict[], labelFor: (owner: string) => string, selfKey: string): string | null {
  const real = conflicts.filter((c) => c.severity !== 'info');
  if (real.length === 0) return null;
  const others = [...new Set(real.flatMap((c) => [c.a.ownerId, c.b.ownerId]).filter((o) => o !== selfKey))].map(labelFor);
  const verb = real.some((c) => c.severity === 'error') ? 'Conflicts with' : 'Overlaps';
  return `${verb} ${others.slice(0, 2).join(', ')}${others.length > 2 ? ` +${others.length - 2}` : ''}`;
}

export function seatText(seats: number | null, status: 'open' | 'full' | 'waitlist_only'): string {
  if (status === 'waitlist_only') return 'Waitlist';
  if (status === 'full') return 'Full';
  if (seats === null) return 'Open';
  return `${seats} open`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

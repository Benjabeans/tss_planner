import { useMemo, type CSSProperties } from 'react';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import type { Conflict, Severity, Slot } from '@shared/conflicts.ts';
import { layoutLanes } from '@shared/layout.ts';
import { DAY_ABBR, addDays, formatDate, formatHour, formatRange, formatTime, weekdayOfDate } from '@shared/time.ts';
import { isSchedulable, packageSections } from '@shared/plan.ts';
import { usePlanner } from '../lib/planner.tsx';
import { useUi } from '../store/ui.ts';
import { describeConflict } from '../lib/describe.ts';

interface BlockItem {
  id: string;
  slot: Slot;
  color: string;
  ghost: boolean;
  status?: string;
  severity: Severity | null;
}

interface Band {
  id: string;
  start: number;
  end: number;
  severity: Severity;
  title: string;
}

interface Column {
  key: string;
  label: string;
  sub?: string;
  items: BlockItem[];
  bands: Band[];
}

const HOUR = 60;

function useColorOf() {
  const { plan } = usePlanner();
  return (slot: Slot): string => {
    if (slot.ownerKind === 'block') return plan?.blocks.find((b) => b.id === slot.ownerId)?.color ?? 'slate';
    return plan?.picks.find((p) => p.courseKey === slot.ownerId)?.color ?? (slot.ownerKind === 'candidate' ? 'slate' : 'blue');
  };
}

function worst(a: Severity | null, b: Severity): Severity {
  const rank = { error: 0, warning: 1, info: 2 };
  return a === null || rank[b] < rank[a] ? b : a;
}

function buildItems(slots: Slot[], ghosts: Slot[], conflicts: Conflict[], colorOf: (s: Slot) => string) {
  const sev = new Map<Slot, Severity>();
  for (const c of conflicts) {
    if (c.severity === 'info') continue;
    sev.set(c.a, worst(sev.get(c.a) ?? null, c.severity));
    sev.set(c.b, worst(sev.get(c.b) ?? null, c.severity));
  }
  const items: BlockItem[] = slots.map((s, i) => ({
    id: `p${i}`,
    slot: s,
    color: colorOf(s),
    ghost: false,
    status: s.status,
    severity: sev.get(s) ?? null,
  }));
  ghosts.forEach((s, i) =>
    items.push({ id: `g${i}`, slot: s, color: colorOf(s), ghost: true, severity: sev.get(s) ?? null }),
  );
  return items;
}

function bandsFor(conflicts: Conflict[]): Band[] {
  return conflicts
    .filter((c) => c.severity !== 'info')
    .map((c) => ({ id: c.id, start: c.start, end: c.end, severity: c.severity, title: describeConflict(c) }));
}

function rangeOf(items: BlockItem[]): { start: number; end: number } {
  let start = 8 * HOUR;
  let end = 18 * HOUR;
  for (const it of items) {
    start = Math.min(start, Math.floor(it.slot.start / HOUR) * HOUR);
    end = Math.max(end, Math.ceil(it.slot.end / HOUR) * HOUR);
  }
  return { start: Math.max(0, start), end: Math.min(24 * HOUR, end) };
}

export function Calendar() {
  const view = useUi((s) => s.view);
  return (
    <div className="flex flex-col gap-3">
      {view === 'week' ? <WeekView /> : <FinalsView />}
      {view === 'week' && <BelowWeek />}
    </div>
  );
}

function WeekView() {
  const { slots, conflicts, preview, plan } = usePlanner();
  const colorOf = useColorOf();
  const columns = useMemo<Column[]>(() => {
    // While previewing, the previewed courses' current blocks step aside so the ghosts show the result.
    const hidden = preview && !preview.current ? preview.courseKeys : new Set<string>();
    const visible = (c: Conflict) => !hidden.has(c.a.ownerId) && !hidden.has(c.b.ownerId);
    const weekly = slots.filter((s) => !s.date && !hidden.has(s.ownerId));
    const ghostSlots = preview && !preview.current ? preview.slots.filter((s) => !s.date) : [];
    const previewConflicts = preview && !preview.current ? preview.conflicts.filter((c) => !c.date) : [];
    const allConflicts = [...conflicts.filter((c) => !c.date && visible(c)), ...previewConflicts];
    const items = buildItems(weekly, ghostSlots, allConflicts, colorOf);
    const days = [1, 2, 3, 4, 5];
    if (items.some((i) => i.slot.day === 6)) days.push(6);
    if (items.some((i) => i.slot.day === 0)) days.push(0);
    return days.map((d) => ({
      key: String(d),
      label: DAY_ABBR[d]!,
      items: items.filter((i) => i.slot.day === d),
      bands: bandsFor(allConflicts.filter((c) => c.day === d)),
    }));
  }, [slots, conflicts, preview, plan, colorOf]);

  const empty = (plan?.picks.length ?? 0) === 0 && (plan?.blocks.length ?? 0) === 0 && !preview;
  return (
    <TimeGrid
      columns={columns}
      empty={
        empty ? (
          <>
            <CalendarClock className="mx-auto mb-2 size-6 text-faint" aria-hidden />
            <p className="font-medium text-ink">Your week is empty</p>
            <p className="mt-1 text-muted">Search for a course, then hover a section to see where it lands.</p>
          </>
        ) : null
      }
    />
  );
}

function FinalsView() {
  const { slots, conflicts, preview, termDates, plan } = usePlanner();
  const colorOf = useColorOf();
  const columns = useMemo<Column[]>(() => {
    const hidden = preview && !preview.current ? preview.courseKeys : new Set<string>();
    const finals = slots.filter((s) => s.kind === 'final' && !hidden.has(s.ownerId));
    const ghostSlots = preview && !preview.current ? preview.slots.filter((s) => s.kind === 'final') : [];
    const finalConflicts = [
      ...conflicts.filter((c) => c.kind === 'final' && !hidden.has(c.a.ownerId) && !hidden.has(c.b.ownerId)),
      ...(preview && !preview.current ? preview.conflicts.filter((c) => c.kind === 'final') : []),
    ];
    const items = buildItems(finals, ghostSlots, finalConflicts, colorOf);

    let dates: string[] = [];
    if (termDates) {
      for (let d = termDates.finalsBegin; d <= termDates.finalsEnd; d = addDays(d, 1)) dates.push(d);
    }
    for (const it of items) if (it.slot.date && !dates.includes(it.slot.date)) dates.push(it.slot.date);
    dates = dates.sort().filter((d) => weekdayOfDate(d) !== 0 || items.some((i) => i.slot.date === d));
    return dates.map((date) => ({
      key: date,
      label: DAY_ABBR[weekdayOfDate(date)]!,
      sub: formatDate(date),
      items: items.filter((i) => i.slot.date === date),
      bands: bandsFor(finalConflicts.filter((c) => c.date === date)),
    }));
  }, [slots, conflicts, preview, termDates, plan, colorOf]);

  const hasFinals = columns.some((c) => c.items.length > 0);
  return (
    <TimeGrid
      columns={columns}
      empty={
        hasFinals ? null : (
          <>
            <p className="font-medium text-ink">No finals scheduled yet</p>
            <p className="mt-1 text-muted">Final exams for the courses in your plan appear here by date.</p>
          </>
        )
      }
    />
  );
}

function TimeGrid({ columns, empty }: { columns: Column[]; empty: React.ReactNode }) {
  const range = useMemo(() => rangeOf(columns.flatMap((c) => c.items)), [columns]);
  const hours: number[] = [];
  for (let m = range.start; m < range.end; m += HOUR) hours.push(m);
  const span = (range.end - range.start) / HOUR;

  return (
    <div className="relative overflow-hidden rounded-xl border border-rule bg-surface" role="grid" aria-label="Calendar">
      <div className="grid" style={{ gridTemplateColumns: `var(--gutter) repeat(${columns.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-rule" />
        {columns.map((c) => (
          <div key={c.key} className="border-b border-l border-rule px-2 py-2 text-center" role="columnheader">
            <div className="text-[13px] font-semibold">{c.label}</div>
            {c.sub && <div className="tnum text-xs text-muted">{c.sub}</div>}
          </div>
        ))}

        <div className="relative" style={{ height: `calc(var(--hour-h) * ${span})` }}>
          {hours.map((m, i) => (
            <div
              key={m}
              className="tnum absolute right-1.5 -translate-y-1/2 text-[11px] text-muted"
              style={{ top: `calc(var(--hour-h) * ${i})` }}
            >
              {i === 0 ? '' : formatHour(m)}
            </div>
          ))}
        </div>

        {columns.map((c) => (
          <DayColumn key={c.key} column={c} range={range} span={span} />
        ))}
      </div>
      {empty && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] px-6 text-center text-[13px]">
          <div className="mx-auto max-w-xs rounded-lg bg-surface/95 px-4 py-3 shadow-[var(--shadow)]">{empty}</div>
        </div>
      )}
    </div>
  );
}

function DayColumn({ column, range, span }: { column: Column; range: { start: number; end: number }; span: number }) {
  const lanes = useMemo(
    () => layoutLanes(column.items.map((i) => ({ id: i.id, start: i.slot.start, end: i.slot.end }))),
    [column.items],
  );
  const pos = (start: number, end: number): CSSProperties => ({
    top: `calc(var(--hour-h) * ${(start - range.start) / HOUR})`,
    height: `calc(var(--hour-h) * ${(end - start) / HOUR})`,
  });

  return (
    <div
      className="relative border-l border-rule"
      style={{
        height: `calc(var(--hour-h) * ${span})`,
        backgroundImage:
          'linear-gradient(to bottom, var(--rule) 0 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--rule) 45%, transparent) 0 1px, transparent 1px)',
        backgroundSize: '100% var(--hour-h), 100% calc(var(--hour-h) / 2)',
      }}
    >
      {column.items.map((it) => (
        <CalendarBlock key={it.id} item={it} style={{ ...pos(it.slot.start, it.slot.end), ...laneStyle(lanes.get(it.id)) }} />
      ))}
      {column.bands.map((b) => (
        <div key={b.id} className="conflict-band" data-severity={b.severity} style={pos(b.start, b.end)} title={b.title} />
      ))}
    </div>
  );
}

function laneStyle(p: { lane: number; lanes: number } | undefined): CSSProperties {
  const lane = p?.lane ?? 0;
  const lanes = p?.lanes ?? 1;
  return { left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` };
}

function CalendarBlock({ item, style }: { item: BlockItem; style: CSSProperties }) {
  const { preview } = usePlanner();
  const focusCourse = useUi((s) => s.focusCourse);
  // The course whose sheet is open stays highlighted, so the sheet and its blocks read as one.
  const sheetCourse = useUi((s) => (s.sheet?.kind === 'pick' ? s.sheet.courseKey : null));
  const pulse = useUi((s) => s.pulse);
  const fresh = useUi((s) => s.fresh);
  const { slot } = item;
  const emphasis = !item.ghost && (focusCourse ?? sheetCourse) === slot.ownerId ? 'focus' : undefined;
  const minutes = slot.end - slot.start;
  const short = minutes < 45;
  const [code, type] = splitLabel(slot.label);

  const onClick = () => {
    const ui = useUi.getState();
    if (item.ghost && preview) preview.apply();
    else if (slot.ownerKind === 'block') ui.openSheet({ kind: 'block', blockId: slot.ownerId });
    else ui.openSheet({ kind: 'pick', courseKey: slot.ownerId });
  };

  const title = `${slot.label} · ${formatRange(slot.start, slot.end)}${item.severity === 'error' ? ' · conflict' : ''}${
    item.ghost ? ' (preview — click to add)' : ''
  }`;
  // Labels adapt to the block's own width (container queries in styles.css): full range when wide,
  // start time when narrow, stacked lines when the block is tall enough to hold them.
  return (
    <button
      type="button"
      className="cal-block"
      data-color={item.color}
      data-short={short || undefined}
      data-tall={minutes >= 75 || undefined}
      data-ghost={item.ghost || undefined}
      data-status={item.status}
      data-emphasis={emphasis}
      data-conflict={item.severity === 'error' ? 'error' : undefined}
      data-pulse={!item.ghost && pulse.includes(slot.ownerId) ? 'true' : undefined}
      data-fresh={!item.ghost && fresh === slot.ownerId ? 'true' : undefined}
      style={{ ...style, zIndex: item.ghost ? 4 : 2 }}
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={() => useUi.getState().setFocusCourse(slot.ownerId)}
      onMouseLeave={() => useUi.getState().setFocusCourse(null)}
    >
      <span className="cal-code">
        <span className="cal-code-text">{code}</span>
        {item.severity === 'error' && <AlertTriangle className="cal-alert" aria-hidden />}
      </span>
      {(type || !short) && (
        <span className="cal-meta tnum">
          {type && <span className="cal-type">{type}</span>}
          {!short && (
            <>
              <span className="cal-time">{formatRange(slot.start, slot.end)}</span>
              <span className="cal-start">{formatTime(slot.start).slice(0, -2)}</span>
            </>
          )}
        </span>
      )}
    </button>
  );
}

/** "CSE 110 LE" → ["CSE 110", "LE"]; custom block labels stay whole. */
function splitLabel(label: string): [string, string | null] {
  const m = label.match(/^(.*\S)\s+(LE|DI|LA|SE|IN|CL|TU|PR|ST|CO|FW|OT|IT|Final|Midterm)$/);
  return m ? [m[1]!, m[2]!] : [label, null];
}

/** Exams & one-time meetings, and anything without a time. */
function BelowWeek() {
  const { slots, conflicts, plan, data, labelFor } = usePlanner();
  const dated = slots
    .filter((s) => s.date && s.kind !== 'final')
    .sort((a, b) => a.date!.localeCompare(b.date!) || a.start - b.start);
  const datedConflicts = conflicts.filter((c) => c.kind === 'dated' || c.kind === 'exam');

  const tba: { key: string; text: string }[] = [];
  if (plan && data) {
    for (const p of plan.picks) {
      const c = data.index.byKey.get(p.courseKey);
      const pkg = c?.packages.find((x) => x.id === p.packageId);
      if (!c || !pkg) continue;
      for (const s of packageSections(c, pkg)) {
        const classes = s.meetings.filter((m) => m.kind === 'class');
        if (classes.length === 0 || classes.some((m) => !isSchedulable(m))) {
          tba.push({ key: s.id, text: `${c.displayCode} ${s.type} ${s.code}` });
        }
      }
    }
  }
  if (dated.length === 0 && tba.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {dated.length > 0 && (
        <section className="rounded-xl border border-rule bg-surface p-3">
          <h3 className="mb-2 text-[13px] font-semibold">Exams and one-time meetings</h3>
          <ul className="space-y-1 text-[13px]">
            {dated.map((s, i) => {
              const hit = datedConflicts.find((c) => c.a === s || c.b === s);
              return (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="tnum w-24 shrink-0 text-muted">{formatDate(s.date!, { weekday: true })}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {s.label} <span className="tnum text-muted">{formatRange(s.start, s.end)}</span>
                  </span>
                  {hit && (
                    <span
                      className={`flex shrink-0 items-center gap-1 text-xs ${hit.severity === 'error' ? 'text-danger' : 'text-warn'}`}
                      title={describeConflict(hit)}
                    >
                      <AlertTriangle className="size-3" aria-hidden /> overlaps{' '}
                      {labelFor(hit.a === s ? hit.b.ownerId : hit.a.ownerId)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {tba.length > 0 && (
        <section className="rounded-xl border border-rule bg-surface p-3">
          <h3 className="mb-2 text-[13px] font-semibold">Not on the calendar</h3>
          <p className="mb-1.5 text-xs text-muted">These have no fixed meeting time (TBA or arranged with the instructor).</p>
          <ul className="space-y-0.5 text-[13px]">
            {tba.map((t) => (
              <li key={t.key}>{t.text}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

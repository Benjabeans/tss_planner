import { createContext, Fragment, useContext, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Lock, Sparkles, Unlock, X } from 'lucide-react';
import type { Course, Package } from '@shared/types.ts';
import { generateSchedules, type GeneratedSchedule, type GenerateResult, type Preference, type ScheduleStats } from '@shared/generate.ts';
import { findPackage, slotsForBlock, slotsForPackage } from '@shared/plan.ts';
import {
  compareSnapshots,
  sectionChanges,
  sectionWhen,
  snapshotPlan,
  withChoices,
  type CourseChange,
  type Delta,
  type PlanSnapshot,
  type SectionSwap,
} from '@shared/compare.ts';
import { DAY_SHORT, formatTime } from '@shared/time.ts';
import { usePlanner } from '../lib/planner.tsx';
import { useIsDesktop } from '../lib/media.ts';
import { usePlanStore } from '../store/plans.ts';
import { useUi, type FinderUi } from '../store/ui.ts';
import { applySchedule } from '../lib/actions.ts';
import { Pill } from './SearchPanel.tsx';

const PREFS: { id: Preference; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'fewest-days', label: 'Fewest days' },
  { id: 'compact', label: 'Fewest gaps' },
  { id: 'later', label: 'Start later' },
];
const TIMES = Array.from({ length: 29 }, (_, i) => 7 * 60 + i * 30);

const optionLabel = (i: number) => `Option ${i + 1}`;

function gapText(min: number): string {
  if (min === 0) return 'no gaps';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${`${h ? `${h}h ` : ''}${m ? `${m}m` : ''}`.trim()} between classes`;
}

/** Short facts about a week, each kept whole when the line wraps. */
function facts(stats: ScheduleStats): string[] {
  const out = [`${stats.days} day${stats.days === 1 ? '' : 's'} on campus`, gapText(stats.gapMinutes)];
  if (stats.earliest !== null && stats.latest !== null) out.push(`${formatTime(stats.earliest)}–${formatTime(stats.latest)}`);
  return out;
}

const conflictText = (n: number) => (n === 0 ? 'No conflicts' : `${n} conflict${n === 1 ? '' : 's'}`);

/** What the calendar shows: an option index, the plan as it is, or nothing picked yet. */
function shownOf(f: FinderUi): number | 'plan' | null {
  if (f.hovered !== null) return f.hovered;
  return f.showPlan ? 'plan' : f.selected;
}

function selectOption(i: number) {
  useUi.getState().patchFinder({ selected: i, hovered: null, showPlan: false });
}

const TONE: Record<Delta['tone'], string> = { good: 'text-ok', bad: 'text-warn', neutral: 'text-muted' };

/** "fixes 2 conflicts · 1 fewer day on campus · starts 1h later", colored by whether it's better. */
function Deltas({ items }: { items: Delta[] }) {
  return (
    <>
      {items.map((d, i) => (
        <Fragment key={d.text}>
          {i > 0 && <span className="text-faint"> · </span>}
          <span className={`whitespace-nowrap ${TONE[d.tone]}`}>{d.text}</span>
        </Fragment>
      ))}
    </>
  );
}

function Facts({ items }: { items: string[] }) {
  return (
    <>
      {items.map((t, i) => (
        <Fragment key={t}>
          {i > 0 && ' · '}
          <span className="whitespace-nowrap">{t}</span>
        </Fragment>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Provider: one generator run shared by the panel and the calendar's pager
// ---------------------------------------------------------------------------

/** One option measured against the plan as it is. */
interface OptionInfo {
  snapshot: PlanSnapshot;
  deltas: Delta[];
  changes: CourseChange[];
}

interface FinderData {
  /** Courses the finder rearranges or keeps (backups are left out). */
  courseKeys: string[];
  locked: Set<string>;
  result: GenerateResult | null;
  /** The plan as it is, measured the same way as the options. */
  baseline: PlanSnapshot | null;
  /** Parallel to result.schedules. */
  options: OptionInfo[];
  apply: (index: number) => void;
}

const FinderCtx = createContext<FinderData | null>(null);

function useFinderData(): FinderData {
  const v = useContext(FinderCtx);
  if (!v) throw new Error('useFinderData outside FinderProvider');
  return v;
}

/**
 * Rearranges sections of the courses already in the plan. Enrolled courses start locked;
 * custom blocks are always respected. Backups are left out.
 */
export function FinderProvider({ children }: { children: ReactNode }) {
  const { plan, data } = usePlanner();
  const open = useUi((s) => s.finder !== null);
  const opts = useUi((s) => s.finderOpts);
  const shown = useUi((s) => (s.finder ? shownOf(s.finder) : null));
  const tightGapMin = usePlanStore((s) => s.settings.tightGapMin);

  const courseKeys = useMemo(() => plan?.picks.filter((p) => p.status !== 'backup').map((p) => p.courseKey) ?? [], [plan]);
  const locked = useMemo(
    () => new Set(opts.locked ?? plan?.picks.filter((p) => p.status === 'enrolled').map((p) => p.courseKey) ?? []),
    [opts.locked, plan],
  );

  const result = useMemo(() => {
    if (!open || !plan || !data) return null;
    const courses: Course[] = [];
    const fixed = plan.blocks.flatMap(slotsForBlock);
    for (const p of plan.picks) {
      if (p.status === 'backup') continue;
      const course = data.index.byKey.get(p.courseKey);
      if (!course) continue;
      if (locked.has(p.courseKey)) {
        const pkg = findPackage(course, p.packageId);
        if (pkg) fixed.push(...slotsForPackage(course, pkg, { kind: 'pick', status: p.status }));
      } else {
        courses.push(course);
      }
    }
    if (courses.length === 0) return null;
    return generateSchedules({
      courses,
      fixed,
      constraints: { openOnly: opts.openOnly, avoidDays: opts.avoidDays, earliest: opts.earliest, latest: opts.latest },
      preference: opts.preference,
      limit: 10,
    });
  }, [open, plan, data, locked, opts]);

  // Every option measured the same way as the plan, so the two can be compared number for number.
  const compared = useMemo(() => {
    if (!open || !plan || !data) return { baseline: null, options: [] };
    const free = courseKeys.filter((k) => !locked.has(k));
    const o = { courseKeys: free, conflictOptions: { tightGapMin } };
    const baseline = snapshotPlan(plan, data.index, o);
    const options = (result?.schedules ?? []).map((s) => {
      const snapshot = snapshotPlan(withChoices(plan, data.index, s.choices), data.index, o);
      return { snapshot, deltas: compareSnapshots(baseline, snapshot), changes: sectionChanges(plan, data.index, s.choices) };
    });
    return { baseline, options };
  }, [open, plan, data, courseKeys, locked, result, tightGapMin]);

  // Keep the week view the same height while flipping between the plan and the options.
  useEffect(() => {
    if (!result || !data) return;
    let start = Infinity;
    let end = -Infinity;
    for (const s of result.schedules) {
      for (const c of s.choices) {
        const course = data.index.byKey.get(c.courseKey);
        const pkg = course ? findPackage(course, c.packageId) : null;
        if (!course || !pkg) continue;
        for (const slot of slotsForPackage(course, pkg, { kind: 'candidate' })) {
          if (slot.date) continue;
          start = Math.min(start, slot.start);
          end = Math.max(end, slot.end);
        }
      }
    }
    const ui = useUi.getState();
    ui.setWeekExtent(Number.isFinite(start) ? { start, end } : null);
    return () => ui.setWeekExtent(null);
  }, [result, data]);

  // A new result list invalidates option numbers.
  useEffect(() => useUi.getState().patchFinder({ selected: null, hovered: null, showPlan: false }), [result]);

  // The calendar previews the option under the pointer, else the one the user picked, unless
  // they asked to see their plan as it is.
  useEffect(() => {
    const s = typeof shown === 'number' ? result?.schedules[shown] : undefined;
    useUi.getState().setSchedulePreview(s ? { label: optionLabel(shown as number), choices: s.choices } : null);
  }, [shown, result]);

  const value = useMemo<FinderData>(
    () => ({
      courseKeys,
      locked,
      result,
      baseline: compared.baseline,
      options: compared.options,
      apply: (i) => {
        const s = result?.schedules[i];
        if (!s || !data) return;
        const resolved = s.choices
          .map((c) => {
            const course = data.index.byKey.get(c.courseKey);
            const pkg = course ? findPackage(course, c.packageId) : null;
            return course && pkg ? { course, pkg } : null;
          })
          .filter((x): x is { course: Course; pkg: Package } => x !== null);
        applySchedule(resolved, optionLabel(i));
      },
    }),
    [courseKeys, locked, result, compared, data],
  );

  return <FinderCtx.Provider value={value}>{children}</FinderCtx.Provider>;
}

// ---------------------------------------------------------------------------
// Entry point: the primary action next to the calendar
// ---------------------------------------------------------------------------

export function FindButton() {
  const { plan } = usePlanner();
  const open = useUi((s) => s.finder !== null);
  const usable = plan?.picks.some((p) => p.status !== 'backup') ?? false;
  return (
    <button
      id="find-schedule"
      type="button"
      disabled={!usable && !open}
      aria-pressed={open}
      onClick={() => (open ? useUi.getState().closeFinder() : useUi.getState().openFinder())}
      title={usable ? 'Try every section combination of the courses in your plan' : 'Add courses to your plan first'}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-40 ${
        open ? 'border-accent bg-accent-soft text-ink hover:brightness-95' : 'border-transparent bg-accent text-accent-ink hover:brightness-95'
      }`}
    >
      <Sparkles className="size-4" aria-hidden /> Find a schedule
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pager: step through options while looking at the calendar
// ---------------------------------------------------------------------------

export function SchedulePager({ variant }: { variant: 'toolbar' | 'mobile' }) {
  const { result, apply, baseline, options } = useFinderData();
  const finder = useUi((s) => s.finder);
  const n = result?.schedules.length ?? 0;
  if (!finder || n === 0) return null;

  const shown = shownOf(finder);
  const step = (d: 1 | -1) => selectOption(finder.selected === null ? (d > 0 ? 0 : n - 1) : (finder.selected + d + n) % n);
  // Hovering a different option is a quick look; the toggle stays for the option the user picked.
  const glancing = typeof finder.hovered === 'number' && finder.hovered !== finder.selected;
  const comparing = !glancing && (finder.selected !== null || finder.showPlan);
  const target = finder.selected ?? 0;

  const stepper = (
    <span className="flex shrink-0 items-center">
      <IconButton label="Previous option" onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <IconButton label="Next option" onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </IconButton>
    </span>
  );
  const toggle = (
    <span className="flex shrink-0 items-center gap-1.5">
      <CompareToggle
        showingPlan={shown === 'plan'}
        option={target}
        onPlan={() => useUi.getState().patchFinder({ showPlan: true, hovered: null })}
        onOption={() => selectOption(target)}
      />
      <span className="text-muted">of {n}</span>
    </span>
  );
  const status =
    typeof shown === 'number' ? (
      <span>
        Previewing <b className="font-semibold">{optionLabel(shown)}</b> <span className="text-muted">of {n}</span>
      </span>
    ) : shown === 'plan' ? (
      <span>Showing your plan as it is</span>
    ) : (
      <span className="text-muted">
        {n} schedule{n === 1 ? '' : 's'} fit · {variant === 'mobile' ? 'step through them' : 'hover one to preview'}
      </span>
    );
  const use =
    finder.selected !== null && shown === finder.selected ? (
      <button
        type="button"
        onClick={() => apply(finder.selected!)}
        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-ink hover:brightness-95"
      >
        Use this schedule
      </button>
    ) : null;

  if (variant === 'toolbar') {
    return (
      <div className="flex min-w-0 items-center gap-2 text-[13px]" aria-live="polite">
        {stepper}
        {comparing ? toggle : <span className="min-w-0 truncate">{status}</span>}
        {use}
      </div>
    );
  }

  // Phones: the list is out of sight, so the pager carries the comparison itself.
  const info = typeof shown === 'number' ? options[shown] : undefined;
  const summary =
    shown === 'plan' && baseline ? (
      <>
        <span className={`whitespace-nowrap ${baseline.conflicts ? 'text-danger' : 'text-ok'}`}>{conflictText(baseline.conflicts)}</span>
        <span className="text-faint"> · </span>
        <Facts items={facts(baseline.stats)} />
      </>
    ) : info ? (
      info.deltas.length > 0 ? (
        <Deltas items={info.deltas} />
      ) : (
        <Facts items={[info.changes.length ? 'same days and times as your plan' : 'this is your plan', ...facts(info.snapshot.stats)]} />
      )
    ) : null;
  return (
    <div className="no-print fixed inset-x-2 bottom-[4rem] z-30 rounded-xl border border-rule-strong bg-surface px-2 py-1.5 text-[13px] shadow-[var(--shadow)] lg:hidden">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 pl-0.5" aria-live="polite">
          {comparing ? toggle : <p className="truncate pl-1">{status}</p>}
        </div>
        <IconButton label="Close schedule finder" onClick={() => useUi.getState().closeFinder()}>
          <X className="size-4" />
        </IconButton>
      </div>
      {summary && <p className="tnum mt-1 px-1.5 text-xs text-muted">{summary}</p>}
      <div className="mt-1 flex items-center gap-1.5">
        {stepper}
        <button
          type="button"
          onClick={() => useUi.getState().patchFinder({ list: true, hovered: null })}
          className="rounded-md border border-rule-strong px-2.5 py-1.5 font-medium hover:border-ink"
        >
          All options
        </button>
        <span className="ml-auto">{use}</span>
      </div>
    </div>
  );
}

/** Flip the calendar between the plan as it is and the picked option. */
function CompareToggle({
  showingPlan,
  option,
  onPlan,
  onOption,
}: {
  showingPlan: boolean;
  option: number;
  onPlan: () => void;
  onOption: () => void;
}) {
  const seg = (on: boolean) =>
    `flex items-center rounded-md px-2.5 text-[13px] font-medium ${on ? 'bg-ink text-surface' : 'text-muted hover:text-ink'}`;
  return (
    <div role="group" aria-label="Compare with your plan" className="inline-flex h-8 shrink-0 rounded-lg border border-rule-strong bg-surface p-0.5">
      <button type="button" aria-pressed={showingPlan} onClick={onPlan} className={seg(showingPlan)}>
        Your plan
      </button>
      <button type="button" aria-pressed={!showingPlan} onClick={onOption} className={seg(!showingPlan)}>
        {optionLabel(option)}
      </button>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Panel: rules and ranked options (left column on desktop, full screen on phones)
// ---------------------------------------------------------------------------

export function FinderPanel() {
  const { labelFor } = usePlanner();
  const { courseKeys, locked, result } = useFinderData();
  const opts = useUi((s) => s.finderOpts);
  const finder = useUi((s) => s.finder);
  const desktop = useIsDesktop();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const setOpts = useUi((s) => s.setFinderOpts);

  // Land keyboard focus in the panel when it opens.
  useEffect(() => headingRef.current?.focus(), []);

  const close = () => {
    useUi.getState().closeFinder();
    requestAnimationFrame(() => document.getElementById('find-schedule')?.focus());
  };
  const toggleLock = (key: string) => {
    const next = new Set(locked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpts({ locked: [...next] });
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface"
      aria-labelledby="finder-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !useUi.getState().sheet) close();
      }}
    >
      <div className="flex items-start gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="finder-title" ref={headingRef} tabIndex={-1} className="flex items-center gap-1.5 text-[15px] font-semibold outline-none">
            <Sparkles className="size-4 text-accent" aria-hidden /> Find a schedule
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Tries every section combination of your courses and ranks the ones without conflicts.
          </p>
        </div>
        <button type="button" onClick={close} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close schedule finder">
          <X className="size-4" />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto text-[13px]">
        {courseKeys.length === 0 ? (
          <p className="px-4 py-4 text-muted">Add the courses you want first. Overlaps are fine; this sorts them out.</p>
        ) : (
          <>
            <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2.5 border-b border-rule px-4 py-3">
              <span className="self-start pt-0.5 text-muted">Courses</span>
              <div>
                <ul className="flex flex-wrap gap-1.5">
                  {courseKeys.map((key) => {
                    const isLocked = locked.has(key);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => toggleLock(key)}
                          className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
                            isLocked ? 'border-ink bg-ink text-surface' : 'border-rule-strong hover:border-ink'
                          }`}
                          title={isLocked ? 'Kept exactly as planned. Click to let it move.' : 'Free to rearrange. Click to keep its current sections.'}
                          aria-pressed={isLocked}
                        >
                          {isLocked ? <Lock className="size-3" aria-hidden /> : <Unlock className="size-3 text-faint" aria-hidden />}
                          {labelFor(key)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-xs text-muted">Locked courses keep their sections. Blocked-off time always counts.</p>
              </div>

              <span className="text-muted">Days off</span>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5].map((d) => (
                  <Pill
                    key={d}
                    active={opts.avoidDays.includes(d)}
                    onClick={() =>
                      setOpts({ avoidDays: opts.avoidDays.includes(d) ? opts.avoidDays.filter((x) => x !== d) : [...opts.avoidDays, d] })
                    }
                  >
                    {DAY_SHORT[d]}
                  </Pill>
                ))}
              </div>

              <span className="text-muted">Between</span>
              <div className="flex items-center gap-1.5">
                <TimeSelect label="Earliest start" value={opts.earliest} onChange={(v) => setOpts({ earliest: v })} />
                <span className="text-muted">and</span>
                <TimeSelect label="Latest end" value={opts.latest} onChange={(v) => setOpts({ latest: v })} />
              </div>

              <span />
              <label className="flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="checkbox"
                  checked={opts.openOnly}
                  onChange={(e) => setOpts({ openOnly: e.target.checked })}
                  className="size-3.5 accent-[var(--accent)]"
                />
                Only sections with open seats
              </label>
            </div>

            <div className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="font-semibold">Schedules that fit</h3>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                  Prefer
                  <select
                    value={opts.preference}
                    onChange={(e) => setOpts({ preference: e.target.value as Preference })}
                    className="rounded-md border border-rule-strong bg-surface px-1.5 py-0.5 text-[13px] text-ink"
                  >
                    {PREFS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Results result={result} finder={finder} desktop={desktop} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Results({ result, finder, desktop }: { result: GenerateResult | null; finder: FinderUi | null; desktop: boolean }) {
  const { labelFor } = usePlanner();
  const { baseline, options } = useFinderData();
  if (!result) return <p className="text-muted">Unlock at least one course to rearrange.</p>;
  if (result.blockers.length > 0) {
    return (
      <ul className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-danger">
        {result.blockers.map((b) => (
          <li key={b.courseKey}>
            <b>{labelFor(b.courseKey)}</b>:{' '}
            {b.reason === 'filtered' ? 'no section matches these rules.' : 'every section overlaps your locked courses or blocked-off time.'}
          </li>
        ))}
      </ul>
    );
  }
  if (result.schedules.length === 0) {
    return (
      <div className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
        {result.incompatible.length > 0 ? (
          <ul className="space-y-1">
            {result.incompatible.map(([a, b]) => (
              <li key={`${a}~${b}`}>
                <b>{labelFor(a)}</b> and <b>{labelFor(b)}</b> can never fit together: every combination overlaps. Keep one as a backup or
                put them in separate plans.
              </li>
            ))}
          </ul>
        ) : result.truncated ? (
          'Too many combinations to check. Lock a course or add rules to narrow it down.'
        ) : (
          'No combination fits all of these courses together. Try fewer rules or lock fewer courses.'
        )}
      </div>
    );
  }
  const selected = finder?.selected ?? null;
  return (
    <div data-option-list onMouseLeave={() => useUi.getState().patchFinder({ hovered: null })}>
      {baseline && <BaselineCard snapshot={baseline} pinned={finder?.showPlan ?? false} desktop={desktop} />}
      <ol className="mt-1.5 space-y-1.5">
        {result.schedules.map((s, i) =>
          options[i] ? (
            <OptionCard
              key={s.choices.map((c) => c.packageId).join('|')}
              index={i}
              schedule={s}
              info={options[i]}
              selected={selected === i}
              desktop={desktop}
            />
          ) : null,
        )}
      </ol>
      <p className="mt-2.5 text-xs text-muted">
        {desktop ? 'Hover an option to preview it on your calendar, click to pick it.' : 'Tap an option to see it on your calendar.'}{' '}
        Dashed outlines mark where sections are now. Checked {result.explored.toLocaleString()} combinations
        {result.truncated ? ' (stopped early; lock a course to search the rest)' : ''}.
      </p>
    </div>
  );
}

/** Arrow keys move between "Your plan" and the options. */
function onListKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const all = [...(e.currentTarget.closest('[data-option-list]')?.querySelectorAll<HTMLButtonElement>('button[data-option]') ?? [])];
  const at = all.indexOf(e.currentTarget);
  all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
}

/** The plan as it is, measured like the options, so each option can be read against it. */
function BaselineCard({ snapshot, pinned, desktop }: { snapshot: PlanSnapshot; pinned: boolean; desktop: boolean }) {
  const choose = () => {
    const ui = useUi.getState();
    if (desktop) {
      ui.patchFinder({ showPlan: true, hovered: null });
    } else {
      ui.patchFinder({ showPlan: true, hovered: null, list: false });
      ui.setMobileTab('calendar');
    }
  };
  const items = facts(snapshot.stats);
  if (snapshot.stats.notOpen > 0) items.push(`${snapshot.stats.notOpen} full or waitlisted`);
  return (
    <div
      onMouseEnter={() => useUi.getState().patchFinder({ hovered: 'plan' })}
      className={`rounded-lg border border-dashed ${pinned ? 'border-ink bg-surface-2' : 'border-rule-strong hover:border-ink hover:bg-surface-2/60'}`}
    >
      <button
        type="button"
        data-option="plan"
        aria-pressed={pinned}
        onFocus={() => useUi.getState().patchFinder({ showPlan: true })}
        onClick={choose}
        onKeyDown={onListKeyDown}
        className="w-full rounded-lg px-3 py-2 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-semibold">Your plan</span>
          <span className="text-xs text-muted">as it is now</span>
          <span className={`ml-auto text-xs font-medium ${snapshot.conflicts ? 'text-danger' : 'text-ok'}`}>{conflictText(snapshot.conflicts)}</span>
        </span>
        <span className="tnum mt-0.5 block text-xs text-muted">
          <Facts items={items} />
        </span>
      </button>
    </div>
  );
}

function OptionCard({
  index,
  schedule,
  info,
  selected,
  desktop,
}: {
  index: number;
  schedule: GeneratedSchedule;
  info: OptionInfo;
  selected: boolean;
  desktop: boolean;
}) {
  const { apply } = useFinderData();
  const { changes, deltas, snapshot } = info;

  const choose = () => {
    const ui = useUi.getState();
    if (desktop) {
      selectOption(index);
    } else {
      // Phones can't show the list and the calendar at once: go look at it.
      ui.patchFinder({ selected: index, hovered: null, showPlan: false, list: false });
      ui.setMobileTab('calendar');
    }
  };

  return (
    <li
      onMouseEnter={() => useUi.getState().patchFinder({ hovered: index })}
      className={`rounded-lg border ${selected ? 'border-ink bg-accent-soft/40' : 'border-rule hover:border-ink hover:bg-accent-soft/25'}`}
    >
      <button
        type="button"
        data-option={index}
        aria-expanded={selected}
        onFocus={() => selectOption(index)}
        onClick={choose}
        onKeyDown={onListKeyDown}
        className="w-full rounded-lg px-3 py-2 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-semibold">{optionLabel(index)}</span>
          <span className="text-xs text-muted">
            {changes.length === 0 ? 'your plan as it is' : `${changes.length} course${changes.length === 1 ? '' : 's'} change`}
          </span>
          {schedule.stats.notOpen > 0 && (
            <span className="ml-auto text-xs font-medium text-warn">
              {schedule.stats.notOpen} full or waitlisted
            </span>
          )}
        </span>
        <span className="tnum mt-0.5 block text-xs text-muted">
          <Facts items={facts(snapshot.stats)} />
        </span>
        {changes.length > 0 && (
          <span className="tnum mt-0.5 block text-xs font-medium">
            {deltas.length > 0 ? <Deltas items={deltas} /> : <span className="text-muted">Same days and times as your plan</span>}
          </span>
        )}
      </button>
      {selected && (
        <div className="border-t border-rule px-3 pt-2 pb-2.5">
          {changes.length === 0 ? (
            <p className="text-xs text-muted">This is the plan you already have.</p>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {changes.map((ch) => (
                  <Fragment key={ch.courseKey}>
                    {ch.swaps.map((sw, i) => (
                      <Fragment key={`${sw.type}${i}`}>
                        <dt className="whitespace-nowrap font-semibold">
                          {i === 0 ? ch.displayCode : ''} <span className="font-normal text-muted">{sw.type}</span>
                        </dt>
                        <dd className="tnum">
                          <SwapText swap={sw} />
                        </dd>
                      </Fragment>
                    ))}
                    {ch.status !== 'open' && (
                      <>
                        <dt />
                        <dd className="text-warn">{ch.status === 'waitlist_only' ? 'Waitlist only' : 'Full'}</dd>
                      </>
                    )}
                  </Fragment>
                ))}
              </dl>
              <button
                type="button"
                onClick={() => apply(index)}
                className="mt-2.5 w-full rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:brightness-95"
              >
                Use this schedule
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** One section's move: "M 3:00–5:50pm → W 3:00–5:50pm". */
function SwapText({ swap }: { swap: SectionSwap }) {
  const { from, to } = swap;
  const code = (s: { code: string }) => s.code.slice(0, 7);
  if (from && to) {
    const was = sectionWhen(from);
    const now = sectionWhen(to);
    if (was === now) {
      return (
        <span title={`${from.code} → ${to.code}`}>
          {now} <span className="text-muted">· same time, section {code(to)}</span>
        </span>
      );
    }
    return (
      <span title={`${from.code} → ${to.code}`}>
        <span className="text-muted line-through">{was}</span> <span className="text-muted">→</span> {now}
      </span>
    );
  }
  if (to) {
    return (
      <span title={to.code}>
        <span className="text-ok">adds</span> {sectionWhen(to)}
      </span>
    );
  }
  return (
    <span title={from!.code}>
      <span className="text-muted line-through">{sectionWhen(from!)}</span> <span className="text-muted">dropped</span>
    </span>
  );
}

function TimeSelect({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="tnum rounded-md border border-rule-strong bg-surface px-1.5 py-0.5"
    >
      <option value="">any time</option>
      {TIMES.map((m) => (
        <option key={m} value={m}>
          {formatTime(m)}
        </option>
      ))}
    </select>
  );
}

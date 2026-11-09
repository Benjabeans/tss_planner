import { createContext, Fragment, useContext, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Lock, Sparkles, Unlock, X } from 'lucide-react';
import type { Course, Package } from '@shared/types.ts';
import { generateSchedules, type GeneratedSchedule, type GenerateResult, type Preference } from '@shared/generate.ts';
import { findPackage, packageSections, slotsForBlock, slotsForPackage } from '@shared/plan.ts';
import { DAY_SHORT, formatTime, summarizeWeekly } from '@shared/time.ts';
import { usePlanner } from '../lib/planner.tsx';
import { useIsDesktop } from '../lib/media.ts';
import { useUi } from '../store/ui.ts';
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

/** Short facts about a schedule, each kept whole when the line wraps. */
function facts(s: GeneratedSchedule): string[] {
  const out = [`${s.stats.days} day${s.stats.days === 1 ? '' : 's'} on campus`, gapText(s.stats.gapMinutes)];
  if (s.stats.earliest !== null && s.stats.latest !== null) out.push(`${formatTime(s.stats.earliest)}–${formatTime(s.stats.latest)}`);
  return out;
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

interface FinderData {
  /** Courses the finder rearranges or keeps (backups are left out). */
  courseKeys: string[];
  locked: Set<string>;
  result: GenerateResult | null;
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
  const active = useUi((s) => (s.finder ? (s.finder.hovered ?? s.finder.selected) : null));

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

  // A new result list invalidates option numbers.
  useEffect(() => useUi.getState().patchFinder({ selected: null, hovered: null }), [result]);

  // The calendar previews the option under the pointer, else the one the user picked.
  useEffect(() => {
    const s = active !== null ? result?.schedules[active] : undefined;
    useUi.getState().setSchedulePreview(s ? { label: optionLabel(active!), choices: s.choices } : null);
  }, [active, result]);

  const value = useMemo<FinderData>(
    () => ({
      courseKeys,
      locked,
      result,
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
    [courseKeys, locked, result, data],
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
  const { result, apply } = useFinderData();
  const finder = useUi((s) => s.finder);
  const n = result?.schedules.length ?? 0;
  if (!finder || n === 0) return null;

  const shown = finder.hovered ?? finder.selected;
  const select = (i: number) => useUi.getState().patchFinder({ selected: i, hovered: null });
  const step = (d: 1 | -1) => select(finder.selected === null ? (d > 0 ? 0 : n - 1) : (finder.selected + d + n) % n);
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
  const status =
    shown === null ? (
      <span className="text-muted">
        {n} schedule{n === 1 ? '' : 's'} fit · {variant === 'mobile' ? 'step through them' : 'hover one to preview'}
      </span>
    ) : (
      <span>
        Previewing <b className="font-semibold">{optionLabel(shown)}</b> <span className="text-muted">of {n}</span>
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
        <span className="min-w-0 truncate">{status}</span>
        {use}
      </div>
    );
  }

  const s = shown !== null ? result!.schedules[shown] : null;
  return (
    <div className="no-print fixed inset-x-2 bottom-[4rem] z-30 rounded-xl border border-rule-strong bg-surface px-2 py-1.5 text-[13px] shadow-[var(--shadow)] lg:hidden">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 pt-1 pl-1.5" aria-live="polite">
          <p className="truncate">{status}</p>
          {s && (
            <p className="tnum text-xs text-muted">
              <Facts items={facts(s)} />
            </p>
          )}
        </div>
        <IconButton label="Close schedule finder" onClick={() => useUi.getState().closeFinder()}>
          <X className="size-4" />
        </IconButton>
      </div>
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
              <Results result={result} selected={finder?.selected ?? null} desktop={desktop} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Results({ result, selected, desktop }: { result: GenerateResult | null; selected: number | null; desktop: boolean }) {
  const { labelFor } = usePlanner();
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
  return (
    <>
      <ol className="space-y-1.5" onMouseLeave={() => useUi.getState().patchFinder({ hovered: null })}>
        {result.schedules.map((s, i) => (
          <OptionCard key={s.choices.map((c) => c.packageId).join('|')} index={i} schedule={s} selected={selected === i} desktop={desktop} />
        ))}
      </ol>
      <p className="mt-2.5 text-xs text-muted">
        {desktop ? 'Hover an option to preview it on your calendar, click to pick it.' : 'Tap an option to see it on your calendar.'}{' '}
        Checked {result.explored.toLocaleString()} combinations
        {result.truncated ? ' (stopped early; lock a course to search the rest)' : ''}.
      </p>
    </>
  );
}

function OptionCard({ index, schedule, selected, desktop }: { index: number; schedule: GeneratedSchedule; selected: boolean; desktop: boolean }) {
  const { plan, data } = usePlanner();
  const { apply } = useFinderData();

  // What would change, section by section, compared with the plan as it is.
  const changes = useMemo(() => {
    if (!plan || !data) return [];
    return schedule.choices.flatMap((c) => {
      const course = data.index.byKey.get(c.courseKey);
      const pkg = course ? findPackage(course, c.packageId) : null;
      const cur = plan.picks.find((p) => p.courseKey === c.courseKey);
      if (!course || !pkg || cur?.packageId === pkg.id) return [];
      const was = cur ? findPackage(course, cur.packageId) : null;
      const sections = packageSections(course, pkg).filter((s) => !was?.sectionIds.includes(s.id));
      return [{ key: c.courseKey, label: course.displayCode, sections, status: pkg.status }];
    });
  }, [schedule, plan, data]);

  const choose = () => {
    const ui = useUi.getState();
    if (desktop) {
      ui.patchFinder({ selected: index });
    } else {
      // Phones can't show the list and the calendar at once: go look at it.
      ui.patchFinder({ selected: index, hovered: null, list: false });
      ui.setMobileTab('calendar');
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(e.currentTarget.closest('ol')?.querySelectorAll<HTMLButtonElement>('button[data-option]') ?? [])];
    const at = all.indexOf(e.currentTarget);
    all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
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
        onFocus={() => useUi.getState().patchFinder({ selected: index })}
        onClick={choose}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg px-3 py-2 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-semibold">{optionLabel(index)}</span>
          <span className="text-xs text-muted">
            {changes.length === 0 ? 'your current plan' : `${changes.length} course${changes.length === 1 ? '' : 's'} change`}
          </span>
          {schedule.stats.notOpen > 0 && (
            <span className="ml-auto text-xs font-medium text-warn">
              {schedule.stats.notOpen} full or waitlisted
            </span>
          )}
        </span>
        <span className="tnum mt-0.5 block text-xs text-muted">
          <Facts items={facts(schedule)} />
        </span>
      </button>
      {selected && (
        <div className="border-t border-rule px-3 pt-2 pb-2.5">
          {changes.length === 0 ? (
            <p className="text-xs text-muted">This is the plan you already have.</p>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {changes.map((ch) => (
                  <Fragment key={ch.key}>
                    <dt className="font-semibold">{ch.label}</dt>
                    <dd className="tnum">
                      {ch.sections.map((s) => (
                        <span key={s.id} className="block">
                          {s.type} {s.code.slice(0, 7)}{' '}
                          <span className="text-muted">{summarizeWeekly(s.meetings).join(', ') || 'TBA'}</span>
                        </span>
                      ))}
                      {ch.status !== 'open' && <span className="block text-warn">{ch.status === 'waitlist_only' ? 'Waitlist only' : 'Full'}</span>}
                    </dd>
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

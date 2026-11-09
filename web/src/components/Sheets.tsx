import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, X } from 'lucide-react';
import type { Course, CustomBlock, PickStatus } from '@shared/types.ts';
import type { ConflictGroup } from '@shared/conflicts.ts';
import { alternativesFor, packageSections } from '@shared/plan.ts';
import { COURSE_COLORS } from '@shared/colors.ts';
import { UNIT_CAPS } from '@shared/terms.ts';
import { DAY_SHORT, formatTime, summarizeWeekly } from '@shared/time.ts';
import { usePlanner } from '../lib/planner.tsx';
import { usePlanStore, newBlockId } from '../store/plans.ts';
import { useUi } from '../store/ui.ts';
import { addPackage, removeCourse, setStatus } from '../lib/actions.ts';
import { describeConflict, seatText } from '../lib/describe.ts';
import { STATUS_LABEL, PickHealth } from './PlanTable.tsx';
import { GenerateSheet } from './GenerateSheet.tsx';
import { CourseDetails } from './CourseCard.tsx';
import { Pill } from './SearchPanel.tsx';

export function SheetHost() {
  const sheet = useUi((s) => s.sheet);
  const close = () => useUi.getState().openSheet(null);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  if (!sheet) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex justify-start" role="dialog" aria-modal="true">
      {/* Sheets open over the search panel so calendar previews stay visible. */}
      <button type="button" className="absolute inset-0 bg-ink/15 lg:bg-transparent" aria-label="Close panel" onClick={close} />
      <div className="relative flex h-full w-full max-w-md flex-col border-r border-rule bg-surface shadow-[var(--shadow)] lg:max-w-[400px]">
        {sheet.kind === 'pick' && <PickSheet courseKey={sheet.courseKey} onClose={close} />}
        {sheet.kind === 'conflicts' && <ConflictSheet focus={sheet.focus} onClose={close} />}
        {sheet.kind === 'block' && <BlockSheet blockId={sheet.blockId} onClose={close} />}
        {sheet.kind === 'settings' && <SettingsSheet onClose={close} />}
        {sheet.kind === 'generate' && <GenerateSheet onClose={close} />}
      </div>
    </div>
  );
}

function SheetFrame({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="flex items-start gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {sub && <div className="mt-0.5 text-[13px] text-muted">{sub}</div>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
    </>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 mb-1.5 text-[13px] font-semibold first:mt-0">{children}</h3>;
}

// ---------------------------------------------------------------------------
// Course in plan: status, color, swap section, move, remove
// ---------------------------------------------------------------------------

function PickSheet({ courseKey, onClose }: { courseKey: string; onClose: () => void }) {
  const { plan, data } = usePlanner();
  const pick = plan?.picks.find((p) => p.courseKey === courseKey);
  const course = data?.index.byKey.get(courseKey);
  if (!plan || !pick || !course || !data) {
    return (
      <SheetFrame title="Course not in plan" onClose={onClose}>
        <p className="text-[13px] text-muted">This course isn’t in the current plan anymore.</p>
      </SheetFrame>
    );
  }
  return (
    <SheetFrame
      title={`${course.displayCode} · ${course.title}`}
      sub={`${course.units}${course.moduleTitle ? ` · ${course.moduleTitle}` : ''}`}
      onClose={onClose}
    >
      <PickHealth pickKey={courseKey} />
      <H>Status</H>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(STATUS_LABEL) as PickStatus[]).map((s) => (
          <Pill key={s} active={pick.status === s} onClick={() => setStatus(courseKey, s)}>
            {STATUS_LABEL[s]}
          </Pill>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">Backups show dashed, don’t count toward units, and their overlaps are only noted, not flagged.</p>

      <H>Color</H>
      <div className="flex flex-wrap gap-1.5">
        {COURSE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            data-color={c}
            onClick={() => usePlanStore.getState().setPickColor(plan.id, courseKey, c)}
            className="flex size-7 items-center justify-center rounded-md"
            style={{ background: 'var(--fill)', boxShadow: `inset 0 0 0 ${pick.color === c ? 2 : 1}px var(--edge)` }}
            aria-label={`Color ${c}`}
            aria-pressed={pick.color === c}
          >
            {pick.color === c && <Check className="size-3.5" style={{ color: 'var(--cink)' }} />}
          </button>
        ))}
      </div>

      <H>Sections</H>
      <SwapList course={course} />

      <H>Move to another plan</H>
      <MoveToPlan courseKey={courseKey} />

      <H>About this course</H>
      <CourseDetails course={course} />

      <div className="mt-6 border-t border-rule pt-3">
        <button
          type="button"
          onClick={() => removeCourse(courseKey, course.displayCode)}
          className="rounded-md border border-danger/40 px-3 py-1.5 text-[13px] font-medium text-danger hover:bg-danger-soft"
        >
          Remove {course.displayCode} from plan
        </button>
      </div>
    </SheetFrame>
  );
}

/** Every package of a course with its conflicts against the rest of the plan; hover to preview, click to swap. */
function SwapList({ course, onlyFixes = false, limit }: { course: Course; onlyFixes?: boolean; limit?: number }) {
  const { plan, data, labelFor } = usePlanner();
  const alts = useMemo(() => (plan && data ? alternativesFor(course.key, plan, data.index) : []), [course, plan, data]);
  const setPreview = useUi((s) => s.setPreview);
  const shown = (onlyFixes ? alts.filter((a) => !a.current && !a.conflicts.some((c) => c.severity === 'error')) : alts).slice(0, limit);

  if (shown.length === 0) {
    return <p className="text-[13px] text-muted">{onlyFixes ? `No other section of ${course.displayCode} avoids this.` : 'No sections listed.'}</p>;
  }
  return (
    <ul className="space-y-1">
      {shown.map(({ pkg, conflicts, current }) => {
        const errors = conflicts.filter((c) => c.severity === 'error');
        const others = [...new Set(errors.flatMap((c) => [c.a.ownerId, c.b.ownerId]).filter((o) => o !== course.key))].map(labelFor);
        return (
          <li key={pkg.id}>
            <button
              type="button"
              disabled={current}
              onMouseEnter={() => setPreview({ courseKey: course.key, packageId: pkg.id })}
              onMouseLeave={() => setPreview(null)}
              onFocus={() => setPreview({ courseKey: course.key, packageId: pkg.id })}
              onBlur={() => setPreview(null)}
              onClick={() => {
                setPreview(null);
                addPackage(course, pkg);
              }}
              className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] ${
                current ? 'border-ink bg-accent-soft/50' : 'border-rule hover:border-ink hover:bg-accent-soft/40'
              }`}
            >
              {packageSections(course, pkg).map((s) => (
                <div key={s.id} className="flex gap-2">
                  <span className="w-6 font-semibold">{s.type}</span>
                  <span className="tnum w-[4.6rem] text-muted">{s.code.slice(0, 7)}</span>
                  <span className="tnum min-w-0 flex-1 truncate">{summarizeWeekly(s.meetings).join(', ') || 'TBA'}</span>
                </div>
              ))}
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                {current ? (
                  <span className="font-medium">Current</span>
                ) : errors.length ? (
                  <span className="flex items-center gap-1 font-medium text-danger">
                    <AlertTriangle className="size-3" /> Conflicts with {others.join(', ')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-medium text-ok">
                    <Check className="size-3" /> Fits
                  </span>
                )}
                <span className={`tnum ml-auto ${pkg.status === 'open' ? 'text-muted' : 'text-warn'}`}>
                  {seatText(pkg.seatsAvailable, pkg.status)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MoveToPlan({ courseKey }: { courseKey: string }) {
  const { plan, termCode } = usePlanner();
  const plans = usePlanStore((s) => s.plans);
  if (!plan || !termCode) return null;
  const others = Object.values(plans).filter((p) => p.termCode === termCode && p.id !== plan.id);
  const move = (to: string) => {
    const before = plan;
    usePlanStore.getState().movePick(plan.id, courseKey, to);
    useUi.getState().openSheet(null);
    useUi.getState().pushToast({ tone: 'neutral', message: `Moved to ${usePlanStore.getState().plans[to]?.name}.`, undo: before });
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {others.map((p) => (
        <button key={p.id} type="button" onClick={() => move(p.id)} className="rounded-md border border-rule-strong px-2 py-1 text-xs font-medium hover:border-ink">
          {p.name}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          const id = usePlanStore.getState().createPlan(termCode);
          usePlanStore.getState().setActive(termCode, plan.id);
          move(id);
        }}
        className="rounded-md border border-dashed border-rule-strong px-2 py-1 text-xs font-medium hover:border-ink"
      >
        New plan
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict center
// ---------------------------------------------------------------------------

function ConflictSheet({ focus, onClose }: { focus?: string; onClose: () => void }) {
  const { groups } = usePlanner();
  const real = groups.filter((g) => g.severity !== 'info');
  const notes = groups.filter((g) => g.severity === 'info');
  const ordered = focus ? [...real].sort((a, b) => Number(b.owners.includes(focus)) - Number(a.owners.includes(focus))) : real;

  return (
    <SheetFrame
      title={real.length ? `${real.length} thing${real.length === 1 ? '' : 's'} to sort out` : 'No conflicts'}
      sub={real.length ? 'Swap a section, keep one as a backup, or split them across plans.' : 'Everything in this plan fits together.'}
      onClose={onClose}
    >
      {real.length > 0 && (
        <button
          type="button"
          onClick={() => useUi.getState().openSheet({ kind: 'generate' })}
          className="mb-3 w-full rounded-lg border border-dashed border-rule-strong px-3 py-2 text-left text-[13px] hover:border-ink"
        >
          <b>Find a schedule</b> <span className="text-muted">tries every section combination for you</span>
        </button>
      )}
      <div className="space-y-3">
        {ordered.map((g) => (
          <ConflictCard key={g.owners.join('~')} group={g} />
        ))}
      </div>
      {notes.length > 0 && (
        <>
          <H>Notes</H>
          <ul className="space-y-1 text-[13px] text-muted">
            {notes.flatMap((g) => g.conflicts).map((c) => (
              <li key={c.id}>{describeConflict(c)}</li>
            ))}
          </ul>
        </>
      )}
    </SheetFrame>
  );
}

function ConflictCard({ group }: { group: ConflictGroup }) {
  const { data, plan, labelFor } = usePlanner();
  const [open, setOpen] = useState<string | null>(null);
  const tone = group.severity === 'error' ? 'border-danger/50' : 'border-warn/50';
  const sides = group.owners
    .map((o) => ({ id: o, course: data?.index.byKey.get(o) ?? null, block: plan?.blocks.find((b) => b.id === o) ?? null }))
    .filter((s) => s.course || s.block);
  const anyFix = sides.some(
    (s) => s.course && plan && data && alternativesFor(s.course.key, plan, data.index).some((a) => !a.current && !a.conflicts.some((c) => c.severity === 'error')),
  );

  return (
    <div className={`rounded-lg border ${tone} p-3`}>
      <div className="flex items-center gap-2 text-[13.5px] font-semibold">
        <AlertTriangle className={`size-4 ${group.severity === 'error' ? 'text-danger' : 'text-warn'}`} aria-hidden />
        {labelFor(group.owners[0])} <ArrowRightLeft className="size-3.5 text-muted" aria-hidden /> {labelFor(group.owners[1])}
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[13px]">
        {group.conflicts.map((c) => (
          <li key={c.id} className="text-muted">
            {describeConflict(c)}
            {c.involvesEnrolled && <span className="ml-1 font-medium text-danger">(enrolled course)</span>}
          </li>
        ))}
      </ul>
      {group.conflicts.some((c) => c.kind === 'final') && (
        <p className="mt-1.5 text-xs text-muted">Final exam clashes are usually resolved with the instructors — contact both early in the quarter.</p>
      )}

      <div className="mt-2.5 space-y-2">
        {sides.map((s) =>
          s.course ? (
            <div key={s.id}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium">{s.course.displayCode}:</span>
                <ActionButton onClick={() => setOpen(open === s.id ? null : s.id)} active={open === s.id}>
                  Swap section
                </ActionButton>
                <ActionButton onClick={() => setStatus(s.id, 'backup')}>Make backup</ActionButton>
                <ActionButton onClick={() => useUi.getState().openSheet({ kind: 'pick', courseKey: s.id })}>Move…</ActionButton>
                <ActionButton onClick={() => removeCourse(s.id, s.course!.displayCode)} danger>
                  Remove
                </ActionButton>
              </div>
              {open === s.id && (
                <div className="mt-2">
                  <SwapList course={s.course} onlyFixes limit={6} />
                </div>
              )}
            </div>
          ) : (
            <div key={s.id} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium">{s.block!.label}:</span>
              <ActionButton onClick={() => useUi.getState().openSheet({ kind: 'block', blockId: s.id })}>Edit time</ActionButton>
            </div>
          ),
        )}
      </div>
      {!anyFix && sides.every((s) => s.course) && (
        <p className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs text-muted">
          No other section of either course fits without creating a new conflict. Pick one, keep the other as a backup, or put
          them in separate plans.
        </p>
      )}
    </div>
  );
}

function ActionButton({ onClick, children, active, danger }: { onClick: () => void; children: ReactNode; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
        danger
          ? 'border-rule-strong text-danger hover:border-danger hover:bg-danger-soft'
          : active
            ? 'border-ink bg-ink text-surface'
            : 'border-rule-strong hover:border-ink'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Custom time blocks
// ---------------------------------------------------------------------------

const BLOCK_TIMES = Array.from({ length: (23 - 6) * 4 + 1 }, (_, i) => 6 * 60 + i * 15);

function BlockSheet({ blockId, onClose }: { blockId: string | null; onClose: () => void }) {
  const { plan, termCode } = usePlanner();
  const existing = plan?.blocks.find((b) => b.id === blockId) ?? null;
  const [draft, setDraft] = useState<CustomBlock>(
    existing ?? { id: newBlockId(), label: 'Work', days: [2, 4], start: 14 * 60, end: 17 * 60, color: 'slate' },
  );
  const valid = draft.label.trim() && draft.days.length > 0 && draft.end > draft.start;

  const save = () => {
    if (!valid || !termCode) return;
    const planId = plan?.id ?? usePlanStore.getState().ensurePlan(termCode);
    usePlanStore.getState().upsertBlock(planId, { ...draft, label: draft.label.trim() });
    onClose();
  };

  return (
    <SheetFrame title={existing ? 'Edit blocked time' : 'Block off time'} sub="Work, practice, commute — anything classes shouldn’t overlap." onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-3 text-[13px]"
      >
        <label className="block">
          <span className="mb-1 block font-medium">Label</span>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className="w-full rounded-md border border-rule-strong bg-surface px-2 py-1.5"
            autoFocus
          />
        </label>
        <div>
          <span className="mb-1 block font-medium">Days</span>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <Pill
                key={d}
                active={draft.days.includes(d)}
                onClick={() => setDraft({ ...draft, days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] })}
              >
                {DAY_SHORT[d]}
              </Pill>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label>
            <span className="mb-1 block font-medium">From</span>
            <TimePick value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} />
          </label>
          <label>
            <span className="mb-1 block font-medium">To</span>
            <TimePick value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
          </label>
        </div>
        {draft.end <= draft.start && <p className="text-xs text-danger">The end time must be after the start time.</p>}
        <div>
          <span className="mb-1 block font-medium">Color</span>
          <div className="flex flex-wrap gap-1.5">
            {COURSE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-color={c}
                onClick={() => setDraft({ ...draft, color: c })}
                className="size-6 rounded-md"
                style={{ background: 'var(--fill)', boxShadow: `inset 0 0 0 ${draft.color === c ? 2 : 1}px var(--edge)` }}
                aria-label={`Color ${c}`}
                aria-pressed={draft.color === c}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={!valid} className="rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-ink disabled:opacity-40">
            {existing ? 'Save changes' : 'Add to plan'}
          </button>
          {existing && plan && (
            <button
              type="button"
              onClick={() => {
                usePlanStore.getState().removeBlock(plan.id, existing.id);
                onClose();
              }}
              className="rounded-md border border-rule-strong px-3 py-1.5 font-medium text-danger hover:border-danger"
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </SheetFrame>
  );
}

function TimePick({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="tnum rounded-md border border-rule-strong bg-surface px-2 py-1.5">
      {BLOCK_TIMES.map((m) => (
        <option key={m} value={m}>
          {formatTime(m)}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = usePlanStore((s) => s.settings);
  const update = usePlanStore((s) => s.updateSettings);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('tss-planner:theme') ?? 'system';
    } catch {
      return 'system';
    }
  });
  const applyTheme = (t: string) => {
    setTheme(t);
    try {
      if (t === 'system') localStorage.removeItem('tss-planner:theme');
      else localStorage.setItem('tss-planner:theme', t);
    } catch {
      /* storage unavailable */
    }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };

  return (
    <SheetFrame title="Settings" onClose={onClose}>
      <H>Unit limit</H>
      <div className="flex flex-wrap gap-1.5">
        {UNIT_CAPS.map((c) => (
          <Pill key={c.id} active={settings.unitCap === c.units} onClick={() => update({ unitCap: c.units })}>
            {c.label} · {c.units}
          </Pill>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">Undergraduate booking caps. Waitlisted courses count toward the limit in TSS.</p>

      <H>Back-to-back warning</H>
      <div className="flex flex-wrap gap-1.5">
        {[0, 10, 15].map((m) => (
          <Pill key={m} active={settings.tightGapMin === m} onClick={() => update({ tightGapMin: m })}>
            {m === 0 ? 'Off' : `Under ${m} min`}
          </Pill>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">Notes classes with little time to walk between them.</p>

      <H>Appearance</H>
      <div className="flex flex-wrap gap-1.5">
        {['system', 'light', 'dark'].map((t) => (
          <Pill key={t} active={theme === t} onClick={() => applyTheme(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </Pill>
        ))}
      </div>

      <H>About the data</H>
      <p className="text-[13px] text-muted">
        Course data comes from UC San Diego’s public Class Planner and refreshes automatically. Seat counts can lag — TSS is the
        source of truth when you book.
      </p>
    </SheetFrame>
  );
}

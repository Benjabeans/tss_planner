import { useMemo, useState } from 'react';
import { ChevronRight, Check, AlertTriangle, Info } from 'lucide-react';
import type { Course, Section } from '@shared/types.ts';
import { summarizeWeekly } from '@shared/time.ts';
import { usePlanner } from '../lib/planner.tsx';
import { useUi } from '../store/ui.ts';
import { addPackage } from '../lib/actions.ts';
import { chipText, describeConflict, seatText } from '../lib/describe.ts';
import type { PackageView } from './SearchPanel.tsx';

interface Group {
  primary: Section;
  rows: { view: PackageView; rest: Section[] }[];
}

export function CourseCard({ course, packages, defaultOpen }: { course: Course; packages: PackageView[]; defaultOpen: boolean }) {
  const { plan, labelFor } = usePlanner();
  const [open, setOpen] = useState(defaultOpen);
  const [details, setDetails] = useState(false);
  const pick = plan?.picks.find((p) => p.courseKey === course.key);

  const sectionById = useMemo(() => new Map(course.sections.map((s) => [s.id, s])), [course]);
  const visible = packages.filter((p) => p.visible);

  const groups = useMemo(() => {
    const out = new Map<string, Group>();
    for (const view of visible) {
      const secs = view.pkg.sectionIds.map((id) => sectionById.get(id)!).filter(Boolean);
      const primary = secs[0]!;
      if (!out.has(primary.id)) out.set(primary.id, { primary, rows: [] });
      out.get(primary.id)!.rows.push({ view, rest: secs.slice(1) });
    }
    return [...out.values()];
  }, [visible, sectionById]);

  const fit = packages.filter((p) => !p.conflicts.some((c) => c.severity === 'error')).length;
  const openSeats = packages.filter((p) => p.pkg.status === 'open').length;
  const instructors = course.instructors.length ? course.instructors : [...new Set(course.sections.flatMap((s) => s.instructors))];
  const hasPlan = (plan?.picks.length ?? 0) > 0 || (plan?.blocks.length ?? 0) > 0;
  const extras = course.extraSectionIds.map((id) => sectionById.get(id)!).filter(Boolean);

  return (
    <div className={pick ? 'bg-surface-2/60' : undefined}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-surface-2"
        aria-expanded={open}
      >
        <ChevronRight className={`mt-0.5 size-4 shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold whitespace-nowrap">{course.displayCode}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px]">{course.title}</span>
            <span className="tnum shrink-0 text-xs text-muted">{course.units.replace(' units', 'u').replace(' unit', 'u')}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {pick && (
              <span className="flex items-center gap-1 font-medium text-ink" data-color={pick.color}>
                <span className="size-2 rounded-full" style={{ background: 'var(--edge)' }} aria-hidden />
                {pick.status === 'backup' ? 'Backup' : 'In plan'}
              </span>
            )}
            {instructors.length > 0 && (
              <span className="truncate">
                {instructors.slice(0, 2).join(', ')}
                {instructors.length > 2 ? ` +${instructors.length - 2}` : ''}
              </span>
            )}
            <span>
              {packages.length} {packages.length === 1 ? 'option' : 'options'}
              {openSeats < packages.length ? ` · ${openSeats} open` : ''}
            </span>
            {hasPlan && !pick && packages.length > 0 && (
              <span className={fit === 0 ? 'font-medium text-danger' : undefined}>
                {fit === 0 ? 'none fit your plan' : fit === packages.length ? 'all fit' : `${fit} fit`}
              </span>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="pb-2.5 pl-9 pr-3">
          {course.moduleTitle && <p className="mb-1.5 text-xs text-muted">{course.moduleTitle}</p>}
          {packages.length === 0 && <p className="text-[13px] text-muted">No sections are listed for this term.</p>}
          {packages.length > 0 && visible.length === 0 && (
            <p className="rounded-md bg-surface-2 px-2 py-1.5 text-[13px] text-muted">
              Every section is hidden by your filters
              {packages.every((p) => p.conflicts.some((c) => c.severity === 'error')) ? ' — they all conflict with your plan' : ''}.
            </p>
          )}

          <div className="space-y-2">
            {groups.map((g) => {
              const single = g.rows.length === 1 && g.rows[0]!.rest.length === 0;
              return (
                <div key={g.primary.id} className="overflow-hidden rounded-lg border border-rule bg-surface">
                  {single ? (
                    <PackageRow course={course} row={g.rows[0]!} lines={[g.primary]} current={pick?.packageId === g.rows[0]!.view.pkg.id} labelFor={labelFor} />
                  ) : (
                    <>
                      <SectionLine section={g.primary} className="border-b border-rule bg-surface-2/70 px-2.5 py-1.5" showInstructor />
                      {g.rows.map((r) => (
                        <PackageRow
                          key={r.view.pkg.id}
                          course={course}
                          row={r}
                          lines={r.rest}
                          current={pick?.packageId === r.view.pkg.id}
                          labelFor={labelFor}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {extras.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Also listed (booked separately): {extras.map((s) => `${s.type} ${s.code}`).join(', ')}
            </p>
          )}

          {(course.prereqs.length > 0 || course.restrictions.length > 0 || course.fees.length > 0 || course.sections.some((s) => s.text.length)) && (
            <div className="mt-2">
              <button type="button" onClick={() => setDetails((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
                <Info className="size-3.5" aria-hidden /> {details ? 'Hide' : 'Prerequisites and notes'}
              </button>
              {details && <CourseDetails course={course} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CourseDetails({ course }: { course: Course }) {
  const notes = [...new Set(course.sections.flatMap((s) => s.text))];
  return (
    <dl className="mt-1.5 space-y-1.5 text-xs">
      {course.prereqs.length > 0 && (
        <div>
          <dt className="font-medium text-ink">Prerequisites</dt>
          {course.prereqs.map((p) => (
            <dd key={p} className="text-muted">
              {p}
            </dd>
          ))}
        </div>
      )}
      {course.restrictions.length > 0 && (
        <div>
          <dt className="font-medium text-ink">Restrictions</dt>
          {course.restrictions.map((p) => (
            <dd key={p} className="text-muted">
              {p}
            </dd>
          ))}
        </div>
      )}
      {course.fees.length > 0 && (
        <div>
          <dt className="font-medium text-ink">Fees</dt>
          {course.fees.map((p) => (
            <dd key={p} className="text-muted">
              {p}
            </dd>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div>
          <dt className="font-medium text-ink">Notes</dt>
          {notes.map((p) => (
            <dd key={p} className="text-muted break-words">
              {p}
            </dd>
          ))}
        </div>
      )}
    </dl>
  );
}

function SectionLine({ section, className = '', showInstructor = false }: { section: Section; className?: string; showInstructor?: boolean }) {
  const weekly = summarizeWeekly(section.meetings);
  return (
    <div className={`flex items-baseline gap-2 text-[12.5px] ${className}`}>
      <span className="w-6 shrink-0 font-semibold">{section.type}</span>
      <span className="tnum w-[4.6rem] shrink-0 text-muted">{section.code.slice(0, 7)}</span>
      <span className={`tnum min-w-0 truncate ${showInstructor ? '' : 'flex-1'}`}>
        {weekly.length ? weekly.join(', ') : <span className="text-muted">TBA</span>}
      </span>
      {/* The meeting time matters more than the name: the name only gets the space that's left. */}
      {showInstructor && section.instructors.length > 0 && (
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted" title={section.instructors.join(', ')}>
          {section.instructors.join(', ')}
        </span>
      )}
    </div>
  );
}

function PackageRow({
  course,
  row,
  lines,
  current,
  labelFor,
}: {
  course: Course;
  row: { view: PackageView; rest: Section[] };
  lines: Section[];
  current: boolean;
  labelFor: (owner: string) => string;
}) {
  const { pkg, conflicts } = row.view;
  const setPreview = useUi((s) => s.setPreview);
  const chip = chipText(conflicts, labelFor, course.key);
  const severity = conflicts.some((c) => c.severity === 'error') ? 'error' : conflicts.some((c) => c.severity === 'warning') ? 'warning' : null;
  const firstReal = conflicts.find((c) => c.severity !== 'info');

  const enter = () => setPreview({ courseKey: course.key, packageId: pkg.id });
  const leave = () => {
    const p = useUi.getState().preview;
    if (p?.packageId === pkg.id && p.courseKey === course.key) setPreview(null);
  };

  return (
    <button
      type="button"
      className={`group flex w-full items-start gap-2 border-t border-rule px-2.5 py-1.5 text-left first:border-t-0 hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60 ${
        current ? 'bg-accent-soft/50' : ''
      }`}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      onClick={() => addPackage(course, pkg)}
      aria-label={`${current ? 'In your plan' : 'Add'} ${course.displayCode} ${lines.map((s) => `${s.type} ${s.code}`).join(' ')}${chip ? ` — ${chip}` : ''}`}
      title={firstReal ? describeConflict(firstReal) : current ? 'In your plan' : 'Click to add · hover to preview'}
    >
      <span
        className={`mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
          current ? 'border-ink bg-ink text-surface' : 'border-rule-strong group-hover:border-ink'
        }`}
        aria-hidden
      >
        {current && <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1">
        {lines.map((s) => (
          <SectionLine key={s.id} section={s} showInstructor={lines.length === 1 && row.rest.length === 0} />
        ))}
        {chip && (
          <div className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${severity === 'error' ? 'text-danger' : 'text-warn'}`}>
            <AlertTriangle className="size-3" aria-hidden />
            {chip}
          </div>
        )}
      </div>
      <span
        className={`tnum shrink-0 pt-0.5 text-xs ${
          pkg.status === 'open' ? 'text-ok' : pkg.status === 'waitlist_only' ? 'text-warn' : 'text-danger'
        }`}
      >
        {seatText(pkg.seatsAvailable, pkg.status)}
      </span>
    </button>
  );
}

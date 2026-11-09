import { useState } from 'react';
import { AlertTriangle, Check, Copy, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { PickStatus } from '@shared/types.ts';
import { packageSections, summarizePackage } from '@shared/plan.ts';
import { formatDays, formatRange } from '@shared/time.ts';
import { usePlanner } from '../lib/planner.tsx';
import { usePlanStore } from '../store/plans.ts';
import { useUi } from '../store/ui.ts';
import { removeCourse, setStatus } from '../lib/actions.ts';
import { describeConflict, seatText } from '../lib/describe.ts';

export const STATUS_LABEL: Record<PickStatus, string> = {
  planned: 'Planned',
  enrolled: 'Enrolled',
  waitlisted: 'Waitlisted',
  backup: 'Backup',
};

export function PlanTable() {
  const { plan, data, picks, conflictsByCourse } = usePlanner();
  const [copied, setCopied] = useState<string | null>(null);
  if (!plan || !data) return null;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      window.prompt('Copy this:', text);
    }
  };

  const allIds = plan.picks
    .filter((p) => p.status !== 'backup')
    .flatMap((p) => {
      const r = picks.get(p.courseKey);
      return r?.pkg && r.course ? packageSections(r.course, r.pkg).map((s) => `${r.course.displayCode} ${s.type} ${s.code}: ${s.id}`) : [];
    });

  return (
    <section className="rounded-xl border border-rule bg-surface" aria-labelledby="plan-heading">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
        <h2 id="plan-heading" className="text-[14px] font-semibold">
          {plan.name}
        </h2>
        <span className="text-xs text-muted">Book these in TSS using the section IDs.</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={plan.picks.length === 0}
            onClick={() => useUi.getState().openSheet({ kind: 'generate' })}
            className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-ink hover:brightness-95 disabled:opacity-40"
          >
            <Sparkles className="size-3.5" /> Find a schedule
          </button>
          <button
            type="button"
            disabled={allIds.length === 0}
            onClick={() => copy(allIds.join('\n'), '__all')}
            className="flex items-center gap-1 rounded-md border border-rule-strong px-2 py-1 text-xs font-medium hover:border-ink disabled:opacity-40"
          >
            {copied === '__all' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy all IDs
          </button>
          <button
            type="button"
            onClick={() => useUi.getState().openSheet({ kind: 'block', blockId: null })}
            className="flex items-center gap-1 rounded-md border border-rule-strong px-2 py-1 text-xs font-medium hover:border-ink"
          >
            <Plus className="size-3.5" /> Block off time
          </button>
        </div>
      </div>

      {plan.picks.length === 0 && plan.blocks.length === 0 ? (
        <p className="px-3 py-4 text-[13px] text-muted">Courses you add show up here with their section IDs for booking.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th className="py-1.5 pr-2 pl-3 font-medium">Course</th>
                <th className="px-2 font-medium">Section</th>
                <th className="px-2 font-medium">Days</th>
                <th className="px-2 font-medium">Time</th>
                <th className="px-2 font-medium">Instructor</th>
                <th className="px-2 font-medium">Seats</th>
                <th className="px-2 font-medium">Section ID</th>
                <th className="pr-3 pl-2" />
              </tr>
            </thead>
            {plan.picks.map((pick) => {
              const r = picks.get(pick.courseKey);
              const course = r?.course ?? null;
              const conflicts = (conflictsByCourse.get(pick.courseKey) ?? []).filter((c) => c.severity !== 'info');
              const label = course?.displayCode ?? pick.courseKey.split('|')[0]!;
              const sections = r?.pkg && course ? packageSections(course, r.pkg) : [];
              return (
                <tbody key={pick.courseKey} className="border-b border-rule last:border-b-0" data-color={pick.color}>
                  <tr>
                    <td colSpan={8} className="pt-2 pr-3 pb-1 pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="size-2.5 rounded-sm" style={{ background: 'var(--edge)' }} aria-hidden />
                        <button
                          type="button"
                          className="font-semibold hover:underline"
                          onClick={() => useUi.getState().openSheet({ kind: 'pick', courseKey: pick.courseKey })}
                        >
                          {label}
                        </button>
                        <span className="min-w-0 truncate text-muted">{course?.title}</span>
                        <span className="tnum text-xs text-muted">{course?.units}</span>
                        <select
                          value={pick.status}
                          onChange={(e) => setStatus(pick.courseKey, e.target.value as PickStatus)}
                          className="ml-auto rounded-md border border-rule-strong bg-surface px-1.5 py-0.5 text-xs"
                          aria-label={`Status of ${label}`}
                        >
                          {Object.entries(STATUS_LABEL).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeCourse(pick.courseKey, label)}
                          className="rounded p-1 text-faint hover:bg-danger-soft hover:text-danger"
                          aria-label={`Remove ${label}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <PickHealth pickKey={pick.courseKey} />
                      {conflicts.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {conflicts.slice(0, 3).map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() => useUi.getState().openSheet({ kind: 'conflicts', focus: pick.courseKey })}
                                className={`flex items-center gap-1 text-left text-xs font-medium hover:underline ${
                                  c.severity === 'error' ? 'text-danger' : 'text-warn'
                                }`}
                              >
                                <AlertTriangle className="size-3 shrink-0" aria-hidden /> {describeConflict(c)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                  {sections.map((s) => {
                    const weekly = s.meetings.filter((m) => m.kind === 'class' && !m.date && !m.tba);
                    const times = [...new Set(weekly.map((m) => formatRange(m.start!, m.end!)))];
                    return (
                      <tr key={s.id} className={pick.status === 'backup' ? 'text-muted' : undefined}>
                        <td className="py-1 pr-2 pl-7 whitespace-nowrap text-muted">{s.typeName}</td>
                        <td className="tnum px-2 whitespace-nowrap">{s.code}</td>
                        <td className="px-2">{weekly.length ? formatDays(weekly.map((m) => m.day!)) : 'TBA'}</td>
                        <td className="tnum px-2 whitespace-nowrap">{times.join(', ') || '—'}</td>
                        <td className="max-w-[10rem] truncate px-2">{s.instructors.join(', ') || <span className="text-muted">Staff</span>}</td>
                        <td className="tnum px-2 whitespace-nowrap">
                          {seatText(s.seatsAvailable, s.status)}
                          {s.capacity !== null && <span className="text-muted"> / {s.capacity}</span>}
                        </td>
                        <td className="tnum px-2 whitespace-nowrap">{s.id}</td>
                        <td className="pr-3 pl-2 text-right">
                          <button
                            type="button"
                            onClick={() => copy(s.id, s.id)}
                            className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink"
                            aria-label={`Copy section ID ${s.id}`}
                          >
                            {copied === s.id ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      {plan.blocks.length > 0 && (
        <div className="border-t border-rule px-3 py-2">
          <h3 className="mb-1 text-xs font-medium text-muted">Blocked-off time</h3>
          <ul className="flex flex-wrap gap-1.5">
            {plan.blocks.map((b) => (
              <li key={b.id} data-color={b.color}>
                <button
                  type="button"
                  onClick={() => useUi.getState().openSheet({ kind: 'block', blockId: b.id })}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                  style={{ background: 'var(--fill)', color: 'var(--cink)' }}
                >
                  {b.label} · {formatDays(b.days)} {formatRange(b.start, b.end)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Explains when a planned section changed or disappeared after a data refresh. */
export function PickHealth({ pickKey }: { pickKey: string }) {
  const { plan, picks } = usePlanner();
  const pick = plan?.picks.find((p) => p.courseKey === pickKey);
  const r = picks.get(pickKey);
  if (!plan || !pick || !r || r.state === 'ok') return null;
  if (r.state === 'changed') {
    const now = summarizePackage(r.course, r.pkg);
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-warn-soft px-2 py-1 text-xs text-warn">
        <RefreshCw className="size-3" aria-hidden />
        <span>
          Times changed: was {pick.summaryAtAdd}; now {now}.
        </span>
        <button
          type="button"
          className="font-semibold underline-offset-2 hover:underline"
          onClick={() => usePlanStore.getState().acceptChanges(plan.id, pickKey, r.course, r.pkg)}
        >
          Got it
        </button>
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">
      <AlertTriangle className="size-3" aria-hidden />
      {r.state === 'missing-course'
        ? 'This course is no longer offered this term.'
        : 'This section combination is no longer offered.'}{' '}
      {r.course && (
        <button
          type="button"
          className="font-semibold underline-offset-2 hover:underline"
          onClick={() => useUi.getState().openSheet({ kind: 'pick', courseKey: pickKey })}
        >
          Pick another section
        </button>
      )}
      <span className="text-muted">Planned: {pick.summaryAtAdd}</span>
    </div>
  );
}


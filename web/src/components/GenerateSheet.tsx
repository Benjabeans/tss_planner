import { useMemo, useState } from 'react';
import { Lock, Sparkles, Unlock, X } from 'lucide-react';
import type { Course } from '@shared/types.ts';
import { generateSchedules, type Preference } from '@shared/generate.ts';
import { findPackage, slotsForBlock, slotsForPackage } from '@shared/plan.ts';
import { DAY_SHORT, formatTime } from '@shared/time.ts';
import { usePlanner } from '../lib/planner.tsx';
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

function duration(min: number): string {
  if (min === 0) return 'no gaps';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h}h ` : ''}${m ? `${m}m` : ''}`.trim() + ' between classes';
}

/**
 * Rearranges sections of the courses already in the plan. Enrolled courses start locked;
 * custom blocks are always respected. Backups are left out.
 */
export function GenerateSheet({ onClose }: { onClose: () => void }) {
  const { plan, data, labelFor } = usePlanner();
  const [locked, setLocked] = useState<Set<string>>(
    () => new Set(plan?.picks.filter((p) => p.status === 'enrolled').map((p) => p.courseKey) ?? []),
  );
  const [openOnly, setOpenOnly] = useState(false);
  const [avoidDays, setAvoidDays] = useState<number[]>([]);
  const [earliest, setEarliest] = useState<number | null>(null);
  const [latest, setLatest] = useState<number | null>(null);
  const [preference, setPreference] = useState<Preference>('balanced');
  const setSchedulePreview = useUi((s) => s.setSchedulePreview);

  const picks = plan?.picks.filter((p) => p.status !== 'backup') ?? [];

  const result = useMemo(() => {
    if (!plan || !data) return null;
    const courses: Course[] = [];
    const fixed = plan.blocks.flatMap(slotsForBlock);
    for (const p of picks) {
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
      constraints: { openOnly, avoidDays, earliest, latest },
      preference,
      limit: 10,
    });
  }, [plan, data, locked, openOnly, avoidDays, earliest, latest, preference]);

  const toggleLock = (key: string) =>
    setLocked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const currentOf = (courseKey: string) => plan?.picks.find((p) => p.courseKey === courseKey)?.packageId;

  return (
    <>
      <div className="flex items-start gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
            <Sparkles className="size-4 text-accent" aria-hidden /> Find a schedule
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Tries every section combination of the courses in your plan and ranks the ones without conflicts.
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px]">
        {picks.length === 0 ? (
          <p className="text-muted">Add the courses you want first. Overlaps are fine; this sorts them out.</p>
        ) : (
          <>
            <h3 className="mb-1.5 font-semibold">Courses</h3>
            <ul className="flex flex-wrap gap-1.5">
              {picks.map((p) => {
                const isLocked = locked.has(p.courseKey);
                return (
                  <li key={p.courseKey}>
                    <button
                      type="button"
                      onClick={() => toggleLock(p.courseKey)}
                      className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
                        isLocked ? 'border-ink bg-ink text-surface' : 'border-rule-strong hover:border-ink'
                      }`}
                      title={isLocked ? 'Kept exactly as planned' : 'Free to rearrange'}
                      aria-pressed={isLocked}
                    >
                      {isLocked ? <Lock className="size-3" /> : <Unlock className="size-3 text-faint" />}
                      {labelFor(p.courseKey)}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-xs text-muted">Lock a course to keep its current section. Blocked-off time is always respected.</p>

            <h3 className="mt-4 mb-1.5 font-semibold">Rules</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                Only sections with open seats
              </label>
              <div className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-muted">Days off</span>
                {[1, 2, 3, 4, 5].map((d) => (
                  <Pill
                    key={d}
                    active={avoidDays.includes(d)}
                    onClick={() => setAvoidDays((a) => (a.includes(d) ? a.filter((x) => x !== d) : [...a, d]))}
                  >
                    {DAY_SHORT[d]}
                  </Pill>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-muted">Between</span>
                <TimeSelect value={earliest} onChange={setEarliest} />
                <span className="text-muted">and</span>
                <TimeSelect value={latest} onChange={setLatest} />
              </div>
            </div>

            <h3 className="mt-4 mb-1.5 font-semibold">Prefer</h3>
            <div className="flex flex-wrap gap-1.5">
              {PREFS.map((p) => (
                <Pill key={p.id} active={preference === p.id} onClick={() => setPreference(p.id)}>
                  {p.label}
                </Pill>
              ))}
            </div>

            <h3 className="mt-5 mb-1.5 font-semibold">Results</h3>
            {!result ? (
              <p className="text-muted">Unlock at least one course to rearrange.</p>
            ) : result.blockers.length > 0 ? (
              <ul className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-danger">
                {result.blockers.map((b) => (
                  <li key={b.courseKey}>
                    <b>{labelFor(b.courseKey)}</b>:{' '}
                    {b.reason === 'filtered'
                      ? 'no section matches these rules.'
                      : 'every section overlaps your locked courses or blocked-off time.'}
                  </li>
                ))}
              </ul>
            ) : result.schedules.length === 0 ? (
              <div className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
                {result.incompatible.length > 0 ? (
                  <ul className="space-y-1">
                    {result.incompatible.map(([a, b]) => (
                      <li key={`${a}~${b}`}>
                        <b>{labelFor(a)}</b> and <b>{labelFor(b)}</b> can never fit together: every combination overlaps. Keep one as a
                        backup or put them in separate plans.
                      </li>
                    ))}
                  </ul>
                ) : result.truncated ? (
                  'Too many combinations to check. Lock a course or add rules to narrow it down.'
                ) : (
                  'No combination fits all of these courses together. Try fewer rules or lock fewer courses.'
                )}
              </div>
            ) : (
              <>
                <ol className="space-y-1.5" onMouseLeave={() => setSchedulePreview(null)}>
                  {result.schedules.map((s, i) => {
                    const changes = s.choices.filter((c) => currentOf(c.courseKey) !== c.packageId).length;
                    const label = `Option ${i + 1}`;
                    const preview = () => setSchedulePreview({ label, choices: s.choices });
                    return (
                      <li key={s.choices.map((c) => c.packageId).join('|')}>
                        <button
                          type="button"
                          onMouseEnter={preview}
                          onFocus={preview}
                          onClick={() => {
                            if (!data) return;
                            const resolved = s.choices
                              .map((c) => {
                                const course = data.index.byKey.get(c.courseKey);
                                const pkg = course ? findPackage(course, c.packageId) : null;
                                return course && pkg ? { course, pkg } : null;
                              })
                              .filter((x): x is NonNullable<typeof x> => x !== null);
                            applySchedule(resolved, label);
                          }}
                          className="w-full rounded-lg border border-rule px-3 py-2 text-left hover:border-ink hover:bg-accent-soft/40"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold">{label}</span>
                            <span className="text-xs text-muted">
                              {changes === 0 ? 'your current plan' : `changes ${changes} course${changes === 1 ? '' : 's'}`}
                            </span>
                            <span className="ml-auto text-xs font-medium text-accent-ink">Use this</span>
                          </div>
                          <div className="tnum mt-0.5 text-xs text-muted">
                            {s.stats.days} day{s.stats.days === 1 ? '' : 's'} on campus · {duration(s.stats.gapMinutes)}
                            {s.stats.earliest !== null && s.stats.latest !== null
                              ? ` · ${formatTime(s.stats.earliest)}–${formatTime(s.stats.latest)}`
                              : ''}
                            {s.stats.notOpen > 0 ? ` · ${s.stats.notOpen} full/waitlist` : ''}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-2 text-xs text-muted">
                  Hover an option to preview it on your calendar. Checked {result.explored.toLocaleString()} combinations
                  {result.truncated ? ' (stopped early; lock a course to search the rest)' : ''}.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function TimeSelect({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="tnum rounded-md border border-rule-strong bg-surface px-1.5 py-0.5"
    >
      <option value="">any</option>
      {TIMES.map((m) => (
        <option key={m} value={m}>
          {formatTime(m)}
        </option>
      ))}
    </select>
  );
}

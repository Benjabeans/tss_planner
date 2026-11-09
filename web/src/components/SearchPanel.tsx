import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { Course, Package } from '@shared/types.ts';
import type { Conflict } from '@shared/conflicts.ts';
import { searchCourses } from '@shared/search.ts';
import { packageFootprint } from '@shared/plan.ts';
import { findCrossConflicts } from '@shared/conflicts.ts';
import { slotsForPackage } from '@shared/plan.ts';
import { DAY_SHORT, formatTime } from '@shared/time.ts';
import { usePlanner } from '../lib/planner.tsx';
import { useUi } from '../store/ui.ts';
import { relativeTime } from '../lib/describe.ts';
import { CourseCard } from './CourseCard.tsx';

export interface Filters {
  openOnly: boolean;
  hideConflicts: boolean;
  levels: string[];
  avoidDays: number[];
  earliest: number | null;
  latest: number | null;
}

const DEFAULT_FILTERS: Filters = { openOnly: false, hideConflicts: false, levels: [], avoidDays: [], earliest: null, latest: null };
const EXAMPLES = ['CSE 110, 100', 'MATH 18', 'CHEM 6B', 'griswold'];
const TIME_OPTIONS = Array.from({ length: 27 }, (_, i) => 7 * 60 + i * 30);

export interface PackageView {
  pkg: Package;
  conflicts: Conflict[];
  visible: boolean;
}

export function SearchPanel() {
  const { data, slots, plan } = usePlanner();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showMore, setShowMore] = useState(false);
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault();
        // The finder takes this panel's place on desktop; going back to search closes it.
        if (useUi.getState().finder) {
          useUi.getState().closeFinder();
          requestAnimationFrame(() => inputRef.current?.focus());
        } else {
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => (data ? searchCourses(data.search, deferred, 100) : []), [data, deferred]);

  const views = useMemo(() => {
    const others = slots.filter((s) => s.status !== 'backup');
    return results
      .filter((c) => filters.levels.length === 0 || filters.levels.includes(c.level))
      .map((course) => {
        const pickStatus = plan?.picks.find((p) => p.courseKey === course.key)?.status;
        const theirs = others.filter((s) => s.ownerId !== course.key);
        const packages: PackageView[] = course.packages.map((pkg) => {
          const conflicts = findCrossConflicts(slotsForPackage(course, pkg, { kind: 'candidate', status: pickStatus }), theirs);
          return { pkg, conflicts, visible: passes(course, pkg, conflicts, filters) };
        });
        return { course, packages };
      });
  }, [results, slots, plan, filters]);

  const activeFilterCount =
    Number(filters.openOnly) +
    Number(filters.hideConflicts) +
    filters.levels.length +
    filters.avoidDays.length +
    Number(filters.earliest !== null) +
    Number(filters.latest !== null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-rule p-3">
        <label className="relative block">
          <span className="sr-only">Search courses</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="CSE 110, MATH 18, or a professor"
            className="w-full rounded-lg border border-rule-strong bg-surface py-2 pr-8 pl-8 text-[16px] placeholder:text-faint lg:text-[14px] focus:border-accent focus:outline-none"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-ink"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <Check label="Open seats only" checked={filters.openOnly} onChange={(v) => setFilters({ ...filters, openOnly: v })} />
          <Check label="Hide conflicts" checked={filters.hideConflicts} onChange={(v) => setFilters({ ...filters, hideConflicts: v })} />
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-ink"
            aria-expanded={showMore}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>

        {showMore && <MoreFilters filters={filters} onChange={setFilters} onReset={() => setFilters(DEFAULT_FILTERS)} />}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!data ? null : deferred.trim() === '' ? (
          <SearchHelp onPick={setQuery} />
        ) : views.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">
            No courses match “{deferred.trim()}”. Try a course code like <b className="text-ink">CSE 110</b>, a subject like{' '}
            <b className="text-ink">MATH</b>, or a professor’s last name.
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {views.map((v) => (
              <li key={v.course.key}>
                <CourseCard course={v.course} packages={v.packages} defaultOpen={views.length <= 3} />
              </li>
            ))}
            {results.length >= 100 && (
              <li className="p-3 text-xs text-muted">Showing the first 100 matches. Add more detail to narrow it down.</li>
            )}
          </ul>
        )}
      </div>

      {data && (
        <div className="border-t border-rule px-3 py-2 text-xs text-muted">
          {data.catalog.term.courseCount.toLocaleString()} courses · seats updated {relativeTime(data.catalog.term.syncedAt)} ·
          confirm in TSS before booking
        </div>
      )}
    </div>
  );
}

function passes(course: Course, pkg: Package, conflicts: Conflict[], f: Filters): boolean {
  if (f.openOnly && pkg.status !== 'open') return false;
  if (f.hideConflicts && conflicts.some((c) => c.severity === 'error')) return false;
  if (f.avoidDays.length || f.earliest !== null || f.latest !== null) {
    const fp = packageFootprint(course, pkg);
    if (f.avoidDays.some((d) => fp.days.has(d))) return false;
    if (f.earliest !== null && fp.earliest !== null && fp.earliest < f.earliest) return false;
    if (f.latest !== null && fp.latest !== null && fp.latest > f.latest) return false;
  }
  return true;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

function MoreFilters({ filters, onChange, onReset }: { filters: Filters; onChange: (f: Filters) => void; onReset: () => void }) {
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="mt-3 space-y-2.5 rounded-lg bg-surface-2 p-2.5 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-muted">Level</span>
        {[
          ['LD', 'Lower div'],
          ['UD', 'Upper div'],
          ['GR', 'Graduate'],
        ].map(([v, l]) => (
          <Pill key={v} active={filters.levels.includes(v!)} onClick={() => onChange({ ...filters, levels: toggle(filters.levels, v!) })}>
            {l}
          </Pill>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-muted">Days off</span>
        {[1, 2, 3, 4, 5].map((d) => (
          <Pill
            key={d}
            active={filters.avoidDays.includes(d)}
            onClick={() => onChange({ ...filters, avoidDays: toggle(filters.avoidDays, d) })}
            title={`Hide sections that meet on ${DAY_SHORT[d]}`}
          >
            {DAY_SHORT[d]}
          </Pill>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-muted">Between</span>
        <TimeSelect value={filters.earliest} placeholder="any" onChange={(v) => onChange({ ...filters, earliest: v })} />
        <span className="text-muted">and</span>
        <TimeSelect value={filters.latest} placeholder="any" onChange={(v) => onChange({ ...filters, latest: v })} />
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={onReset} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          Reset filters
        </button>
      </div>
    </div>
  );
}

function TimeSelect({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder: string }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="tnum rounded-md border border-rule-strong bg-surface px-1.5 py-0.5"
    >
      <option value="">{placeholder}</option>
      {TIME_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {formatTime(m)}
        </option>
      ))}
    </select>
  );
}

export function Pill({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
        active ? 'border-ink bg-ink text-surface' : 'border-rule-strong bg-surface text-ink hover:border-ink'
      }`}
    >
      {children}
    </button>
  );
}

function SearchHelp({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="space-y-4 p-4 text-[13px] text-muted">
      <div>
        <p className="font-medium text-ink">Find a class</p>
        <p className="mt-1">
          Type course codes separated by commas, a whole subject, or a professor. Hover any section to preview it on your week.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-md border border-rule-strong bg-surface px-2 py-1 text-ink hover:border-ink"
          >
            {q}
          </button>
        ))}
      </div>
      <p className="text-xs">
        Press <kbd className="rounded border border-rule-strong px-1">/</kbd> to jump here from anywhere.
      </p>
    </div>
  );
}

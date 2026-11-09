import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Course, Package, Plan } from '@shared/types.ts';
import type { Conflict, Slot } from '@shared/conflicts.ts';
import { findConflicts, findCrossConflicts, groupConflicts, type ConflictGroup } from '@shared/conflicts.ts';
import {
  findPackage,
  planSlots,
  planUnits,
  resolvePick,
  slotsForPackage,
  type PickResolution,
} from '@shared/plan.ts';
import { TERM_DATES, type TermDates } from '@shared/terms.ts';
import { useCatalogStore, type LoadedCatalog } from '../store/catalog.ts';
import { usePlanStore } from '../store/plans.ts';
import { useUi } from '../store/ui.ts';
import { addPackage, applySchedule } from './actions.ts';

export interface PreviewData {
  /** Courses whose sections are being previewed (their current blocks dim). */
  courseKeys: Set<string>;
  slots: Slot[];
  /** Conflicts between the previewed sections and the rest of the plan. */
  conflicts: Conflict[];
  /** True when the preview is exactly what's already planned. */
  current: boolean;
  label: string;
  /** Set when previewing a single section (search rows, swap lists). */
  single: { course: Course; pkg: Package } | null;
  apply: () => void;
}

export interface PlannerData {
  termCode: string | null;
  data: LoadedCatalog | null;
  plan: Plan | null;
  slots: Slot[];
  conflicts: Conflict[];
  groups: ConflictGroup[];
  /** Weekly + dated conflicts that are not finals. */
  weeklyCounts: { error: number; warning: number; info: number };
  finalsConflicts: Conflict[];
  conflictsByCourse: Map<string, Conflict[]>;
  picks: Map<string, PickResolution>;
  units: { min: number; max: number };
  termDates: TermDates | null;
  preview: PreviewData | null;
  labelFor: (ownerId: string) => string;
}

const Ctx = createContext<PlannerData | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const termCode = usePlanStore((s) => s.termCode);
  const plans = usePlanStore((s) => s.plans);
  const activeId = usePlanStore((s) => (termCode ? s.active[termCode] : undefined));
  const tightGapMin = usePlanStore((s) => s.settings.tightGapMin);
  const termState = useCatalogStore((s) => (termCode ? s.byTerm[termCode] : undefined));
  const previewRef = useUi((s) => s.preview);

  const data = termState?.status === 'ready' ? termState.data : null;

  const plan = useMemo(() => {
    if (!termCode) return null;
    if (activeId && plans[activeId]) return plans[activeId]!;
    return Object.values(plans).find((p) => p.termCode === termCode) ?? null;
  }, [plans, activeId, termCode]);

  const base = useMemo(() => {
    const slots = plan && data ? planSlots(plan, data.index) : [];
    const conflicts = findConflicts(slots, { tightGapMin });
    const picks = new Map<string, PickResolution>();
    if (plan && data) for (const p of plan.picks) picks.set(p.courseKey, resolvePick(p, data.index));
    const conflictsByCourse = new Map<string, Conflict[]>();
    for (const c of conflicts) {
      for (const owner of new Set([c.a.ownerId, c.b.ownerId])) {
        if (!conflictsByCourse.has(owner)) conflictsByCourse.set(owner, []);
        conflictsByCourse.get(owner)!.push(c);
      }
    }
    const weekly = conflicts.filter((c) => c.kind !== 'final');
    const weeklyCounts = { error: 0, warning: 0, info: 0 };
    for (const g of groupConflicts(weekly)) weeklyCounts[g.severity]++;
    return {
      slots,
      conflicts,
      groups: groupConflicts(conflicts),
      weeklyCounts,
      finalsConflicts: conflicts.filter((c) => c.kind === 'final'),
      conflictsByCourse,
      picks,
      units: plan && data ? planUnits(plan, data.index) : { min: 0, max: 0 },
    };
  }, [plan, data, tightGapMin]);

  const scheduleRef = useUi((s) => s.schedulePreview);

  const preview = useMemo<PreviewData | null>(() => {
    if (!data) return null;
    const choices = scheduleRef ? scheduleRef.choices : previewRef ? [previewRef] : [];
    const resolved = choices
      .map((ch) => {
        const course = data.index.byKey.get(ch.courseKey);
        const pkg = course ? findPackage(course, ch.packageId) : null;
        return course && pkg ? { course, pkg } : null;
      })
      .filter((x): x is { course: Course; pkg: Package } => x !== null);
    if (resolved.length === 0) return null;
    const courseKeys = new Set(resolved.map((r) => r.course.key));
    // Conflicts must reference these exact slot objects so ghost blocks can be marked.
    const slots = resolved.flatMap(({ course, pkg }) =>
      slotsForPackage(course, pkg, { kind: 'candidate', status: plan?.picks.find((p) => p.courseKey === course.key)?.status }),
    );
    const others = base.slots.filter((s) => !courseKeys.has(s.ownerId) && s.status !== 'backup');
    const current = resolved.every(({ course, pkg }) => plan?.picks.find((p) => p.courseKey === course.key)?.packageId === pkg.id);
    const single = !scheduleRef && resolved.length === 1 ? resolved[0]! : null;
    return {
      courseKeys,
      slots,
      conflicts: findCrossConflicts(slots, others),
      current,
      label: scheduleRef ? scheduleRef.label : resolved[0]!.course.displayCode,
      single,
      apply: () => (single ? addPackage(single.course, single.pkg) : applySchedule(resolved, scheduleRef?.label ?? 'schedule')),
    };
  }, [previewRef, scheduleRef, data, plan, base.slots]);

  // Keep stored package ids pointing at the primary id (see repointPicks).
  useEffect(() => {
    if (!plan) return;
    const ids: Record<string, { packageId: string; sectionIds: string[] }> = {};
    for (const p of plan.picks) {
      const r = base.picks.get(p.courseKey);
      if (r?.pkg && r.pkg.id !== p.packageId) ids[p.courseKey] = { packageId: r.pkg.id, sectionIds: r.pkg.sectionIds };
    }
    if (Object.keys(ids).length) usePlanStore.getState().repointPicks(plan.id, ids);
  }, [plan, base.picks]);

  const value = useMemo<PlannerData>(() => {
    const labelFor = (ownerId: string) => {
      const c = data?.index.byKey.get(ownerId);
      if (c) return c.displayCode;
      return plan?.blocks.find((b) => b.id === ownerId)?.label ?? ownerId;
    };
    return {
      termCode,
      data,
      plan,
      ...base,
      termDates: termCode ? (TERM_DATES[termCode] ?? null) : null,
      preview,
      labelFor,
    };
  }, [termCode, data, plan, base, preview]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): PlannerData {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanner outside PlannerProvider');
  return v;
}

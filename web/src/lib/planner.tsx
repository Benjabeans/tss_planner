import { createContext, useContext, useMemo, type ReactNode } from 'react';
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

export interface PreviewData {
  course: Course;
  pkg: Package;
  slots: Slot[];
  conflicts: Conflict[];
  current: boolean;
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

  const preview = useMemo<PreviewData | null>(() => {
    if (!previewRef || !data) return null;
    const course = data.index.byKey.get(previewRef.courseKey);
    const pkg = course ? findPackage(course, previewRef.packageId) : null;
    if (!course || !pkg) return null;
    const pick = plan?.picks.find((p) => p.courseKey === course.key);
    // Conflicts must reference these exact slot objects so ghost blocks can be marked.
    const slots = slotsForPackage(course, pkg, { kind: 'candidate', status: pick?.status });
    const others = base.slots.filter((s) => s.ownerId !== course.key && s.status !== 'backup');
    return {
      course,
      pkg,
      slots,
      conflicts: findCrossConflicts(slots, others),
      current: pick?.packageId === pkg.id,
    };
  }, [previewRef, data, plan, base.slots]);

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

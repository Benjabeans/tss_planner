import type { Course, Package, PickStatus, Plan } from '@shared/types.ts';
import type { UndoRecord } from '../store/ui.ts';
import { conflictsAgainst, planSlots, packageSections } from '@shared/plan.ts';
import { usePlanStore } from '../store/plans.ts';
import { useUi } from '../store/ui.ts';
import { useCatalogStore } from '../store/catalog.ts';
import { describeConflict } from './describe.ts';

function indexFor(termCode: string) {
  const st = useCatalogStore.getState().byTerm[termCode];
  return st?.status === 'ready' ? st.data.index : null;
}

/** Add a package (or swap to it), then explain the outcome — never block. */
export function addPackage(course: Course, pkg: Package): void {
  const plans = usePlanStore.getState();
  const ui = useUi.getState();
  const termCode = plans.termCode;
  if (!termCode) return;
  const planId = plans.ensurePlan(termCode);
  const before = usePlanStore.getState().plans[planId]!;
  const existing = before.picks.find((p) => p.courseKey === course.key);
  if (existing?.packageId === pkg.id) return;

  usePlanStore.getState().addOrSwap(planId, course, pkg);
  ui.markFresh(course.key);

  const index = indexFor(termCode);
  const after = usePlanStore.getState().plans[planId]!;
  const status = after.picks.find((p) => p.courseKey === course.key)?.status;
  const conflicts = index ? conflictsAgainst(course, pkg, planSlots(after, index), status) : [];
  const errors = conflicts.filter((c) => c.severity === 'error');
  const warnings = conflicts.filter((c) => c.severity === 'warning');

  const parts = packageSections(course, pkg)
    .filter((s) => s.type !== 'LE' || existing === undefined)
    .map((s) => `${s.type} ${s.code.split('-').slice(0, 2).join('-')}`);
  let message = existing ? `Switched ${course.displayCode} to ${parts.join(' + ')}.` : `Added ${course.displayCode}.`;
  if (errors.length) message = `${message} ${describeConflict(errors[0]!)}.`;
  else if (warnings.length) message = `${message} ${describeConflict(warnings[0]!)}.`;
  if (pkg.status !== 'open') message += pkg.status === 'waitlist_only' ? ' Waitlist only.' : ' This section is full.';

  ui.pushToast({
    tone: errors.length ? 'danger' : warnings.length || pkg.status !== 'open' ? 'warn' : 'ok',
    message,
    undo: undoRecord([before]),
    action: errors.length || warnings.length ? { label: 'Fix', run: () => ui.openSheet({ kind: 'conflicts', focus: course.key }) } : undefined,
  });
  if (errors.length) ui.pulseCourses([course.key, ...errors.map((c) => (c.a.ownerId === course.key ? c.b.ownerId : c.a.ownerId))]);
}

export function removeCourse(courseKey: string, label: string): void {
  const plans = usePlanStore.getState();
  const termCode = plans.termCode;
  if (!termCode) return;
  const plan = plans.activePlan(termCode);
  if (!plan) return;
  plans.removePick(plan.id, courseKey);
  const ui = useUi.getState();
  ui.pushToast({ tone: 'neutral', message: `Removed ${label}.`, undo: undoRecord([plan]) });
  if (ui.sheet?.kind === 'pick' && ui.sheet.courseKey === courseKey) ui.openSheet(null);
}

export function setStatus(courseKey: string, status: PickStatus): void {
  const plans = usePlanStore.getState();
  const plan = plans.termCode ? plans.activePlan(plans.termCode) : null;
  if (plan) plans.setPickStatus(plan.id, courseKey, status);
}

/** Call right after a change, with the plans as they were before it. */
export function undoRecord(before: Plan[]): UndoRecord {
  const plans = usePlanStore.getState().plans;
  return { before, guard: Object.fromEntries(before.map((p) => [p.id, plans[p.id]?.rev ?? 0])) };
}

/** Restore the snapshots only if nothing changed since; never clobber later edits. */
export function undo(rec: UndoRecord): void {
  const plans = usePlanStore.getState().plans;
  if (rec.before.some((p) => (plans[p.id]?.rev ?? 0) !== rec.guard[p.id])) {
    useUi.getState().pushToast({ tone: 'warn', message: 'Can’t undo: the plan changed after that.' });
    return;
  }
  for (const p of rec.before) usePlanStore.getState().restorePlan(p);
  useUi.getState().pushToast({ tone: 'neutral', message: 'Undone.' });
}

/** Apply a generated schedule: swap/add every listed package in one undoable step. */
export function applySchedule(choices: { course: Course; pkg: Package }[], label: string): void {
  const plans = usePlanStore.getState();
  const termCode = plans.termCode;
  if (!termCode) return;
  const planId = plans.ensurePlan(termCode);
  const before = usePlanStore.getState().plans[planId]!;
  let changed = 0;
  for (const { course, pkg } of choices) {
    if (before.picks.find((p) => p.courseKey === course.key)?.packageId === pkg.id) continue;
    usePlanStore.getState().addOrSwap(planId, course, pkg);
    changed++;
  }
  const ui = useUi.getState();
  ui.closeFinder();
  ui.pushToast({
    tone: 'ok',
    message: changed ? `Applied ${label}: ${changed} course${changed === 1 ? '' : 's'} changed.` : `${label} matches your plan already.`,
    undo: changed ? undoRecord([before]) : undefined,
  });
  ui.pulseCourses(choices.map((c) => c.course.key));
}

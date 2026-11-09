import type { CustomBlock, Plan, PickStatus } from '@shared/types.ts';
import { findPackage } from '@shared/plan.ts';
import { usePlanStore } from '../store/plans.ts';
import { useCatalogStore } from '../store/catalog.ts';
import { useUi } from '../store/ui.ts';

/** Compact, versioned plan encoding carried in the URL hash (#share=…). */
interface SharePayload {
  v: 1;
  t: string;
  n: string;
  p: [courseKey: string, packageId: string, color: string, status: PickStatus][];
  b: [label: string, days: number[], start: number, end: number, color: string][];
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function shareUrl(plan: Plan): string {
  const payload: SharePayload = {
    v: 1,
    t: plan.termCode,
    n: plan.name,
    p: plan.picks.map((x) => [x.courseKey, x.packageId, x.color, x.status]),
    b: plan.blocks.map((x) => [x.label, x.days, x.start, x.end, x.color]),
  };
  return `${location.origin}${location.pathname}#share=${toBase64Url(JSON.stringify(payload))}`;
}

export function readShareHash(): SharePayload | null {
  const m = location.hash.match(/^#share=([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const p = JSON.parse(fromBase64Url(m[1]!)) as SharePayload;
    if (p.v !== 1 || typeof p.t !== 'string' || !Array.isArray(p.p)) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearShareHash(): void {
  history.replaceState(null, '', location.pathname + location.search);
}

/** Import a shared plan as a new plan once its term's catalog is loaded. Returns false if not ready. */
export function importShared(payload: SharePayload): boolean {
  const st = useCatalogStore.getState().byTerm[payload.t];
  if (st?.status !== 'ready') return false;
  const { index } = st.data;
  const plans = usePlanStore.getState();
  const planId = plans.createPlan(payload.t, { name: `${payload.n} (shared)` });
  let missing = 0;
  for (const [courseKey, packageId, color, status] of payload.p) {
    const course = index.byKey.get(courseKey);
    const pkg = course ? findPackage(course, packageId) : null;
    if (!course || !pkg) {
      missing++;
      continue;
    }
    usePlanStore.getState().addOrSwap(planId, course, pkg);
    usePlanStore.getState().setPickColor(planId, courseKey, color);
    usePlanStore.getState().setPickStatus(planId, courseKey, status);
  }
  for (const [label, days, start, end, color] of payload.b ?? []) {
    const block: CustomBlock = { id: `blk_${Math.random().toString(36).slice(2, 10)}`, label, days, start, end, color };
    usePlanStore.getState().upsertBlock(planId, block);
  }
  usePlanStore.getState().setTerm(payload.t);
  usePlanStore.getState().setActive(payload.t, planId);
  useUi.getState().pushToast({
    tone: missing ? 'warn' : 'ok',
    message: `Imported “${payload.n}” as a new plan.${missing ? ` ${missing} course${missing === 1 ? ' is' : 's are'} no longer offered and ${missing === 1 ? 'was' : 'were'} skipped.` : ''}`,
  });
  return true;
}

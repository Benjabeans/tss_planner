import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Course, CustomBlock, Package, Plan, PlanPick, PickStatus } from '@shared/types.ts';
import { fingerprintPackage, summarizePackage } from '@shared/plan.ts';
import { nextColor } from '@shared/colors.ts';

export interface Settings {
  /** Unit cap used for the header meter. */
  unitCap: number;
  /** Warn when two classes are closer than this (minutes); 0 disables. */
  tightGapMin: number;
}

interface PlansState {
  plans: Record<string, Plan>;
  /** termCode → active plan id */
  active: Record<string, string>;
  termCode: string | null;
  settings: Settings;

  setTerm: (code: string) => void;
  ensurePlan: (termCode: string) => string;
  activePlan: (termCode: string) => Plan | null;

  addOrSwap: (planId: string, course: Course, pkg: Package) => { swappedFrom: string | null };
  removePick: (planId: string, courseKey: string) => void;
  setPickStatus: (planId: string, courseKey: string, status: PickStatus) => void;
  setPickColor: (planId: string, courseKey: string, color: string) => void;
  acceptChanges: (planId: string, courseKey: string, course: Course, pkg: Package) => void;

  createPlan: (termCode: string, opts?: { name?: string; copyFrom?: string }) => string;
  renamePlan: (planId: string, name: string) => void;
  deletePlan: (planId: string) => void;
  setActive: (termCode: string, planId: string) => void;
  movePick: (fromPlanId: string, courseKey: string, toPlanId: string) => void;

  upsertBlock: (planId: string, block: CustomBlock) => void;
  removeBlock: (planId: string, blockId: string) => void;

  restorePlan: (plan: Plan) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

function nextPlanName(existing: Plan[]): string {
  const used = new Set(existing.map((p) => p.name));
  for (let i = 0; i < 26; i++) {
    const name = `Plan ${String.fromCharCode(65 + i)}`;
    if (!used.has(name)) return name;
  }
  return `Plan ${existing.length + 1}`;
}

export const usePlanStore = create<PlansState>()(
  persist(
    (set, get) => {
      const mutate = (planId: string, fn: (p: Plan) => Plan) =>
        set((s) => {
          const plan = s.plans[planId];
          if (!plan) return s;
          return { plans: { ...s.plans, [planId]: { ...fn(plan), updatedAt: now() } } };
        });

      return {
        plans: {},
        active: {},
        termCode: null,
        settings: { unitCap: 22, tightGapMin: 10 },

        setTerm: (code) => set({ termCode: code }),

        ensurePlan: (termCode) => {
          const existing = get().activePlan(termCode);
          if (existing) return existing.id;
          return get().createPlan(termCode);
        },

        activePlan: (termCode) => {
          const s = get();
          const id = s.active[termCode];
          if (id && s.plans[id]) return s.plans[id]!;
          return Object.values(s.plans).find((p) => p.termCode === termCode) ?? null;
        },

        addOrSwap: (planId, course, pkg) => {
          let swappedFrom: string | null = null;
          mutate(planId, (p) => {
            const existing = p.picks.find((x) => x.courseKey === course.key);
            const pick: PlanPick = {
              courseKey: course.key,
              packageId: pkg.id,
              color: existing?.color ?? nextColor(p.picks.map((x) => x.color)),
              status: existing?.status ?? 'planned',
              fingerprint: fingerprintPackage(course, pkg),
              summaryAtAdd: summarizePackage(course, pkg),
              addedAt: existing?.addedAt ?? now(),
            };
            if (existing) {
              swappedFrom = existing.packageId;
              return { ...p, picks: p.picks.map((x) => (x.courseKey === course.key ? pick : x)) };
            }
            return { ...p, picks: [...p.picks, pick] };
          });
          return { swappedFrom };
        },

        removePick: (planId, courseKey) =>
          mutate(planId, (p) => ({ ...p, picks: p.picks.filter((x) => x.courseKey !== courseKey) })),

        setPickStatus: (planId, courseKey, status) =>
          mutate(planId, (p) => ({ ...p, picks: p.picks.map((x) => (x.courseKey === courseKey ? { ...x, status } : x)) })),

        setPickColor: (planId, courseKey, color) =>
          mutate(planId, (p) => ({ ...p, picks: p.picks.map((x) => (x.courseKey === courseKey ? { ...x, color } : x)) })),

        acceptChanges: (planId, courseKey, course, pkg) =>
          mutate(planId, (p) => ({
            ...p,
            picks: p.picks.map((x) =>
              x.courseKey === courseKey
                ? { ...x, fingerprint: fingerprintPackage(course, pkg), summaryAtAdd: summarizePackage(course, pkg) }
                : x,
            ),
          })),

        createPlan: (termCode, { name, copyFrom } = {}) => {
          const s = get();
          const termPlans = Object.values(s.plans).filter((p) => p.termCode === termCode);
          const source = copyFrom ? s.plans[copyFrom] : undefined;
          const plan: Plan = {
            id: uid(),
            termCode,
            name: name ?? (source ? `${source.name} copy` : nextPlanName(termPlans)),
            picks: source ? source.picks.map((x) => ({ ...x })) : [],
            blocks: source ? source.blocks.map((b) => ({ ...b, id: uid() })) : [],
            createdAt: now(),
            updatedAt: now(),
          };
          set((st) => ({ plans: { ...st.plans, [plan.id]: plan }, active: { ...st.active, [termCode]: plan.id } }));
          return plan.id;
        },

        renamePlan: (planId, name) => mutate(planId, (p) => ({ ...p, name: name.trim() || p.name })),

        deletePlan: (planId) =>
          set((s) => {
            const plan = s.plans[planId];
            if (!plan) return s;
            const plans = { ...s.plans };
            delete plans[planId];
            const active = { ...s.active };
            if (active[plan.termCode] === planId) {
              const next = Object.values(plans).find((p) => p.termCode === plan.termCode);
              if (next) active[plan.termCode] = next.id;
              else delete active[plan.termCode];
            }
            return { plans, active };
          }),

        setActive: (termCode, planId) => set((s) => ({ active: { ...s.active, [termCode]: planId } })),

        movePick: (fromPlanId, courseKey, toPlanId) =>
          set((s) => {
            const from = s.plans[fromPlanId];
            const to = s.plans[toPlanId];
            const pick = from?.picks.find((x) => x.courseKey === courseKey);
            if (!from || !to || !pick) return s;
            const toPicks = [...to.picks.filter((x) => x.courseKey !== courseKey), pick];
            return {
              plans: {
                ...s.plans,
                [fromPlanId]: { ...from, picks: from.picks.filter((x) => x.courseKey !== courseKey), updatedAt: now() },
                [toPlanId]: { ...to, picks: toPicks, updatedAt: now() },
              },
            };
          }),

        upsertBlock: (planId, block) =>
          mutate(planId, (p) => ({
            ...p,
            blocks: p.blocks.some((b) => b.id === block.id)
              ? p.blocks.map((b) => (b.id === block.id ? block : b))
              : [...p.blocks, block],
          })),

        removeBlock: (planId, blockId) => mutate(planId, (p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== blockId) })),

        restorePlan: (plan) => set((s) => ({ plans: { ...s.plans, [plan.id]: plan } })),

        updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      };
    },
    {
      name: 'tss-planner:v1',
      version: 1,
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return sessionStorage;
        }
      }),
      partialize: (s) => ({ plans: s.plans, active: s.active, termCode: s.termCode, settings: s.settings }),
    },
  ),
);

export const newBlockId = () => `blk_${uid()}`;

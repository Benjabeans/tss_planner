import { create } from 'zustand';
import type { Plan } from '@shared/types.ts';

export interface Preview {
  courseKey: string;
  packageId: string;
}

export type Sheet =
  | { kind: 'pick'; courseKey: string }
  | { kind: 'conflicts'; focus?: string }
  | { kind: 'block'; blockId: string | null }
  | { kind: 'settings' }
  | null;

export interface Toast {
  id: number;
  tone: 'neutral' | 'danger' | 'warn' | 'ok';
  message: string;
  undo?: Plan;
  action?: { label: string; run: () => void };
}

export type MobileTab = 'search' | 'calendar' | 'plan';

interface UiState {
  preview: Preview | null;
  view: 'week' | 'finals';
  sheet: Sheet;
  toasts: Toast[];
  mobileTab: MobileTab;
  /** Course key to highlight on the calendar (hovering its row or block). */
  focusCourse: string | null;
  /** Course keys whose blocks should pulse once (just added or focused from the conflict center). */
  pulse: string[];
  fresh: string | null;

  setPreview: (p: Preview | null) => void;
  setView: (v: 'week' | 'finals') => void;
  openSheet: (s: Sheet) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setMobileTab: (t: MobileTab) => void;
  setFocusCourse: (k: string | null) => void;
  pulseCourses: (keys: string[]) => void;
  markFresh: (k: string | null) => void;
}

let toastId = 1;

export const useUi = create<UiState>((set) => ({
  preview: null,
  view: 'week',
  sheet: null,
  toasts: [],
  mobileTab: 'search',
  focusCourse: null,
  pulse: [],
  fresh: null,

  setPreview: (preview) => set({ preview }),
  setView: (view) => set({ view }),
  openSheet: (sheet) => set({ sheet }),
  pushToast: (t) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.undo || t.action ? 8000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setFocusCourse: (focusCourse) => set({ focusCourse }),
  pulseCourses: (pulse) => {
    set({ pulse });
    setTimeout(() => set({ pulse: [] }), 2000);
  },
  markFresh: (fresh) => {
    set({ fresh });
    if (fresh) setTimeout(() => set((s) => (s.fresh === fresh ? { fresh: null } : s)), 400);
  },
}));

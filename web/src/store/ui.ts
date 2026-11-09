import { create } from 'zustand';
import type { Plan } from '@shared/types.ts';
import type { Preference } from '@shared/generate.ts';

export interface Preview {
  courseKey: string;
  packageId: string;
}

export interface SchedulePreview {
  label: string;
  choices: { courseKey: string; packageId: string }[];
}

export type Sheet =
  | { kind: 'pick'; courseKey: string }
  | { kind: 'conflicts'; focus?: string }
  | { kind: 'block'; blockId: string | null }
  | { kind: 'settings' }
  | null;

/** Plans as they were before an action, plus their revisions right after it. */
export interface UndoRecord {
  before: Plan[];
  guard: Record<string, number>;
}

export interface Toast {
  id: number;
  tone: 'neutral' | 'danger' | 'warn' | 'ok';
  message: string;
  undo?: UndoRecord;
  action?: { label: string; run: () => void };
}

export type MobileTab = 'search' | 'calendar' | 'plan';

/** Rules for the schedule finder; kept for the session so reopening it doesn't reset them. */
export interface FinderOpts {
  /** Course keys kept exactly as planned. null means the default: enrolled courses. */
  locked: string[] | null;
  openOnly: boolean;
  avoidDays: number[];
  earliest: number | null;
  latest: number | null;
  preference: Preference;
}

/** The open schedule finder. Option indexes point into the current result list. */
export interface FinderUi {
  /** Option the user picked (stays previewed). */
  selected: number | null;
  /** Option under the pointer (previewed while hovering). */
  hovered: number | null;
  /** Phones only: the option list is showing (true) or the calendar with the pager (false). */
  list: boolean;
}

interface UiState {
  preview: Preview | null;
  schedulePreview: SchedulePreview | null;
  view: 'week' | 'finals';
  sheet: Sheet;
  finder: FinderUi | null;
  finderOpts: FinderOpts;
  toasts: Toast[];
  mobileTab: MobileTab;
  /** Course key to highlight on the calendar (hovering its row or block). */
  focusCourse: string | null;
  /** Course keys whose blocks should pulse once (just added or focused from the conflict center). */
  pulse: string[];
  fresh: string | null;

  setPreview: (p: Preview | null) => void;
  setSchedulePreview: (p: SchedulePreview | null) => void;
  setView: (v: 'week' | 'finals') => void;
  openSheet: (s: Sheet) => void;
  openFinder: () => void;
  closeFinder: () => void;
  patchFinder: (p: Partial<FinderUi>) => void;
  setFinderOpts: (p: Partial<FinderOpts>) => void;
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
  schedulePreview: null,
  view: 'week',
  sheet: null,
  finder: null,
  finderOpts: { locked: null, openOnly: false, avoidDays: [], earliest: null, latest: null, preference: 'balanced' },
  toasts: [],
  mobileTab: 'search',
  focusCourse: null,
  pulse: [],
  fresh: null,

  setPreview: (preview) => set({ preview }),
  setSchedulePreview: (schedulePreview) => set({ schedulePreview }),
  setView: (view) => set({ view }),
  openSheet: (sheet) =>
    set((s) => ({
      sheet,
      schedulePreview: null,
      preview: null,
      // A sheet takes over the calendar preview; drop the finder's pick so the two never disagree.
      finder: s.finder && sheet ? { ...s.finder, selected: null, hovered: null } : s.finder,
    })),
  openFinder: () =>
    set((s) => ({
      finder: { selected: null, hovered: null, list: true },
      finderOpts: { ...s.finderOpts, locked: null },
      sheet: null,
      preview: null,
      schedulePreview: null,
    })),
  closeFinder: () => set({ finder: null, schedulePreview: null }),
  patchFinder: (p) => set((s) => (s.finder ? { finder: { ...s.finder, ...p } } : s)),
  setFinderOpts: (p) =>
    set((s) => ({
      finderOpts: { ...s.finderOpts, ...p },
      finder: s.finder ? { ...s.finder, selected: null, hovered: null } : null,
    })),
  pushToast: (t) => {
    const id = toastId++;
    set({ toasts: [{ ...t, id }] });
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.action ? 8000 : t.undo ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  // The finder's pager lives on the calendar tab; leaving it ends the preview.
  setMobileTab: (mobileTab) =>
    set((s) => (s.finder && mobileTab !== 'calendar' ? { mobileTab, finder: null, schedulePreview: null } : { mobileTab })),
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

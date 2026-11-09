import { create } from 'zustand';
import type { Catalog, TermSummary } from '@shared/types.ts';
import { indexCatalog, type CatalogIndex } from '@shared/plan.ts';
import { buildSearchIndex, type SearchIndex } from '@shared/search.ts';

export interface LoadedCatalog {
  catalog: Catalog;
  index: CatalogIndex;
  search: SearchIndex;
}

type TermState =
  | { status: 'loading' }
  | { status: 'ready'; data: LoadedCatalog }
  | { status: 'missing'; message: string }
  | { status: 'error'; message: string };

interface CatalogStore {
  terms: TermSummary[] | null;
  termsError: string | null;
  byTerm: Record<string, TermState>;
  loadTerms: () => Promise<void>;
  loadCatalog: (code: string, opts?: { refresh?: boolean }) => Promise<void>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  return (await res.json()) as T;
}

export const useCatalogStore = create<CatalogStore>((set, get) => ({
  terms: null,
  termsError: null,
  byTerm: {},

  async loadTerms() {
    try {
      const { terms } = await getJson<{ terms: TermSummary[] }>('/api/terms');
      set({ terms, termsError: null });
    } catch (err) {
      set({ termsError: (err as Error).message });
    }
  },

  async loadCatalog(code, { refresh = false } = {}) {
    const current = get().byTerm[code];
    if (!refresh && (current?.status === 'ready' || current?.status === 'loading')) return;
    if (!current || current.status !== 'ready') set((s) => ({ byTerm: { ...s.byTerm, [code]: { status: 'loading' } } }));
    try {
      const catalog = await getJson<Catalog>(`/api/terms/${code}/catalog`);
      const data: LoadedCatalog = { catalog, index: indexCatalog(catalog), search: buildSearchIndex(catalog) };
      set((s) => ({ byTerm: { ...s.byTerm, [code]: { status: 'ready', data } } }));
    } catch (err) {
      const e = err as Error & { status?: number };
      if (current?.status === 'ready') return; // keep showing what we have
      set((s) => ({
        byTerm: { ...s.byTerm, [code]: { status: e.status === 404 ? 'missing' : 'error', message: e.message } },
      }));
    }
  },
}));

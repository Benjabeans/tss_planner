import { useEffect, useRef, useState } from 'react';
import { clearShareHash, importShared, readShareHash } from './lib/share.ts';
import { CalendarRange, ListChecks, Search } from 'lucide-react';
import { termSortKey } from '@shared/terms.ts';
import { PlannerProvider, usePlanner } from './lib/planner.tsx';
import { useCatalogStore } from './store/catalog.ts';
import { usePlanStore } from './store/plans.ts';
import { useUi, type MobileTab } from './store/ui.ts';
import { Header } from './components/Header.tsx';
import { SearchPanel } from './components/SearchPanel.tsx';
import { Calendar } from './components/Calendar.tsx';
import { PlanTable } from './components/PlanTable.tsx';
import { SheetHost } from './components/Sheets.tsx';
import { Toasts } from './components/Toasts.tsx';
import { FindButton, FinderPanel, FinderProvider, SchedulePager } from './components/Finder.tsx';
import { useIsDesktop } from './lib/media.ts';

export function App() {
  useBootstrap();
  return (
    <PlannerProvider>
      <FinderProvider>
        <div className="flex h-dvh flex-col">
          <Header />
          <Body />
          <MobileTabs />
          <SheetHost />
          <Toasts />
        </div>
      </FinderProvider>
    </PlannerProvider>
  );
}

/** Load the term list, pick a term, and keep its catalog fresh. */
function useBootstrap() {
  const terms = useCatalogStore((s) => s.terms);
  const termCode = usePlanStore((s) => s.termCode);
  const byTerm = useCatalogStore((s) => s.byTerm);
  const [shared, setShared] = useState(() => readShareHash());
  const imported = useRef(false);

  // Pasting a share link into an open tab only changes the hash, without a reload.
  useEffect(() => {
    const onHash = () => {
      const p = readShareHash();
      if (!p) return;
      imported.current = false;
      setShared(p);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // A #share= link switches to its term, then imports once that catalog is ready.
  useEffect(() => {
    if (!shared || imported.current) return;
    if (termCode !== shared.t) {
      usePlanStore.getState().setTerm(shared.t);
      return;
    }
    if (importShared(shared)) {
      imported.current = true;
      clearShareHash();
    } else if (byTerm[shared.t]?.status === 'missing' || byTerm[shared.t]?.status === 'error') {
      imported.current = true;
      clearShareHash();
      useUi.getState().pushToast({ tone: 'danger', message: 'That shared plan is for a term this planner has no data for.' });
    }
  }, [shared, termCode, byTerm]);

  useEffect(() => {
    void useCatalogStore.getState().loadTerms();
    const t = setInterval(() => void useCatalogStore.getState().loadTerms(), 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!terms || terms.length === 0) return;
    const available = terms.filter((t) => t.available);
    if (termCode && terms.some((t) => t.code === termCode)) return;
    if (shared && terms.some((t) => t.code === shared.t)) return;
    // Default to the latest term that has data.
    const latest = [...available].sort((a, b) => termSortKey(b.code).localeCompare(termSortKey(a.code)))[0];
    if (latest) usePlanStore.getState().setTerm(latest.code);
  }, [terms, termCode]);

  useEffect(() => {
    if (!termCode) return;
    void useCatalogStore.getState().loadCatalog(termCode);
    // Pick up seat refreshes while the tab is open (ETag makes unchanged polls cheap).
    const t = setInterval(() => void useCatalogStore.getState().loadCatalog(termCode, { refresh: true }), 10 * 60_000);
    return () => clearInterval(t);
  }, [termCode]);
}

function Body() {
  const tab = useUi((s) => s.mobileTab);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const finder = useUi((s) => s.finder);
  const desktop = useIsDesktop();
  const { data, termCode, finalsConflicts } = usePlanner();
  const termState = useCatalogStore((s) => (termCode ? s.byTerm[termCode] : undefined));
  const termsError = useCatalogStore((s) => s.termsError);

  if (termsError) return <Notice title="Can’t reach the planner server" body={`${termsError}. Is it running? Start it with “npm run dev”.`} />;
  if (!termCode || !termState || termState.status === 'loading') return <Notice title="Loading courses…" body="Fetching this term’s schedule of classes." />;
  if (termState.status === 'missing') return <Notice title="No data for this term yet" body={termState.message} retry={termCode} />;
  if (termState.status === 'error') return <Notice title="Couldn’t load courses" body={termState.message} retry={termCode} />;
  if (!data) return null;

  const show = (t: MobileTab) => (tab === t ? 'flex' : 'hidden');
  return (
    <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
      {/* Left column: search, or the schedule finder in its place so the calendar stays in view. */}
      <aside className={`${show('search')} no-print min-h-0 flex-col border-r border-rule bg-surface pb-14 lg:flex lg:pb-0`} aria-label="Course search">
        <div className={finder && desktop ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
          <SearchPanel />
        </div>
        {finder && desktop && <FinderPanel />}
      </aside>
      {/* Phones: the option list takes the screen; picking one goes back to the calendar with a pager. */}
      {finder && !desktop && finder.list && (
        <div className="no-print fixed inset-0 z-40 flex flex-col bg-surface" role="dialog" aria-modal="true" aria-labelledby="finder-title">
          <FinderPanel />
        </div>
      )}
      {finder && !desktop && !finder.list && tab === 'calendar' && <SchedulePager variant="mobile" />}
      <div className={`scroll-thin min-h-0 overflow-y-auto ${tab === 'search' ? 'hidden lg:block' : ''}`}>
        <div className={`mx-auto flex max-w-[1200px] flex-col gap-3 p-3 sm:p-4 lg:pb-6 ${finder && !desktop ? 'pb-48' : 'pb-24'}`}>
          <div className={`${show('calendar')} flex-col gap-3 lg:flex`}>
            <div className="no-print flex items-center gap-2">
              <div className="inline-flex h-9 shrink-0 rounded-lg border border-rule-strong bg-surface p-0.5" role="tablist" aria-label="Calendar view">
                {(['week', 'finals'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`flex items-center rounded-md px-3 text-[13px] font-medium ${view === v ? 'bg-ink text-surface' : 'text-muted hover:text-ink'}`}
                  >
                    {v === 'week' ? 'Week' : 'Finals'}
                    {v === 'finals' && finalsConflicts.some((c) => c.severity === 'error') && (
                      <span className="ml-1.5 inline-block size-1.5 rounded-full bg-danger align-middle" aria-label="finals conflict" />
                    )}
                  </button>
                ))}
              </div>
              <div className="min-w-0 flex-1">{finder ? desktop && <SchedulePager variant="toolbar" /> : <PreviewHint />}</div>
              <FindButton />
            </div>
            <Calendar />
          </div>
          <div className={`${show('plan')} flex-col lg:flex`}>
            <PlanTable />
          </div>
        </div>
      </div>
    </main>
  );
}

function PreviewHint() {
  const { preview } = usePlanner();
  if (!preview) return null;
  return (
    <p className="truncate text-xs text-muted">
      Previewing <b className="text-ink">{preview.label}</b>
      {preview.current ? ' (already in your plan)' : ' — click to add'}
    </p>
  );
}

function Notice({ title, body, retry }: { title: string; body: string; retry?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-1 text-[13px] text-muted">{body}</p>
        {retry && (
          <button
            type="button"
            onClick={() => void useCatalogStore.getState().loadCatalog(retry, { refresh: true })}
            className="mt-3 rounded-md border border-rule-strong px-3 py-1.5 text-[13px] font-medium hover:border-ink"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function MobileTabs() {
  const tab = useUi((s) => s.mobileTab);
  const setTab = useUi((s) => s.setMobileTab);
  const { plan, weeklyCounts } = usePlanner();
  const items: { id: MobileTab; label: string; icon: typeof Search; badge?: string }[] = [
    { id: 'search', label: 'Search', icon: Search },
    { id: 'calendar', label: 'Calendar', icon: CalendarRange, badge: weeklyCounts.error ? String(weeklyCounts.error) : undefined },
    { id: 'plan', label: 'Plan', icon: ListChecks, badge: plan?.picks.length ? String(plan.picks.length) : undefined },
  ];
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-rule bg-surface lg:hidden" aria-label="Sections">
      {items.map(({ id, label, icon: Icon, badge }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          aria-current={tab === id ? 'page' : undefined}
          className={`relative flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${tab === id ? 'text-ink' : 'text-muted'}`}
        >
          <Icon className="size-5" aria-hidden />
          {label}
          {badge && (
            <span
              className={`absolute top-1 left-1/2 ml-2 rounded-full px-1.5 text-[10px] leading-4 font-semibold ${
                id === 'calendar' ? 'bg-danger text-white' : 'bg-ink text-surface'
              }`}
            >
              {badge}
            </span>
          )}
          {tab === id && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-accent" aria-hidden />}
        </button>
      ))}
    </nav>
  );
}

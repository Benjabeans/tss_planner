import { useEffect } from 'react';
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

export function App() {
  useBootstrap();
  return (
    <PlannerProvider>
      <div className="flex h-full flex-col">
        <Header />
        <Body />
        <MobileTabs />
        <SheetHost />
        <Toasts />
      </div>
    </PlannerProvider>
  );
}

/** Load the term list, pick a term, and keep its catalog fresh. */
function useBootstrap() {
  const terms = useCatalogStore((s) => s.terms);
  const termCode = usePlanStore((s) => s.termCode);

  useEffect(() => {
    void useCatalogStore.getState().loadTerms();
    const t = setInterval(() => void useCatalogStore.getState().loadTerms(), 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!terms || terms.length === 0) return;
    const available = terms.filter((t) => t.available);
    if (termCode && terms.some((t) => t.code === termCode)) return;
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
    <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(340px,400px)_1fr]">
      <aside className={`${show('search')} no-print min-h-0 flex-col border-r border-rule bg-surface lg:flex`} aria-label="Course search">
        <SearchPanel />
      </aside>
      <div className="scroll-thin min-h-0 overflow-y-auto">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 p-3 pb-24 sm:p-4 lg:pb-6">
          <div className={`${show('calendar')} flex-col gap-3 lg:flex`}>
            <div className="no-print flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5" role="tablist" aria-label="Calendar view">
                {(['week', 'finals'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`rounded-md px-3 py-1 text-[13px] font-medium ${view === v ? 'bg-ink text-surface' : 'text-muted hover:text-ink'}`}
                  >
                    {v === 'week' ? 'Week' : 'Finals'}
                    {v === 'finals' && finalsConflicts.some((c) => c.severity === 'error') && (
                      <span className="ml-1.5 inline-block size-1.5 rounded-full bg-danger align-middle" aria-label="finals conflict" />
                    )}
                  </button>
                ))}
              </div>
              <PreviewHint />
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

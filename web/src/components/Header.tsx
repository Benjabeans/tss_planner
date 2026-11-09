import { AlertTriangle, CalendarDays, Check, ChevronDown, Copy, Download, MoreHorizontal, Pencil, Plus, Printer, Settings, Trash2 } from 'lucide-react';
import { buildIcs } from '@shared/ics.ts';
import { usePlanner } from '../lib/planner.tsx';
import { usePlanStore } from '../store/plans.ts';
import { useCatalogStore } from '../store/catalog.ts';
import { useUi } from '../store/ui.ts';
import { Menu, MenuDivider, MenuItem } from './Menu.tsx';

export function Header() {
  return (
    <header className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-surface px-3 py-2 sm:px-4">
      <div className="flex items-center gap-2 pr-1">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">TSS Planner</span>
      </div>
      <TermPicker />
      <PlanSwitcher />
      <div className="ml-auto flex items-center gap-2">
        <UnitsMeter />
        <ConflictPill />
        <MoreMenu />
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <rect x="7" y="8" width="8" height="10" rx="1.5" fill="var(--accent)" />
      <rect x="17" y="12" width="8" height="12" rx="1.5" fill="var(--paper)" opacity=".85" />
      <rect x="7" y="20" width="8" height="5" rx="1.5" fill="var(--paper)" opacity=".5" />
    </svg>
  );
}

function TermPicker() {
  const terms = useCatalogStore((s) => s.terms);
  const termCode = usePlanStore((s) => s.termCode);
  const setTerm = usePlanStore((s) => s.setTerm);
  if (!terms || terms.length === 0) return null;
  return (
    <label className="relative">
      <span className="sr-only">Term</span>
      <select
        value={termCode ?? ''}
        onChange={(e) => {
          setTerm(e.target.value);
          useUi.getState().setPreview(null);
        }}
        className="appearance-none rounded-lg border border-rule-strong bg-surface py-1 pr-7 pl-2.5 text-[13px] font-medium hover:border-ink"
      >
        {terms.map((t) => (
          <option key={t.code} value={t.code} disabled={!t.available}>
            {t.name}
            {t.available ? '' : ' (downloading…)'}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
    </label>
  );
}

function PlanSwitcher() {
  const { plan, termCode } = usePlanner();
  const plans = usePlanStore((s) => s.plans);
  const st = usePlanStore.getState;
  if (!termCode) return null;
  const termPlans = Object.values(plans)
    .filter((p) => p.termCode === termCode)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <Menu
      label="Switch plan"
      trigger={(open) => (
        <span
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium ${
            open ? 'border-ink' : 'border-rule-strong hover:border-ink'
          }`}
        >
          {plan?.name ?? 'Plan A'}
          <span className="tnum text-xs font-normal text-muted">
            {plan ? `${plan.picks.length} course${plan.picks.length === 1 ? '' : 's'}` : 'empty'}
          </span>
          <ChevronDown className="size-3.5 text-muted" aria-hidden />
        </span>
      )}
    >
      {(close) => (
        <>
          {termPlans.map((p) => (
            <MenuItem
              key={p.id}
              onClick={() => {
                st().setActive(termCode, p.id);
                close();
              }}
            >
              <span className="w-4">{p.id === plan?.id && <Check className="size-3.5" />}</span>
              <span className="flex-1">{p.name}</span>
              <span className="tnum text-xs text-muted">{p.picks.length}</span>
            </MenuItem>
          ))}
          {termPlans.length > 0 && <MenuDivider />}
          <MenuItem
            onClick={() => {
              st().createPlan(termCode);
              close();
            }}
          >
            <Plus className="size-3.5" /> New empty plan
          </MenuItem>
          <MenuItem
            disabled={!plan}
            onClick={() => {
              if (plan) st().createPlan(termCode, { copyFrom: plan.id });
              close();
            }}
          >
            <Copy className="size-3.5" /> Duplicate this plan
          </MenuItem>
          <MenuItem
            disabled={!plan}
            onClick={() => {
              close();
              if (!plan) return;
              const name = window.prompt('Rename plan', plan.name);
              if (name) st().renamePlan(plan.id, name);
            }}
          >
            <Pencil className="size-3.5" /> Rename…
          </MenuItem>
          <MenuItem
            danger
            disabled={!plan}
            onClick={() => {
              close();
              if (!plan) return;
              if (plan.picks.length === 0 || window.confirm(`Delete “${plan.name}” and its ${plan.picks.length} courses?`)) {
                st().deletePlan(plan.id);
              }
            }}
          >
            <Trash2 className="size-3.5" /> Delete plan
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function UnitsMeter() {
  const { units } = usePlanner();
  const cap = usePlanStore((s) => s.settings.unitCap);
  const over = units.min > cap;
  const pct = Math.min(100, (units.min / cap) * 100);
  const text = units.min === units.max ? `${units.min}` : `${units.min}–${units.max}`;
  return (
    <div
      className="hidden items-center gap-2 sm:flex"
      title={`${text} units planned · cap ${cap} (backups not counted)`}
      aria-label={`${text} units planned of ${cap}`}
    >
      <div className="text-right leading-tight">
        <div className={`tnum text-[13px] font-semibold ${over ? 'text-danger' : ''}`}>{text} units</div>
      </div>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${over ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConflictPill() {
  const { weeklyCounts, finalsConflicts, plan } = usePlanner();
  const open = () => useUi.getState().openSheet({ kind: 'conflicts' });
  if (!plan || plan.picks.length === 0) return null;
  const finals = finalsConflicts.filter((c) => c.severity === 'error').length;
  const errors = weeklyCounts.error;
  const warnings = weeklyCounts.warning;
  if (errors + warnings + finals === 0) {
    return (
      <button type="button" onClick={open} className="flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-medium text-ok">
        <Check className="size-3.5" aria-hidden /> No conflicts
      </button>
    );
  }
  const parts: string[] = [];
  if (errors) parts.push(`${errors} conflict${errors === 1 ? '' : 's'}`);
  if (finals) parts.push(`${finals} finals clash${finals === 1 ? '' : 'es'}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  const tone = errors || finals ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn';
  return (
    <button type="button" onClick={open} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      <AlertTriangle className="size-3.5" aria-hidden /> {parts.join(' · ')}
    </button>
  );
}

function MoreMenu() {
  const { plan, data, termDates, termCode } = usePlanner();
  const exportIcs = () => {
    if (!plan || !data || !termDates) return;
    const ics = buildIcs({ plan, index: data.index, dates: termDates });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${termCode}-${plan.name.replace(/\s+/g, '-')}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Menu
      label="More actions"
      align="right"
      trigger={() => (
        <span className="flex size-8 items-center justify-center rounded-lg border border-rule-strong hover:border-ink">
          <MoreHorizontal className="size-4" />
        </span>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            disabled={!plan || plan.picks.length === 0 || !termDates}
            onClick={() => {
              exportIcs();
              close();
            }}
          >
            <Download className="size-3.5" /> Export to calendar (.ics)
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              setTimeout(() => window.print(), 50);
            }}
          >
            <Printer className="size-3.5" /> Print schedule
          </MenuItem>
          <MenuItem
            onClick={() => {
              useUi.getState().openSheet({ kind: 'block', blockId: null });
              close();
            }}
          >
            <CalendarDays className="size-3.5" /> Block off time…
          </MenuItem>
          <MenuDivider />
          <MenuItem
            onClick={() => {
              useUi.getState().openSheet({ kind: 'settings' });
              close();
            }}
          >
            <Settings className="size-3.5" /> Settings
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

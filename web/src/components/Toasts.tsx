import { X } from 'lucide-react';
import { useUi } from '../store/ui.ts';
import { undo } from '../lib/actions.ts';

const TONE: Record<string, string> = {
  neutral: 'border-rule',
  ok: 'border-ok/50',
  warn: 'border-warn/60',
  danger: 'border-danger/60',
};
const BAR: Record<string, string> = {
  neutral: 'bg-faint',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center gap-2 px-3 lg:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex w-full max-w-lg items-stretch overflow-hidden rounded-lg border bg-surface text-[13px] shadow-[var(--shadow)] ${TONE[t.tone]}`}
        >
          <span className={`w-1 shrink-0 ${BAR[t.tone]}`} aria-hidden />
          <p className="min-w-0 flex-1 px-3 py-2">{t.message}</p>
          <div className="flex shrink-0 items-center gap-1 pr-1.5">
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
                className="rounded-md px-2 py-1 font-semibold hover:bg-surface-2"
              >
                {t.action.label}
              </button>
            )}
            {t.undo && (
              <button
                type="button"
                onClick={() => {
                  undo(t.undo!);
                  dismiss(t.id);
                }}
                className="rounded-md px-2 py-1 font-semibold hover:bg-surface-2"
              >
                Undo
              </button>
            )}
            <button type="button" onClick={() => dismiss(t.id)} className="rounded-md p-1 text-faint hover:text-ink" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

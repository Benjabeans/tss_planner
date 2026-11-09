import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Minimal disclosure menu: button + popover panel, closes on outside click / Escape. */
export function Menu({
  trigger,
  children,
  align = 'left',
  label,
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
        {trigger(open)}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-40 mt-1.5 min-w-56 rounded-lg border border-rule bg-surface p-1 shadow-[var(--shadow)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  danger,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2 disabled:opacity-40 ${
        danger ? 'text-danger' : 'text-ink'
      }`}
    >
      {children}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-rule" />;
}

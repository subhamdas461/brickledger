import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Lightweight dropdown menu: click/keyboard toggle, closes on outside click or Escape. */
export function Menu({ trigger, items, align = 'right', className }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode; items: (MenuItem | null)[]; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Opens upward when there's no room below, e.g. the account menu at the bottom of the sidebar.
  useLayoutEffect(() => {
    if (!open || !ref.current || !menuRef.current) return;
    const anchor = ref.current.getBoundingClientRect();
    const height = menuRef.current.offsetHeight + 8;
    setOpenUp(anchor.bottom + height > window.innerHeight && anchor.top - height > 0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
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
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={cn(
            openUp ? 'bottom-full mb-1.5' : 'mt-1.5',
            'absolute z-50 min-w-48 animate-pop-in overflow-hidden rounded-xl border border-stone-200 bg-white p-1 shadow-xl shadow-stone-900/10 dark:border-stone-700 dark:bg-stone-900',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.filter(Boolean).map((item, i) => (
            <button
              key={i}
              role="menuitem"
              disabled={item!.disabled}
              onClick={() => {
                setOpen(false);
                item!.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-40',
                item!.danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10' : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
              )}
            >
              {item!.icon && <span className="text-stone-400 [&>svg]:size-4">{item!.icon}</span>}
              {item!.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b border-stone-200 dark:border-stone-800', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            t.value === value
              ? 'border-brand-600 text-stone-900 dark:text-white'
              : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="rounded-full bg-stone-100 px-1.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

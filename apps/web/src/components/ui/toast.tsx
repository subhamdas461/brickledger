import { CircleCheck, CircleExclamationPoint, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  success(message: string): void;
  error(message: string, action?: ToastItem['action']): void;
  info(message: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: Tone, message: string, action?: ToastItem['action']) => {
      const id = nextId++;
      setItems((all) => [...all.slice(-3), { id, tone, message, action }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 3500);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m, a) => push('error', m, a), info: (m) => push('info', m) }),
    [push],
  );
  const icons = { success: CircleCheck, error: CircleExclamationPoint, info: Info };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-3 rounded-2xl border border-stone-200 bg-white p-3.5 text-sm shadow-lg shadow-stone-900/10 dark:border-stone-700 dark:bg-stone-900"
            >
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  t.tone === 'success' && 'text-[var(--good)]',
                  t.tone === 'error' && 'text-[var(--critical)]',
                  t.tone === 'info' && 'text-[var(--series-1)]',
                )}
              />
              <p className="flex-1 text-stone-700 dark:text-stone-200">{t.message}</p>
              {t.action && (
                <button className="font-semibold text-brand-700 hover:underline dark:text-brand-400" onClick={t.action.onClick}>
                  {t.action.label}
                </button>
              )}
              <button aria-label="Dismiss" className="text-stone-400 hover:text-stone-600" onClick={() => dismiss(t.id)}>
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

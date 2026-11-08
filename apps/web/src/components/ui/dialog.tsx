import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './button';

/**
 * Modal built on the native <dialog> element (focus trap, Esc, inert background
 * for free). Renders nothing while closed.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] overflow-visible rounded-3xl border border-stone-200 bg-white p-0 text-stone-900 shadow-2xl shadow-stone-900/20 backdrop:bg-transparent dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100',
        size === 'sm' && 'max-w-md',
        size === 'md' && 'max-w-xl',
        size === 'lg' && 'max-w-3xl',
        size === 'xl' && 'max-w-5xl',
      )}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-6 py-4 dark:border-stone-800">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">{description}</p>}
          </div>
          <button aria-label="Close" onClick={onClose} className="-mr-2 rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800">
            <X className="size-5" />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 px-6 py-3.5 dark:border-stone-800">{footer}</div>}
      </div>
    </dialog>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ title: string; message: ReactNode; confirmLabel: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = (title: string, message: ReactNode, confirmLabel = 'Delete') =>
    new Promise<boolean>((resolve) => setState({ title, message, confirmLabel, resolve }));
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = (
    <Modal
      open={Boolean(state)}
      onClose={() => close(false)}
      title={state?.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => close(true)}>
            {state?.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-stone-600 dark:text-stone-300">{state?.message}</div>
    </Modal>
  );
  return { confirm, dialog };
}

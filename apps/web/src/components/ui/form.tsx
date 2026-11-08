import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Full width unless the caller sets its own width (avoids `w-full` fighting `w-44`). */
const width = (className?: string) => (/(^|\s)(w-|min-w-|flex-1|size-)/.test(className ?? '') ? '' : 'w-full');

const control =
  'rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900 shadow-sm shadow-stone-900/[0.03] placeholder:text-stone-400 ' +
  'transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:bg-stone-50 disabled:text-stone-500 ' +
  'dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:disabled:bg-stone-800';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(control, width(className), 'h-10', invalid && 'border-red-500 focus:border-red-500 focus:ring-red-500/25', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(control, width(className), 'py-2.5 leading-relaxed', invalid && 'border-red-500', className)} {...rest} />;
});

export interface Option {
  value: string;
  label: string;
}

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string; invalid?: boolean }
>(function Select({ className, options, placeholder, invalid, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(control, width(className), 'h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9', selectArrow, invalid && 'border-red-500', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
});

const selectArrow =
  "bg-[url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23898781' stroke-width='2'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='m6 9 6 6 6-6'/%3e%3c/svg%3e\")]";

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  required,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  required?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-stone-700 dark:text-stone-300">
          {label}
          {required && <span className="ml-0.5 text-brand-600">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, description }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 rounded border-stone-300 accent-brand-600"
      />
      <span>
        <span className="font-medium text-stone-800 dark:text-stone-200">{label}</span>
        {description && <span className="block text-xs text-stone-500 dark:text-stone-400">{description}</span>}
      </span>
    </label>
  );
}

/** Pill-style single choice (payment mode, status...). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; tone?: 'good' | 'warn' | 'bad' }[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex rounded-xl border border-stone-200 bg-stone-100/70 p-0.5 dark:border-stone-700 dark:bg-stone-800/60', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[10px] font-medium transition-all',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active
                ? cn(
                    'bg-white shadow-sm dark:bg-stone-950',
                    o.tone === 'good' && 'text-[var(--good-text)]',
                    o.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
                    o.tone === 'bad' && 'text-[var(--critical)]',
                    !o.tone && 'text-stone-900 dark:text-white',
                  )
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

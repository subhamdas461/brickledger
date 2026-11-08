import { CURRENCIES } from '@brickledger/shared/web';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import { Checkbox, Field, Input, Segmented, Select, Textarea, type Option } from './ui/form';

type Values = Record<string, any>;

interface Base {
  name: string;
  label: string;
  hint?: string;
  span?: 1 | 2;
  required?: boolean;
  /** Hide the field unless this returns true. Hidden fields are not submitted. */
  visible?: (values: Values) => boolean;
}

export type FieldDef =
  | (Base & { type: 'text' | 'email' | 'tel' | 'date'; placeholder?: string; autoFocus?: boolean })
  | (Base & { type: 'textarea'; placeholder?: string; rows?: number })
  | (Base & { type: 'number' | 'money'; placeholder?: string; step?: number; min?: number; max?: number; suffix?: string })
  | (Base & { type: 'select'; options: Option[]; placeholder?: string })
  | (Base & { type: 'segmented'; options: { value: string; label: string }[] })
  | (Base & { type: 'checkbox'; description?: string })
  | { type: 'section'; name: string; label: string; visible?: (values: Values) => boolean }
  | { type: 'custom'; name: string; span?: 1 | 2; render: (values: Values, set: (name: string, v: unknown) => void) => ReactNode; visible?: (values: Values) => boolean };

function toInput(field: FieldDef, value: unknown): unknown {
  if (field.type === 'checkbox') return Boolean(value);
  if (value === null || value === undefined) return '';
  return field.type === 'number' || field.type === 'money' ? String(value) : value;
}

function toPayload(fields: FieldDef[], values: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.type === 'section' || f.type === 'custom') continue;
    if (f.visible && !f.visible(values)) continue;
    const v = values[f.name];
    if (f.type === 'checkbox') out[f.name] = Boolean(v);
    else if (f.type === 'number' || f.type === 'money') out[f.name] = v === '' || v === undefined || v === null ? null : Number(v);
    else if (f.type === 'select') out[f.name] = v === '' || v === undefined ? null : v;
    else out[f.name] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : (v ?? null);
  }
  return out;
}

export function useEntityForm(fields: FieldDef[], initial: Values) {
  const [values, setValues] = useState<Values>(() => {
    const v: Values = { ...initial };
    for (const f of fields) if (f.type !== 'section' && f.type !== 'custom') v[f.name] = toInput(f, initial[f.name]);
    return v;
  });
  const set = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }));
  return { values, set, setValues };
}

export function EntityForm({
  fields,
  initial,
  onSubmit,
  formId,
  currency = 'INR',
  extraValues,
}: {
  fields: FieldDef[];
  initial: Values;
  onSubmit: (payload: Values, values: Values) => Promise<unknown>;
  formId: string;
  currency?: string;
  /** Values not represented by fields (custom renderers) merged into the payload. */
  extraValues?: (values: Values) => Values;
}) {
  const { values, set } = useEntityForm(fields, initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
  const baseId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      await onSubmit({ ...toPayload(fields, values), ...(extraValues?.(values) ?? {}) }, values);
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors();
        setErrors(fe);
        if (!Object.keys(fe).length || err.code !== 'VALIDATION_ERROR') setFormError(err.message);
      } else setFormError(errorMessage(err));
    }
  }

  return (
    <form id={formId} onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      {formError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 sm:col-span-2 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{formError}</div>}
      {fields.map((f) => {
        if (f.visible && !f.visible(values)) return null;
        if (f.type === 'section') {
          return (
            <div key={f.name} className="pt-2 sm:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{f.label}</p>
            </div>
          );
        }
        if (f.type === 'custom') return <div key={f.name} className={cn(f.span !== 1 && 'sm:col-span-2')}>{f.render(values, set)}</div>;
        const id = `${baseId}-${f.name}`;
        const err = errors[f.name];
        const span = f.span === 2 || f.type === 'textarea' || f.type === 'segmented' ? 'sm:col-span-2' : '';
        if (f.type === 'checkbox') {
          return (
            <div key={f.name} className={span}>
              <Checkbox label={f.label} description={f.description} checked={Boolean(values[f.name])} onChange={(v) => set(f.name, v)} />
            </div>
          );
        }
        return (
          <Field key={f.name} label={f.label} hint={f.hint} error={err} htmlFor={id} required={f.required} className={span}>
            {f.type === 'textarea' ? (
              <Textarea id={id} rows={f.rows ?? 3} placeholder={f.placeholder} value={values[f.name]} invalid={Boolean(err)} onChange={(e) => set(f.name, e.target.value)} />
            ) : f.type === 'select' ? (
              <Select id={id} options={f.options} placeholder={f.placeholder ?? (f.required ? undefined : '—')} value={values[f.name] ?? ''} invalid={Boolean(err)} onChange={(e) => set(f.name, e.target.value)} />
            ) : f.type === 'segmented' ? (
              <Segmented value={values[f.name]} onChange={(v) => set(f.name, v)} options={f.options} aria-label={f.label} className="flex-wrap" />
            ) : f.type === 'money' || f.type === 'number' ? (
              <div className="relative">
                {f.type === 'money' && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400">{symbol}</span>}
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  step={f.step ?? (f.type === 'money' ? 0.01 : 'any')}
                  min={f.min}
                  max={f.max}
                  placeholder={f.placeholder}
                  value={values[f.name]}
                  invalid={Boolean(err)}
                  onChange={(e) => set(f.name, e.target.value)}
                  className={cn('tabular', f.type === 'money' && (symbol.length > 1 ? 'pl-12' : 'pl-8'), f.suffix && 'pr-14')}
                />
                {f.suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-stone-400">{f.suffix}</span>}
              </div>
            ) : (
              <Input
                id={id}
                type={f.type}
                autoFocus={'autoFocus' in f ? f.autoFocus : undefined}
                placeholder={'placeholder' in f ? f.placeholder : undefined}
                value={values[f.name]}
                invalid={Boolean(err)}
                onChange={(e) => set(f.name, e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </form>
  );
}

/** Modal + EntityForm with standard footer (Cancel / Save, optional Delete). */
export function FormModal({
  open,
  onClose,
  title,
  description,
  fields,
  initial,
  onSubmit,
  submitLabel = 'Save',
  onDelete,
  currency,
  size = 'md',
  children,
  extraValues,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  fields: FieldDef[];
  initial: Values;
  onSubmit: (payload: Values, values: Values) => Promise<unknown>;
  submitLabel?: string;
  onDelete?: () => Promise<unknown> | void;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
  extraValues?: (values: Values) => Values;
}) {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10" onClick={() => void onDelete()}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {open && (
        <EntityForm
          formId={formId}
          fields={fields}
          initial={initial}
          currency={currency}
          extraValues={extraValues}
          onSubmit={async (payload, values) => {
            setBusy(true);
            try {
              await onSubmit(payload, values);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {children}
    </Modal>
  );
}

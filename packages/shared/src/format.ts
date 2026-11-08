import { currencyLocale } from './constants';

const formatters = new Map<string, Intl.NumberFormat>();

function cached(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = formatters.get(key);
  if (!f) {
    f = make();
    formatters.set(key, f);
  }
  return f;
}

/** ₹12,34,567 (INR uses lakh grouping). Shows paise/cents only when present. */
export function formatMoney(amount: number | null | undefined, currency = 'INR'): string {
  const value = Number(amount ?? 0);
  const hasFraction = Math.round(value * 100) % 100 !== 0;
  const locale = currencyLocale(currency);
  return cached(`m:${currency}:${hasFraction}`, () =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0,
    }),
  ).format(value);
}

/** ₹12.3L / ₹1.2Cr for INR, $12.3K / $1.2M elsewhere. */
export function formatMoneyCompact(amount: number | null | undefined, currency = 'INR'): string {
  const value = Number(amount ?? 0);
  if (Math.abs(value) < 10_000) return formatMoney(Math.round(value), currency);
  const locale = currencyLocale(currency);
  return cached(`c:${currency}`, () =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }),
  ).format(value);
}

export function formatNumber(value: number | null | undefined, maxFractionDigits = 2): string {
  return cached(`n:${maxFractionDigits}`, () =>
    new Intl.NumberFormat('en-IN', { maximumFractionDigits: maxFractionDigits }),
  ).format(Number(value ?? 0));
}

export function formatPercent(value: number, maxFractionDigits = 0): string {
  return `${formatNumber(value, maxFractionDigits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-03-09' -> '9 Mar 2026' (timezone-safe: parses the date parts directly). */
export function formatDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return opts.year === false ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/** '2026-03' -> "Mar '26" (the apostrophe keeps it from reading as the 26th of March) */
export function formatMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!y || !m) return yyyyMm;
  return `${MONTHS[m - 1]} '${String(y).slice(2)}`;
}

/** Local calendar date as yyyy-mm-dd. */
export function todayIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Wage earned for one attendance record. Overtime is paid at the hourly rate of an 8-hour day. */
export function wageFor(status: string, overtimeHours: number, dailyWage: number): number {
  const base = status === 'present' ? dailyWage : status === 'half' ? dailyWage / 2 : 0;
  return base + (overtimeHours || 0) * (dailyWage / 8);
}

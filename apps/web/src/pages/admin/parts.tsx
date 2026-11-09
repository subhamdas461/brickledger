import { formatDate, formatNumber, type AdminPoint, type AdminRank } from '@brickledger/shared/web';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ColumnChart, Meter } from '../../components/charts';
import { Button } from '../../components/ui/button';
import { Segmented } from '../../components/ui/form';
import { Card, CardHeader } from '../../components/ui/surface';
import { api } from '../../lib/api';

export function useAdmin<T>(path: string, query?: Record<string, string | number | undefined>) {
  return useQuery({ queryKey: ['admin', path, query], queryFn: () => api<T>(`/admin${path}`, { query }), placeholderData: keepPreviousData });
}

export const count = (n: number | null | undefined) => formatNumber(n ?? 0, 0);

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 hours ago" for recent times, then the date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return 'Just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day');
  return formatDate(iso);
}

export function duration(seconds: number): string {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** A titled card with its content lined up under the title. */
export function Panel({ title, subtitle, action, className, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <div className="px-5 pb-5">{children}</div>
    </Card>
  );
}

/** Columns per day. One measure per chart, with a table view for reading exact numbers. */
export function DayChart({ title, subtitle, data, unit }: { title: string; subtitle?: string; data: AdminPoint[]; unit: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const empty = data.every((d) => d.value === 0);
  const label = (day: string) => formatDate(day, { year: false });
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      action={<Segmented<'chart' | 'table'> value={view} onChange={setView} aria-label={`${title}: view as`} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
    >
      <div className="mt-4">
        {empty ? (
          <p className="py-12 text-center text-sm text-stone-500">Nothing recorded yet.</p>
        ) : view === 'chart' ? (
          <ColumnChart
            ariaLabel={title}
            height={190}
            format={(n) => `${count(n)} ${unit}`}
            formatTick={(n) => count(n)}
            data={data.map((d) => ({ key: d.day, label: label(d.day), value: d.value }))}
          />
        ) : (
          <div className="scroll-thin max-h-56 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th className="py-1.5 font-medium">Day</th>
                  <th className="py-1.5 text-right font-medium">{unit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {[...data].reverse().map((d) => (
                  <tr key={d.day}>
                    <td className="py-1.5 text-stone-600 dark:text-stone-300">{label(d.day)}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums text-stone-900 dark:text-stone-100">{count(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** A ranked list with thin bars: values are always printed, the bar only shows the proportion. */
export function RankList({ title, subtitle, rows, emptyText, nameOf }: { title: string; subtitle?: string; rows: AdminRank[]; emptyText?: string; nameOf?: (name: string) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Panel title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-500">{emptyText ?? 'Nothing recorded yet.'}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-stone-700 dark:text-stone-200">{nameOf ? nameOf(r.name) : r.name}</span>
                <span className="font-medium tabular-nums text-stone-900 dark:text-stone-100">{count(r.value)}</span>
              </div>
              <Meter value={r.value} max={max} kind="progress" thin className="mt-1" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const end = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-3 text-sm text-stone-500 dark:border-stone-800">
      <span>
        {count(offset + 1)}-{count(end)} of {count(total)}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} icon={<ChevronLeft className="size-4" />}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={end >= total} onClick={() => onChange(offset + limit)} icon={<ChevronRight className="size-4" />}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 mb-3 text-sm font-semibold tracking-wide text-stone-500 uppercase">{children}</h2>;
}

const ACTIONS: Record<string, string> = {
  'user.ban': 'Banned account',
  'user.unban': 'Unbanned account',
  'user.sign_out': 'Signed out everywhere',
  'user.reset_link': 'Created password reset link',
  'user.delete': 'Deleted account',
  'user.update': 'Edited account',
  'users.export': 'Exported accounts',
  'workspace.plan': 'Changed plan',
  'workspace.extend_trial': 'Extended trial',
};

export const actionLabel = (action: string) => ACTIONS[action] ?? action;

/** One readable line for what an audit entry's details hold. */
export function detailLine(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  if (typeof details.reason === 'string') return `Reason: ${details.reason}`;
  if (typeof details.to === 'string' && typeof details.from === 'string') return `${details.from} → ${details.to}`;
  if (typeof details.days === 'number') return `+${details.days} days`;
  if (typeof details.sessions === 'number') return `${details.sessions} session${details.sessions === 1 ? '' : 's'}`;
  if (details.to && typeof details.to === 'object') return `Changed ${Object.keys(details.to).join(', ') || 'nothing'}`;
  if (typeof details.search === 'string') return `Search: ${details.search}`;
  if (typeof details.name === 'string') return details.name;
  return null;
}

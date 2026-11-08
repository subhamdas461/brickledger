import { PhaseStatuses, daysBetween, formatDate, todayIso, type Phase } from '@brickledger/shared/web';
import { CalendarRange, Plus } from 'lucide-react';
import { useState } from 'react';
import { FormModal } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { useList, useResourceMutations } from '../../lib/queries';
import { useCanDelete } from './common';

const tone = { not_started: 'neutral', in_progress: 'blue', on_hold: 'amber', completed: 'green' } as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function Schedule() {
  const { pid, canEdit, project } = useProjectCtx();
  const phases = useList(pid, 'phases', { limit: 1000 });
  const { create, update, remove } = useResourceMutations(pid, 'phases');
  const [editing, setEditing] = useState<Phase | 'new' | null>(null);
  const { confirm, dialog } = useConfirm();
  const toast = useToast();
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);
  if (!phases.data) return <Spinner />;

  const items = phases.data.items;
  const today = todayIso();
  const dates = items.flatMap((p) => [p.plannedStart, p.plannedEnd, p.actualStart, p.actualEnd]).filter(Boolean) as string[];
  if (project.startDate) dates.push(project.startDate);
  if (project.targetEndDate) dates.push(project.targetEndDate);
  dates.push(today);
  dates.sort();
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  const span = Math.max(1, daysBetween(start, end));
  const pct = (d: string) => (daysBetween(start, d) / span) * 100;
  const months: { label: string; left: number }[] = [];
  {
    const [y, m] = start.split('-').map(Number) as [number, number];
    for (let i = 0; i < 36; i++) {
      const d = new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 10);
      if (d > end) break;
      if (d >= start) months.push({ label: `${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(5, 7) === '01' ? ` ${d.slice(2, 4)}` : ''}`, left: pct(d) });
    }
  }
  const overall = items.length ? Math.round(items.reduce((s, p) => s + p.progress, 0) / items.length) : 0;

  return (
    <>
      {dialog}
      <PageHeader
        title="Schedule"
        description={`${items.filter((p) => p.status === 'completed').length} of ${items.length} phases complete · ${overall}% overall`}
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add phase
            </Button>
          )
        }
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarRange />} title="No phases yet" description="Break the build into phases to plan dates and track progress." action={canEdit ? <Button onClick={() => setEditing('new')}>Add phase</Button> : undefined} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[260px_1fr] border-b border-stone-100 dark:border-stone-800">
              <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Phase</div>
              <div className="relative h-9">
                {months.map((m) => (
                  <span key={m.left} className="absolute top-2.5 -translate-x-1/2 text-[11px] text-[var(--ink-muted)]" style={{ left: `${m.left}%` }}>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
            {items.map((p) => {
              const s = p.actualStart ?? p.plannedStart;
              const e = p.actualEnd ?? p.plannedEnd;
              const late = p.status !== 'completed' && p.plannedEnd && p.plannedEnd < today;
              return (
                <button
                  key={p.id}
                  onClick={() => canEdit && setEditing(p)}
                  className="grid w-full grid-cols-[260px_1fr] items-center border-b border-stone-50 text-left transition-colors last:border-0 hover:bg-stone-50 dark:border-stone-800/60 dark:hover:bg-stone-800/30"
                >
                  <div className="px-4 py-3">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
                      <Badge tone={tone[p.status as keyof typeof tone] ?? 'neutral'}>{PhaseStatuses.label(p.status)}</Badge>
                      {p.progress}%{late && <span className="font-medium text-[var(--critical)]">· Late</span>}
                    </p>
                  </div>
                  <div className="relative h-14">
                    {months.map((m) => (
                      <span key={m.left} className="absolute inset-y-0 w-px bg-[var(--grid)]" style={{ left: `${m.left}%` }} />
                    ))}
                    <span className="absolute inset-y-0 z-10 w-0.5 bg-brand-500" style={{ left: `${pct(today)}%` }} title="Today" />
                    {s && e && (
                      <div
                        className="absolute top-1/2 h-3.5 -translate-y-1/2 overflow-hidden rounded-[4px]"
                        style={{ left: `${pct(s)}%`, width: `${Math.max(0.8, pct(e) - pct(s))}%`, background: 'var(--meter-track)' }}
                        title={`${formatDate(s)} – ${formatDate(e)}`}
                      >
                        <div className="h-full rounded-[4px]" style={{ width: `${p.progress}%`, background: late ? 'var(--critical)' : 'var(--series-1)' }} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-5 border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500 dark:border-stone-800">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-[3px] bg-[var(--meter-track)]" />Planned span</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-[3px] bg-[var(--series-1)]" />Progress</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-brand-500" />Today</span>
          </div>
        </Card>
      )}
      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={existing ? existing.name : 'Add phase'}
        fields={[
          { name: 'name', label: 'Phase name', type: 'text', required: true, span: 2 },
          { name: 'status', label: 'Status', type: 'select', options: PhaseStatuses.list, required: true },
          { name: 'progress', label: 'Progress', type: 'number', min: 0, max: 100, step: 5, suffix: '%' },
          { name: 'plannedStart', label: 'Planned start', type: 'date' },
          { name: 'plannedEnd', label: 'Planned end', type: 'date' },
          { name: 'actualStart', label: 'Actual start', type: 'date' },
          { name: 'actualEnd', label: 'Actual end', type: 'date' },
          { name: 'description', label: 'Notes', type: 'textarea', rows: 2 },
        ]}
        initial={existing ?? { status: 'not_started', progress: 0 }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm(`Delete “${existing.name}”?`, 'Expenses and tasks linked to it keep their data.'))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (p) => {
          const body = { ...p, progress: Math.max(0, Math.min(100, Math.round(p.progress ?? 0))) };
          if (existing) await update.mutateAsync({ id: existing.id, ...body });
          else await create.mutateAsync({ ...body, sortOrder: (items.at(-1)?.sortOrder ?? 0) + 1 });
          setEditing(null);
        }}
      />
    </>
  );
}

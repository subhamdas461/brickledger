import { Priorities, TaskStatuses, formatDate, todayIso, type Task } from '@brickledger/shared/web';
import { CalendarDays, Plus, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FormModal } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Input } from '../../components/ui/form';
import { Badge, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useList, useLookups, useResourceMutations } from '../../lib/queries';
import { useCanDelete } from './common';

const priorityTone = { low: 'neutral', medium: 'blue', high: 'amber', urgent: 'red' } as const;
const COLUMNS = TaskStatuses.values;

export function Tasks() {
  const { pid, canEdit } = useProjectCtx();
  const tasks = useList(pid, 'tasks', { limit: 1000 });
  const lookups = useLookups(pid);
  const { create, update, remove } = useResourceMutations(pid, 'tasks');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [quick, setQuick] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);
  if (!tasks.data) return <Spinner />;

  const today = todayIso();
  const byStatus = new Map<string, Task[]>(COLUMNS.map((c) => [c, []]));
  for (const t of tasks.data.items) byStatus.get(t.status)?.push(t);
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
  for (const list of byStatus.values()) list.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));

  async function move(id: string, status: string) {
    const task = tasks.data!.items.find((t) => t.id === id);
    if (!task || task.status === status) return;
    try {
      await update.mutateAsync({ id, status });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function quickAdd(e: FormEvent) {
    e.preventDefault();
    if (!quick.trim()) return;
    await create.mutateAsync({ title: quick.trim(), status: 'todo' }).catch((err) => toast.error(errorMessage(err)));
    setQuick('');
  }

  return (
    <>
      {dialog}
      <PageHeader
        title="Tasks"
        description="Drag cards between columns to update their status."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              New task
            </Button>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = byStatus.get(col) ?? [];
          return (
            <div
              key={col}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragId) void move(dragId, col);
                setDragId(null);
              }}
              className={cn('flex min-h-64 flex-col rounded-2xl bg-stone-100/70 p-2.5 transition-colors dark:bg-stone-900/60', over === col && 'bg-brand-50 ring-2 ring-brand-300 dark:bg-brand-500/10')}
            >
              <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">{TaskStatuses.label(col)}</p>
                <span className="rounded-full bg-white px-2 text-xs font-medium text-stone-500 dark:bg-stone-800">{list.length}</span>
              </div>
              {col === 'todo' && canEdit && (
                <form onSubmit={quickAdd} className="mb-2">
                  <Input placeholder="+ Quick add task" className="h-9 bg-white/80" value={quick} onChange={(e) => setQuick(e.target.value)} />
                </form>
              )}
              <div className="flex flex-col gap-2">
                {list.map((t) => {
                  const overdue = t.status !== 'done' && t.dueDate && t.dueDate < today;
                  return (
                    <article
                      key={t.id}
                      draggable={canEdit}
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setEditing(t)}
                      className={cn(
                        'cursor-pointer rounded-xl border border-stone-200 bg-white p-3 shadow-sm transition hover:border-stone-300 hover:shadow dark:border-stone-700 dark:bg-stone-900',
                        dragId === t.id && 'opacity-50',
                      )}
                    >
                      <p className={cn('text-sm font-medium', t.status === 'done' && 'text-stone-400 line-through')}>{t.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                        <Badge tone={priorityTone[t.priority as keyof typeof priorityTone] ?? 'neutral'}>{Priorities.label(t.priority)}</Badge>
                        {t.dueDate && (
                          <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-[var(--critical)]')}>
                            <CalendarDays className="size-3" />
                            {overdue ? 'Overdue · ' : ''}
                            {formatDate(t.dueDate, { year: false })}
                          </span>
                        )}
                        {t.assignee && (
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="size-3" />
                            {t.assignee}
                          </span>
                        )}
                      </div>
                      {t.phaseId && <p className="mt-1.5 truncate text-[11px] text-stone-400">{lookups.names.phases.get(t.phaseId)}</p>}
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={existing ? 'Edit task' : 'New task'}
        fields={[
          { name: 'title', label: 'Task', type: 'text', required: true, span: 2 },
          { name: 'status', label: 'Status', type: 'select', options: TaskStatuses.list, required: true },
          { name: 'priority', label: 'Priority', type: 'select', options: Priorities.list, required: true },
          { name: 'assignee', label: 'Assigned to', type: 'text', placeholder: 'Name' },
          { name: 'dueDate', label: 'Due date', type: 'date' },
          { name: 'phaseId', label: 'Phase', type: 'select', options: lookups.options.phases, span: 2 },
          { name: 'description', label: 'Details', type: 'textarea' },
        ]}
        initial={existing ?? { status: 'todo', priority: 'medium' }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm('Delete this task?', existing.title))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (p) => {
          if (existing) await update.mutateAsync({ id: existing.id, ...p });
          else await create.mutateAsync(p);
          setEditing(null);
        }}
      />
    </>
  );
}

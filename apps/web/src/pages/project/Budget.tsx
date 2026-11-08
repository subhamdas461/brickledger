import type { Category } from '@brickledger/shared/web';
import { useMutation } from '@tanstack/react-query';
import { Download, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Meter } from '../../components/charts';
import { FormModal } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Card, PageHeader, Spinner, Stat } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { api, downloadFile, errorMessage } from '../../lib/api';
import { useDashboard, useList, useRefreshProject, useResourceMutations } from '../../lib/queries';
import { CategoryIcon, DataTable, useMoney } from './common';

export function Budget() {
  const { pid, project, isManager, currency } = useProjectCtx();
  const { money } = useMoney();
  const dash = useDashboard(pid);
  const cats = useList(pid, 'categories', { limit: 1000 });
  const { create, update, remove } = useResourceMutations(pid, 'categories');
  const refresh = useRefreshProject(pid);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [editBudget, setEditBudget] = useState(false);
  const saveBudget = useMutation({
    mutationFn: (totalBudget: number) => api(`/projects/${pid}`, { method: 'PATCH', body: { totalBudget } }),
    onSuccess: refresh,
  });

  if (!dash.data || !cats.data) return <Spinner />;
  const t = dash.data.totals;
  const planned = cats.data.items.reduce((s, c) => s + c.plannedAmount, 0);
  const unallocated = project.totalBudget - planned;
  const byId = new Map(cats.data.items.map((c) => [c.id, c]));
  const rows = dash.data.categories;
  const existing = editing && editing !== 'new' ? editing : null;

  return (
    <>
      {dialog}
      <PageHeader
        title="Budget"
        description="Planned vs committed spend for every construction head."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadFile(`/projects/${pid}/export/budget.csv`, 'budget.csv')}>
              CSV
            </Button>
            {isManager && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Add category
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-stone-500">Total budget</p>
            {isManager && (
              <button aria-label="Edit total budget" className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800" onClick={() => setEditBudget(true)}>
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xl font-semibold tracking-tight">{money(project.totalBudget)}</p>
          <p className="mt-0.5 text-xs text-stone-500">{Math.round((t.committed / Math.max(1, t.budget)) * 100)}% committed</p>
        </Card>
        <Stat label="Committed" value={money(t.committed)} note={`${money(t.spent)} paid · ${money(t.due)} due`} />
        <Stat label="Remaining" value={money(t.remaining)} noteTone={t.remaining < 0 ? 'bad' : 'muted'} note={t.remaining < 0 ? 'Over budget' : 'Budget minus committed'} />
        <Stat
          label="Unallocated"
          value={money(unallocated)}
          note={unallocated === 0 ? 'Fully allocated to categories' : unallocated > 0 ? 'Not yet assigned to a category' : 'Categories exceed the total budget'}
          noteTone={unallocated < 0 ? 'bad' : 'muted'}
        />
      </div>
      <Card>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id ?? 'uncategorised'}
          onRowClick={isManager ? (r) => r.id && setEditing(byId.get(r.id) ?? null) : undefined}
          columns={[
            {
              key: 'name',
              header: 'Category',
              cell: (r) => (
                <span className="flex items-center gap-2.5 font-medium">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800">
                    <CategoryIcon icon={r.icon} />
                  </span>
                  {r.name}
                </span>
              ),
            },
            { key: 'planned', header: 'Planned', align: 'right', cell: (r) => money(r.planned) },
            { key: 'spent', header: 'Paid', align: 'right', cell: (r) => money(r.spent) },
            { key: 'due', header: 'Due', align: 'right', className: 'hidden sm:table-cell', cell: (r) => (r.due ? money(r.due) : '—') },
            {
              key: 'left',
              header: 'Remaining',
              align: 'right',
              className: 'hidden md:table-cell',
              cell: (r) => <span className={r.planned - r.spent - r.due < 0 ? 'font-medium text-[var(--critical)]' : ''}>{money(r.planned - r.spent - r.due)}</span>,
            },
            {
              key: 'used',
              header: 'Used',
              className: 'w-44',
              cell: (r) => (
                <div className="flex items-center gap-2">
                  <Meter value={r.spent + r.due} max={r.planned} />
                  <span className="tabular w-10 shrink-0 text-right text-xs text-stone-500">{r.planned > 0 ? `${Math.round(((r.spent + r.due) / r.planned) * 100)}%` : '—'}</span>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={existing ? 'Edit category' : 'New budget category'}
        currency={currency}
        size="sm"
        fields={[
          { name: 'name', label: 'Name', type: 'text', required: true, span: 2 },
          { name: 'plannedAmount', label: 'Planned amount', type: 'money', span: 2 },
        ]}
        initial={existing ?? { plannedAmount: 0, sortOrder: (cats.data.items.at(-1)?.sortOrder ?? 0) + 1 }}
        onDelete={
          existing
            ? async () => {
                if (!(await confirm(`Delete “${existing.name}”?`, 'Expenses in this category become uncategorised. Nothing else is deleted.'))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (payload) => {
          const body = { ...payload, plannedAmount: payload.plannedAmount ?? 0 };
          if (existing) await update.mutateAsync({ id: existing.id, ...body });
          else await create.mutateAsync({ ...body, sortOrder: (cats.data!.items.at(-1)?.sortOrder ?? 0) + 1 });
          setEditing(null);
        }}
      />
      <FormModal
        open={editBudget}
        onClose={() => setEditBudget(false)}
        title="Total budget"
        size="sm"
        currency={currency}
        fields={[{ name: 'totalBudget', label: 'Total budget', type: 'money', span: 2, hint: 'Category amounts are not changed automatically.' }]}
        initial={{ totalBudget: project.totalBudget }}
        onSubmit={async (p) => {
          await saveBudget.mutateAsync(Number(p.totalBudget ?? 0));
          setEditBudget(false);
          toast.success('Budget updated');
        }}
      />
    </>
  );
}

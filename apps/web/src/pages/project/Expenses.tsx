import { ExpenseStatuses, PaymentModes, formatDate, todayIso, type Expense } from '@brickledger/shared/web';
import { Download, Plus, Receipt, Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { FormModal, type FieldDef } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Input, Select } from '../../components/ui/form';
import { Badge, Card, EmptyState, PageHeader } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { downloadFile, errorMessage } from '../../lib/api';
import { useList, useLookups, useResourceMutations, useUpload } from '../../lib/queries';
import { Attachments, DataTable, FilterBar, PendingFilesPicker, uploadFile, useCanDelete, useMoney } from './common';

export function ExpenseFormModal({ expense, onClose, defaults }: { expense: Expense | 'new' | null; onClose: () => void; defaults?: Partial<Expense> }) {
  const { pid, currency, canEdit, project } = useProjectCtx();
  const lookups = useLookups(pid);
  const { create, update, remove } = useResourceMutations(pid, 'expenses');
  const upload = useUpload(pid);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [pending, setPending] = useState<File[]>([]);
  const existing = expense && expense !== 'new' ? expense : null;

  const fields: FieldDef[] = [
    { name: 'amount', label: 'Amount', type: 'money', required: true, placeholder: '0' },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'title', label: 'What was it for?', type: 'text', required: true, span: 2, placeholder: 'e.g. Cement 50 bags, mason running bill…' },
    { name: 'categoryId', label: 'Budget category', type: 'select', options: lookups.options.categories },
    { name: 'vendorId', label: 'Paid to (vendor)', type: 'select', options: lookups.options.vendors },
    {
      name: 'status',
      label: 'Status',
      type: 'segmented',
      options: [
        { value: 'paid', label: 'Paid' },
        { value: 'due', label: 'Bill due (unpaid)' },
      ],
    },
    { name: 'dueDate', label: 'Due date', type: 'date', visible: (v) => v.status === 'due' },
    { name: 'paymentMode', label: 'Payment mode', type: 'select', options: PaymentModes.list, required: true },
    { name: 'phaseId', label: 'Construction phase', type: 'select', options: lookups.options.phases },
    { type: 'section', name: 'more', label: 'More details (optional)' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: '50' },
    { name: 'unit', label: 'Unit', type: 'text', placeholder: 'bags, kg, cft, nos…' },
    { name: 'rate', label: 'Rate per unit', type: 'money' },
    { name: 'taxAmount', label: 'Tax / GST included', type: 'money' },
    { name: 'reference', label: 'Bill / cheque / UTR no.', type: 'text' },
    { name: 'paidBy', label: 'Paid by', type: 'text', placeholder: 'Self, site supervisor…' },
    { name: 'workerId', label: 'Worker (wage payment)', type: 'select', options: lookups.options.workers },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ...(!existing && canEdit ? [{ type: 'custom' as const, name: 'files', render: () => <PendingFilesPicker files={pending} onChange={setPending} /> }] : []),
  ];

  const canDelete = useCanDelete(existing);
  return (
    <>
      {dialog}
      <FormModal
        open={Boolean(expense)}
        onClose={() => {
          setPending([]);
          onClose();
        }}
        title={existing ? 'Edit expense' : 'Add expense'}
        description={project.name}
        currency={currency}
        fields={fields}
        initial={existing ?? { date: todayIso(), status: 'paid', paymentMode: 'upi', ...defaults }}
        submitLabel={existing ? 'Save changes' : 'Add expense'}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm('Delete this expense?', `${existing.title} will be removed from all totals.`))) return;
                try {
                  await remove.mutateAsync(existing.id);
                  toast.success('Expense deleted');
                  onClose();
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }
            : undefined
        }
        onSubmit={async (payload) => {
          if (existing) {
            await update.mutateAsync({ id: existing.id, ...payload });
            toast.success('Expense updated');
          } else {
            const created = await create.mutateAsync(payload);
            for (const f of pending) {
              await uploadFile(upload, f, { entityType: 'expense', entityId: created.id, category: f.type.startsWith('image/') ? 'receipt' : 'invoice' }).catch((err) => toast.error(errorMessage(err)));
            }
            setPending([]);
            toast.success('Expense added');
          }
          onClose();
        }}
      >
        {existing && <Attachments entityType="expense" entityId={existing.id} label="Receipts & bills" />}
      </FormModal>
    </>
  );
}

const PAGE = 50;

export function Expenses() {
  const { pid, canEdit } = useProjectCtx();
  const { money } = useMoney();
  const [params] = useSearchParams();
  const lookups = useLookups(pid);
  const [filters, setFilters] = useState({ q: '', categoryId: '', vendorId: '', status: params.get('status') ?? '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const list = useList(pid, 'expenses', { ...filters, limit: PAGE, offset: page * PAGE });
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  };
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Every bill and payment for this build."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadFile(`/projects/${pid}/export/expenses.csv`, 'expenses.csv')}>
              CSV
            </Button>
            {canEdit && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Add expense
              </Button>
            )}
          </>
        }
      />
      <FilterBar>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search title, reference, notes…" className="pl-9" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Select className="w-44" placeholder="All categories" options={lookups.options.categories} value={filters.categoryId} onChange={(e) => set('categoryId', e.target.value)} />
        <Select className="w-44" placeholder="All vendors" options={lookups.options.vendors} value={filters.vendorId} onChange={(e) => set('vendorId', e.target.value)} />
        <Select className="w-32" placeholder="Any status" options={ExpenseStatuses.list} value={filters.status} onChange={(e) => set('status', e.target.value)} />
        <Input type="date" aria-label="From date" className="w-40" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        <Input type="date" aria-label="To date" className="w-40" value={filters.to} onChange={(e) => set('to', e.target.value)} />
      </FilterBar>

      <Card className={list.isFetching && list.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 text-sm dark:border-stone-800">
          <span className="text-stone-500">
            {total} expense{total === 1 ? '' : 's'}
            {filtered && ' matching filters'}
          </span>
          <span className="font-semibold">Total {money(list.data?.sum ?? 0)}</span>
        </div>
        <DataTable
          rows={items}
          rowKey={(r) => r.id}
          onRowClick={(r) => setEditing(r)}
          empty={
            <EmptyState
              icon={<Receipt />}
              title={filtered ? 'No expenses match' : 'No expenses yet'}
              description={filtered ? 'Try clearing a filter.' : 'Record your first bill or payment - it updates the budget and reports instantly.'}
              action={canEdit && !filtered ? <Button onClick={() => setEditing('new')}>Add expense</Button> : undefined}
            />
          }
          columns={[
            { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap text-stone-500">{formatDate(r.date)}</span> },
            {
              key: 'title',
              header: 'Description',
              cell: (r) => (
                <div className="min-w-48">
                  <p className="font-medium text-stone-900 dark:text-stone-100">{r.title}</p>
                  <p className="text-xs text-stone-500">{[lookups.names.vendors.get(r.vendorId ?? ''), lookups.names.workers.get(r.workerId ?? ''), r.reference].filter(Boolean).join(' · ')}</p>
                </div>
              ),
            },
            { key: 'cat', header: 'Category', className: 'hidden md:table-cell', cell: (r) => <span className="text-stone-600 dark:text-stone-300">{lookups.names.categories.get(r.categoryId ?? '') ?? '—'}</span> },
            { key: 'mode', header: 'Mode', className: 'hidden lg:table-cell', cell: (r) => <span className="text-stone-500">{PaymentModes.label(r.paymentMode)}</span> },
            {
              key: 'status',
              header: 'Status',
              cell: (r) =>
                r.status === 'due' ? (
                  <Badge tone={r.dueDate && r.dueDate < new Date().toISOString().slice(0, 10) ? 'red' : 'amber'}>{r.dueDate ? `Due ${formatDate(r.dueDate, { year: false })}` : 'Due'}</Badge>
                ) : (
                  <Badge tone="green">Paid</Badge>
                ),
            },
            { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="font-semibold">{money(r.amount)}</span> },
          ]}
        />
        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-sm dark:border-stone-800">
            <span className="text-stone-500">
              {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
      <ExpenseFormModal key={editing === 'new' ? 'new' : editing?.id ?? 'none'} expense={editing} onClose={() => setEditing(null)} />
    </>
  );
}

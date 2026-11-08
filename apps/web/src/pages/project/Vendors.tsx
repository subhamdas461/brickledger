import { VendorTypes, formatDate, type Expense, type Vendor } from '@brickledger/shared/web';
import { Download, Phone, Plus, Store } from 'lucide-react';
import { useState } from 'react';
import { FormModal, type FieldDef } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { downloadFile, errorMessage } from '../../lib/api';
import { useList, useReport, useResourceMutations } from '../../lib/queries';
import { DataTable, useCanDelete, useMoney } from './common';
import { ExpenseFormModal } from './Expenses';

const fields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, span: 2, placeholder: 'Business or person' },
  { name: 'type', label: 'Type', type: 'select', options: VendorTypes.list, required: true },
  { name: 'contactPerson', label: 'Contact person', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'contractAmount', label: 'Agreed contract amount', type: 'money', hint: 'For contractors - tracks the balance still to pay.' },
  { name: 'taxId', label: 'GSTIN / tax ID', type: 'text' },
  { name: 'address', label: 'Address', type: 'text', span: 2 },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
];

function VendorPayments({ vendor }: { vendor: Vendor }) {
  const { pid } = useProjectCtx();
  const { money } = useMoney();
  const list = useList(pid, 'expenses', { vendorId: vendor.id, limit: 200 });
  const items = list.data?.items ?? [];
  return (
    <div className="mt-6 border-t border-stone-100 pt-5 dark:border-stone-800">
      <p className="mb-2 text-sm font-medium">Payments & bills ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-xs text-stone-500">No expenses recorded for this vendor yet.</p>
      ) : (
        <ul className="max-h-56 divide-y divide-stone-100 overflow-y-auto text-sm dark:divide-stone-800">
          {items.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{e.title}</span>
                <span className="text-xs text-stone-500">{formatDate(e.date)}</span>
              </span>
              <span className="tabular shrink-0 font-medium">
                {money(e.amount)} {e.status === 'due' && <Badge tone="amber">Due</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Vendors() {
  const { pid, canEdit, currency } = useProjectCtx();
  const { money } = useMoney();
  const report = useReport(pid);
  const vendors = useList(pid, 'vendors', { limit: 1000 });
  const { create, update, remove } = useResourceMutations(pid, 'vendors');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [paying, setPaying] = useState<Vendor | null>(null);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);

  if (!vendors.data) return <Spinner />;
  const balances = new Map((report.data?.vendors ?? []).map((v) => [v.id, v]));
  const totals = (report.data?.vendors ?? []).reduce((s, v) => ({ paid: s.paid + v.paid, due: s.due + v.due }), { paid: 0, due: 0 });

  return (
    <>
      {dialog}
      <PageHeader
        title="Vendors & contractors"
        description={`${vendors.data.total} vendors · ${money(totals.paid)} paid · ${money(totals.due)} in unpaid bills`}
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadFile(`/projects/${pid}/export/vendors.csv`, 'vendors.csv')}>
              CSV
            </Button>
            {canEdit && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Add vendor
              </Button>
            )}
          </>
        }
      />
      <Card>
        <DataTable
          rows={vendors.data.items}
          rowKey={(v) => v.id}
          onRowClick={(v) => setEditing(v)}
          empty={<EmptyState icon={<Store />} title="No vendors yet" description="Add suppliers, contractors and consultants to track what you owe each of them." action={canEdit ? <Button onClick={() => setEditing('new')}>Add vendor</Button> : undefined} />}
          columns={[
            {
              key: 'name',
              header: 'Vendor',
              cell: (v) => (
                <div>
                  <p className="font-medium">{v.name}</p>
                  <p className="flex items-center gap-2 text-xs text-stone-500">
                    {VendorTypes.label(v.type)}
                    {v.phone && (
                      <a href={`tel:${v.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-brand-700">
                        <Phone className="size-3" />
                        {v.phone}
                      </a>
                    )}
                  </p>
                </div>
              ),
            },
            { key: 'contract', header: 'Contract', align: 'right', className: 'hidden md:table-cell', cell: (v) => (v.contractAmount != null ? money(v.contractAmount) : '—') },
            { key: 'paid', header: 'Paid', align: 'right', cell: (v) => money(balances.get(v.id)?.paid ?? 0) },
            {
              key: 'due',
              header: 'Due',
              align: 'right',
              className: 'hidden sm:table-cell',
              cell: (v) => {
                const due = balances.get(v.id)?.due ?? 0;
                return due ? <span className="font-medium text-[var(--critical)]">{money(due)}</span> : '—';
              },
            },
            {
              key: 'balance',
              header: 'Balance to pay',
              align: 'right',
              cell: (v) => {
                const b = balances.get(v.id)?.balance;
                return b == null ? <span className="text-stone-400">—</span> : <span className="font-semibold">{money(b)}</span>;
              },
            },
            ...(canEdit
              ? [
                  {
                    key: 'pay',
                    header: '',
                    align: 'right' as const,
                    cell: (v: Vendor) => (
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPaying(v);
                        }}
                      >
                        Record payment
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={existing ? existing.name : 'Add vendor'}
        currency={currency}
        fields={fields}
        initial={existing ?? { type: 'supplier' }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm(`Delete ${existing.name}?`, 'Their expenses are kept but will no longer show a vendor.'))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (payload) => {
          if (existing) await update.mutateAsync({ id: existing.id, ...payload });
          else await create.mutateAsync(payload);
          toast.success(existing ? 'Vendor saved' : 'Vendor added');
          setEditing(null);
        }}
      >
        {existing && <VendorPayments vendor={existing} />}
      </FormModal>

      <ExpenseFormModal
        key={paying?.id ?? 'none'}
        expense={paying ? 'new' : null}
        defaults={paying ? ({ vendorId: paying.id, title: `Payment to ${paying.name}`, paymentMode: 'bank_transfer' } as Partial<Expense>) : undefined}
        onClose={() => setPaying(null)}
      />
    </>
  );
}

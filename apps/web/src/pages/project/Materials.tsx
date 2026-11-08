import { MATERIAL_UNITS, MaterialCategories, formatDate, formatNumber, todayIso, type Material, type MaterialStock } from '@brickledger/shared/web';
import { ArrowDownToLine, ArrowUpFromLine, Download, Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { Meter } from '../../components/charts';
import { FormModal, type FieldDef } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { downloadFile, errorMessage } from '../../lib/api';
import { useList, useLookups, useReport, useResourceMutations } from '../../lib/queries';
import { DataTable, useCanDelete, useMoney } from './common';

function StockHistory({ material }: { material: Material }) {
  const { pid } = useProjectCtx();
  const { money } = useMoney();
  const moves = useList(pid, 'movements', { materialId: material.id, limit: 200 });
  const items = moves.data?.items ?? [];
  return (
    <div className="mt-6 border-t border-stone-100 pt-5 dark:border-stone-800">
      <p className="mb-2 text-sm font-medium">Stock history</p>
      {items.length === 0 ? (
        <p className="text-xs text-stone-500">No deliveries or usage recorded yet.</p>
      ) : (
        <ul className="max-h-60 divide-y divide-stone-100 overflow-y-auto text-sm dark:divide-stone-800">
          {items.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2">
                {m.type === 'in' ? <ArrowDownToLine className="size-4 text-[var(--good)]" /> : <ArrowUpFromLine className="size-4 text-stone-400" />}
                <span>
                  {m.type === 'in' ? 'Received' : 'Used'} <b className="tabular">{formatNumber(m.quantity)}</b> {material.unit}
                  <span className="block text-xs text-stone-500">{formatDate(m.date)}{m.notes ? ` · ${m.notes}` : ''}</span>
                </span>
              </span>
              {m.rate != null && <span className="tabular text-xs text-stone-500">@ {money(m.rate)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Materials() {
  const { pid, canEdit, currency } = useProjectCtx();
  const { money } = useMoney();
  const report = useReport(pid);
  const materials = useList(pid, 'materials', { limit: 1000 });
  const lookups = useLookups(pid);
  const matMut = useResourceMutations(pid, 'materials');
  const moveMut = useResourceMutations(pid, 'movements');
  const expMut = useResourceMutations(pid, 'expenses');
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [moving, setMoving] = useState<{ material: Material; type: 'in' | 'out' } | null>(null);
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);

  if (!materials.data) return <Spinner />;
  const stock = new Map((report.data?.materials ?? []).map((m) => [m.id, m]));
  const rows = materials.data.items.map((m) => ({ m, s: stock.get(m.id) }));

  const materialFields: FieldDef[] = [
    { name: 'name', label: 'Material', type: 'text', required: true, span: 2, placeholder: 'e.g. Cement (OPC 53)' },
    { name: 'category', label: 'Category', type: 'select', options: MaterialCategories.list, required: true },
    { name: 'unit', label: 'Unit', type: 'select', options: MATERIAL_UNITS.map((u) => ({ value: u, label: u })), required: true },
    { name: 'estimatedQty', label: 'Estimated total needed', type: 'number', hint: 'Optional - shows how much is procured.' },
    { name: 'minStock', label: 'Alert when stock below', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
  ];

  const lowStock = (s: MaterialStock | undefined) => s && s.minStock != null && s.minStock > 0 && s.stock < s.minStock;

  return (
    <>
      {dialog}
      <PageHeader
        title="Materials & stock"
        description="Deliveries, consumption and what’s left on site."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadFile(`/projects/${pid}/export/stock.csv`, 'stock.csv')}>
              Movements CSV
            </Button>
            {canEdit && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Add material
              </Button>
            )}
          </>
        }
      />
      <Card>
        <DataTable
          rows={rows}
          rowKey={(r) => r.m.id}
          onRowClick={(r) => setEditing(r.m)}
          empty={<EmptyState icon={<Package />} title="No materials yet" description="Track cement, steel, sand and anything else you buy in bulk." action={canEdit ? <Button onClick={() => setEditing('new')}>Add material</Button> : undefined} />}
          columns={[
            {
              key: 'name',
              header: 'Material',
              cell: ({ m, s }) => (
                <div className="min-w-44">
                  <p className="flex items-center gap-2 font-medium">
                    {m.name}
                    {lowStock(s) && <Badge tone="amber">Low stock</Badge>}
                  </p>
                  <p className="text-xs text-stone-500">{MaterialCategories.label(m.category)}</p>
                </div>
              ),
            },
            {
              key: 'stock',
              header: 'In stock',
              align: 'right',
              cell: ({ m, s }) => (
                <span className="font-semibold">
                  {formatNumber(s?.stock ?? 0)} <span className="font-normal text-stone-500">{m.unit}</span>
                </span>
              ),
            },
            { key: 'in', header: 'Received', align: 'right', className: 'hidden md:table-cell', cell: ({ s }) => formatNumber(s?.received ?? 0) },
            { key: 'out', header: 'Used', align: 'right', className: 'hidden md:table-cell', cell: ({ s }) => formatNumber(s?.used ?? 0) },
            {
              key: 'procured',
              header: 'Procured',
              className: 'hidden lg:table-cell w-36',
              cell: ({ m, s }) =>
                m.estimatedQty ? (
                  <div className="flex items-center gap-2">
                    <Meter value={s?.received ?? 0} max={m.estimatedQty} thin kind="progress" />
                    <span className="tabular w-9 text-right text-xs text-stone-500">{Math.round(((s?.received ?? 0) / m.estimatedQty) * 100)}%</span>
                  </div>
                ) : (
                  <span className="text-xs text-stone-400">—</span>
                ),
            },
            { key: 'rate', header: 'Avg rate', align: 'right', className: 'hidden sm:table-cell', cell: ({ s }) => (s?.avgRate != null ? money(s.avgRate) : '—') },
            { key: 'value', header: 'Purchased', align: 'right', className: 'hidden sm:table-cell', cell: ({ s }) => money(s?.value ?? 0) },
            ...(canEdit
              ? [
                  {
                    key: 'act',
                    header: '',
                    align: 'right' as const,
                    cell: ({ m }: { m: Material }) => (
                      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="subtle" onClick={() => setMoving({ material: m, type: 'in' })}>
                          Receive
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setMoving({ material: m, type: 'out' })}>
                          Use
                        </Button>
                      </div>
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
        title={existing ? existing.name : 'Add material'}
        fields={materialFields}
        initial={existing ?? { category: 'other', unit: 'nos' }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm(`Delete ${existing.name}?`, 'Its stock history will no longer appear in reports.'))) return;
                await matMut.remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (payload) => {
          if (existing) await matMut.update.mutateAsync({ id: existing.id, ...payload });
          else await matMut.create.mutateAsync(payload);
          setEditing(null);
        }}
      >
        {existing && <StockHistory material={existing} />}
      </FormModal>

      {moving && (
        <FormModal
          key={`${moving.material.id}-${moving.type}`}
          open
          onClose={() => setMoving(null)}
          title={`${moving.type === 'in' ? 'Receive' : 'Use'} ${moving.material.name}`}
          description={`In stock: ${formatNumber(stock.get(moving.material.id)?.stock ?? 0)} ${moving.material.unit}`}
          currency={currency}
          submitLabel={moving.type === 'in' ? 'Record delivery' : 'Record usage'}
          fields={[
            { name: 'quantity', label: `Quantity (${moving.material.unit})`, type: 'number', required: true },
            { name: 'date', label: 'Date', type: 'date', required: true },
            ...(moving.type === 'in'
              ? ([
                  { name: 'rate', label: `Rate per ${moving.material.unit}`, type: 'money' },
                  { name: 'vendorId', label: 'Supplier', type: 'select', options: lookups.options.vendors },
                  { name: 'recordExpense', label: 'Also record this purchase as an expense', type: 'checkbox', span: 2, description: 'Amount = quantity × rate. Keeps budget and stock in sync.' },
                  { name: 'categoryId', label: 'Budget category', type: 'select', options: lookups.options.categories, visible: (v) => Boolean(v.recordExpense) },
                  {
                    name: 'expenseStatus',
                    label: 'Payment',
                    type: 'segmented',
                    options: [
                      { value: 'paid', label: 'Paid' },
                      { value: 'due', label: 'Bill due' },
                    ],
                    visible: (v) => Boolean(v.recordExpense),
                  },
                ] as FieldDef[])
              : ([{ name: 'phaseId', label: 'Used for phase', type: 'select', options: lookups.options.phases }] as FieldDef[])),
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
          ]}
          initial={{ date: todayIso(), recordExpense: true, expenseStatus: 'paid', categoryId: guessCategory(moving.material, lookups.categories) }}
          onSubmit={async (p) => {
            const m = moving.material;
            let expenseId: string | null = null;
            if (moving.type === 'in' && p.recordExpense && p.rate && p.quantity) {
              const expense = await expMut.create.mutateAsync({
                date: p.date,
                title: `${m.name} - ${formatNumber(p.quantity)} ${m.unit}`,
                amount: Math.round(p.quantity * p.rate * 100) / 100,
                quantity: p.quantity,
                unit: m.unit,
                rate: p.rate,
                vendorId: p.vendorId,
                categoryId: p.categoryId,
                status: p.expenseStatus ?? 'paid',
                paymentMode: 'bank_transfer',
              });
              expenseId = expense.id;
            }
            await moveMut.create.mutateAsync({
              materialId: m.id,
              type: moving.type,
              quantity: p.quantity,
              date: p.date,
              rate: moving.type === 'in' ? p.rate : null,
              vendorId: moving.type === 'in' ? p.vendorId : null,
              phaseId: moving.type === 'out' ? p.phaseId : null,
              expenseId,
              notes: p.notes,
            });
            toast.success(moving.type === 'in' ? 'Delivery recorded' : 'Usage recorded');
            setMoving(null);
          }}
        />
      )}
    </>
  );
}

/** Pre-selects the budget head a material usually belongs to. */
function guessCategory(m: Material, categories: { id: string; name: string }[]) {
  const find = (prefix: string) => categories.find((c) => c.name.toLowerCase().startsWith(prefix))?.id;
  if (['cement', 'steel', 'aggregate'].includes(m.category)) return find('rcc');
  if (['bricks_blocks', 'sand'].includes(m.category)) return find('masonry');
  if (m.category === 'tiles_stone') return find('flooring');
  if (m.category === 'paint') return find('painting');
  if (m.category === 'electrical') return find('electrical');
  if (m.category === 'plumbing') return find('plumbing');
  if (m.category === 'wood') return find('doors');
  return undefined;
}

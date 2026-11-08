import { FundSources, formatDate, todayIso, type Fund } from '@brickledger/shared/web';
import { Download, Landmark, Plus } from 'lucide-react';
import { useState } from 'react';
import { SegmentedBar, SERIES, SERIES_DARK_TEXT } from '../../components/charts';
import { FormModal } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Card, CardHeader, EmptyState, PageHeader, Spinner, Stat } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { downloadFile, errorMessage } from '../../lib/api';
import { useDashboard, useList, useResourceMutations } from '../../lib/queries';
import { DataTable, useCanDelete, useMoney } from './common';

export function Funds() {
  const { pid, canEdit, currency } = useProjectCtx();
  const { money, compact } = useMoney();
  const funds = useList(pid, 'funds', { limit: 1000 });
  const dash = useDashboard(pid);
  const { create, update, remove } = useResourceMutations(pid, 'funds');
  const [editing, setEditing] = useState<Fund | 'new' | null>(null);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);
  if (!funds.data || !dash.data) return <Spinner />;

  const t = dash.data.totals;
  const bySource = new Map<string, number>();
  for (const f of funds.data.items) bySource.set(f.source, (bySource.get(f.source) ?? 0) + f.amount);

  return (
    <>
      {dialog}
      <PageHeader
        title="Funds"
        description="Money coming into the build - savings, loan disbursements, family support or client payments."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadFile(`/projects/${pid}/export/funds.csv`, 'funds.csv')}>
              CSV
            </Button>
            {canEdit && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Add funds
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Funds received" value={money(t.fundsReceived)} />
        <Stat label="Paid out" value={money(t.spent)} note={`${money(t.due)} more in unpaid bills`} />
        <Stat label="Cash in hand" value={money(t.cashInHand)} noteTone={t.cashInHand - t.due < 0 ? 'bad' : 'good'} note={t.cashInHand - t.due < 0 ? `Short by ${compact(t.due - t.cashInHand)} for due bills` : 'Covers all due bills'} />
      </div>
      {bySource.size > 0 && (
        <Card className="mb-6">
          <CardHeader title="Sources of funds" />
          <div className="p-5">
            <SegmentedBar
              ariaLabel="Funds by source"
              format={money}
              // Colour follows the source (fixed slot per source), not its rank.
              parts={FundSources.values
                .filter((s) => bySource.has(s))
                .map((s) => {
                  const slot = FundSources.values.indexOf(s);
                  return { label: FundSources.label(s), value: bySource.get(s)!, color: SERIES[slot]!, dark: SERIES_DARK_TEXT[slot] };
                })}
            />
          </div>
        </Card>
      )}
      <Card>
        <DataTable
          rows={funds.data.items}
          rowKey={(f) => f.id}
          onRowClick={canEdit ? (f) => setEditing(f) : undefined}
          empty={<EmptyState icon={<Landmark />} title="No funds recorded" description="Add savings, loan tranches or family contributions to see your cash position." action={canEdit ? <Button onClick={() => setEditing('new')}>Add funds</Button> : undefined} />}
          columns={[
            { key: 'date', header: 'Date', cell: (f) => <span className="text-stone-500">{formatDate(f.date)}</span> },
            { key: 'source', header: 'Source', cell: (f) => <span className="font-medium">{f.description || FundSources.label(f.source)}</span> },
            { key: 'type', header: 'Type', className: 'hidden sm:table-cell', cell: (f) => FundSources.label(f.source) },
            { key: 'ref', header: 'Reference', className: 'hidden md:table-cell', cell: (f) => <span className="text-stone-500">{f.reference ?? '—'}</span> },
            { key: 'amount', header: 'Amount', align: 'right', cell: (f) => <span className="font-semibold">{money(f.amount)}</span> },
          ]}
        />
      </Card>
      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={existing ? 'Edit funds' : 'Add funds'}
        currency={currency}
        fields={[
          { name: 'amount', label: 'Amount', type: 'money', required: true },
          { name: 'date', label: 'Date received', type: 'date', required: true },
          { name: 'source', label: 'Source', type: 'select', options: FundSources.list, required: true },
          { name: 'description', label: 'Description', type: 'text', placeholder: 'e.g. SBI home loan - tranche 2' },
          { name: 'reference', label: 'Reference', type: 'text', placeholder: 'Loan / transaction no.' },
          { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
        ]}
        initial={existing ?? { date: todayIso(), source: 'savings' }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm('Delete this entry?', 'It will be removed from funds totals.'))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (payload) => {
          if (existing) await update.mutateAsync({ id: existing.id, ...payload });
          else await create.mutateAsync(payload);
          setEditing(null);
        }}
      />
    </>
  );
}

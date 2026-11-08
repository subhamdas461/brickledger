import { FundSources, PaymentModes, WorkerTrades, formatNumber } from '@brickledger/shared/web';
import { FileDown, FileSpreadsheet, Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { ApiError, downloadFile, errorMessage } from '../../lib/api';
import { useReport } from '../../lib/queries';
import { DataTable, useMoney } from './common';

const EXPORTS: [string, string][] = [
  ['expenses', 'Expenses'],
  ['budget', 'Budget vs actual'],
  ['vendors', 'Vendor balances'],
  ['materials', 'Material stock'],
  ['stock', 'Stock movements'],
  ['labour', 'Wages summary'],
  ['attendance', 'Attendance'],
  ['funds', 'Funds'],
  ['tasks', 'Tasks'],
  ['issues', 'Issues'],
  ['logs', 'Site diary'],
];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="pb-2 pt-2">{children}</div>
    </Card>
  );
}

export function Reports() {
  const { pid, project } = useProjectCtx();
  const report = useReport(pid);
  const { money } = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const pdfAllowed = project.features.pdfReports;

  async function pdf() {
    setBusy(true);
    try {
      await downloadFile(`/projects/${pid}/report.pdf`, 'report.pdf');
    } catch (err) {
      if (err instanceof ApiError && err.isPlanLimit) toast.error(err.message, { label: 'See plans', onClick: () => navigate('/app/settings?tab=billing') });
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!report.data) return <Spinner />;
  const r = report.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="Download for your bank, family or records - or read the numbers right here." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <FileDown className="size-6 text-brand-600" />
          <h3 className="mt-3 font-semibold">Project cost report (PDF)</h3>
          <p className="mt-1 text-sm text-stone-500">
            Budget vs actual, monthly spending, vendors, stock, labour and funding on two clean pages.
            {project.orgPlan === 'business' ? ' Branded with your workspace name.' : ''}
          </p>
          <Button className="mt-4" loading={busy} icon={pdfAllowed ? undefined : <Lock className="size-4" />} variant={pdfAllowed ? 'primary' : 'secondary'} onClick={pdf}>
            {pdfAllowed ? 'Download PDF' : 'Available on Pro'}
          </Button>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <FileSpreadsheet className="size-6 text-[var(--good)]" />
          <h3 className="mt-3 font-semibold">Spreadsheet exports (CSV)</h3>
          <p className="mt-1 text-sm text-stone-500">Open in Excel or Google Sheets.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXPORTS.map(([key, label]) => (
              <Button key={key} size="sm" variant="secondary" onClick={() => downloadFile(`/projects/${pid}/export/${key}.csv`, `${key}.csv`).catch((e) => toast.error(errorMessage(e)))}>
                {label}
              </Button>
            ))}
          </div>
        </Card>
      </div>

      <Section title="Budget vs actual" subtitle={`Budget ${money(r.totals.budget)} · committed ${money(r.totals.committed)}`}>
        <DataTable
          rows={r.categories}
          rowKey={(c) => c.id ?? 'none'}
          columns={[
            { key: 'n', header: 'Category', cell: (c) => c.name },
            { key: 'p', header: 'Planned', align: 'right', cell: (c) => money(c.planned) },
            { key: 's', header: 'Paid', align: 'right', cell: (c) => money(c.spent) },
            { key: 'd', header: 'Due', align: 'right', cell: (c) => money(c.due) },
            { key: 'u', header: 'Used', align: 'right', cell: (c) => (c.planned ? `${Math.round(((c.spent + c.due) / c.planned) * 100)}%` : '—') },
          ]}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Payment modes" subtitle="Paid expenses by how they were paid">
          <DataTable rows={r.paymentModes} rowKey={(m) => m.mode} columns={[{ key: 'm', header: 'Mode', cell: (m) => PaymentModes.label(m.mode) }, { key: 'a', header: 'Amount', align: 'right', cell: (m) => money(m.amount) }]} />
        </Section>
        <Section title="Funding" subtitle={`Received ${money(r.totals.fundsReceived)} · cash in hand ${money(r.totals.cashInHand)}`}>
          <DataTable rows={r.funds} rowKey={(f) => f.source} columns={[{ key: 's', header: 'Source', cell: (f) => FundSources.label(f.source) }, { key: 'a', header: 'Amount', align: 'right', cell: (f) => money(f.amount) }]} />
        </Section>
      </div>

      <Section title="Vendors & contractors">
        <DataTable
          rows={r.vendors}
          rowKey={(v) => v.id}
          columns={[
            { key: 'n', header: 'Vendor', cell: (v) => v.name },
            { key: 'c', header: 'Contract', align: 'right', cell: (v) => (v.contractAmount != null ? money(v.contractAmount) : '—') },
            { key: 'p', header: 'Paid', align: 'right', cell: (v) => money(v.paid) },
            { key: 'd', header: 'Due', align: 'right', cell: (v) => money(v.due) },
            { key: 'b', header: 'Balance', align: 'right', cell: (v) => (v.balance != null ? money(v.balance) : '—') },
          ]}
        />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Materials">
          <DataTable
            rows={r.materials}
            rowKey={(m) => m.id}
            columns={[
              { key: 'n', header: 'Material', cell: (m) => `${m.name} (${m.unit})` },
              { key: 'r', header: 'Received', align: 'right', cell: (m) => formatNumber(m.received) },
              { key: 'u', header: 'Used', align: 'right', cell: (m) => formatNumber(m.used) },
              { key: 's', header: 'Stock', align: 'right', cell: (m) => formatNumber(m.stock) },
              { key: 'v', header: 'Value', align: 'right', cell: (m) => money(m.value) },
            ]}
          />
        </Section>
        <Section title="Labour">
          <DataTable
            rows={r.labour}
            rowKey={(l) => l.workerId}
            columns={[
              { key: 'n', header: 'Worker', cell: (l) => `${l.name} · ${WorkerTrades.label(l.trade)}` },
              { key: 'd', header: 'Days', align: 'right', cell: (l) => l.presentDays + l.halfDays / 2 },
              { key: 'e', header: 'Earned', align: 'right', cell: (l) => money(l.earned) },
              { key: 'p', header: 'Paid', align: 'right', cell: (l) => money(l.paid) },
              { key: 'b', header: 'Balance', align: 'right', cell: (l) => money(l.balance) },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}

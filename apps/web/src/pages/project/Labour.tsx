import { LABOUR_CATEGORY_NAME, WorkerTrades, addDaysIso, formatDate, todayIso, wageFor, type Expense, type Worker } from '@brickledger/shared/web';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, HardHat, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FormModal, type FieldDef } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Input, Segmented } from '../../components/ui/form';
import { Tabs } from '../../components/ui/menu';
import { Avatar, Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { api, downloadFile, errorMessage } from '../../lib/api';
import { useList, useLookups, useRefreshProject, useReport, useResourceMutations } from '../../lib/queries';
import { DataTable, useCanDelete, useMoney } from './common';
import { ExpenseFormModal } from './Expenses';

type Mark = { status: 'present' | 'half' | 'absent'; overtimeHours: number };

function AttendanceSheet() {
  const { pid, canEdit } = useProjectCtx();
  const { money } = useMoney();
  const toast = useToast();
  const refresh = useRefreshProject(pid);
  const [date, setDate] = useState(todayIso());
  const workers = useList(pid, 'workers', { active: 'true', limit: 1000 });
  const records = useList(pid, 'attendance', { date, limit: 1000 });
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!records.data || records.isPlaceholderData) return;
    const next: Record<string, Mark> = {};
    for (const r of records.data.items) next[r.workerId] = { status: r.status, overtimeHours: r.overtimeHours };
    setMarks(next);
    setDirty(false);
  }, [records.data, records.isPlaceholderData, date]);

  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${pid}/attendance/bulk`, {
        method: 'POST',
        body: { date, entries: Object.entries(marks).map(([workerId, m]) => ({ workerId, status: m.status, overtimeHours: m.overtimeHours || 0 })) },
      }),
    onSuccess: () => {
      refresh();
      setDirty(false);
      toast.success(`Attendance saved for ${formatDate(date)}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const list = workers.data?.items ?? [];
  const summary = useMemo(() => {
    let present = 0;
    let half = 0;
    let absent = 0;
    let cost = 0;
    for (const w of list) {
      const m = marks[w.id];
      if (!m) continue;
      if (m.status === 'present') present++;
      else if (m.status === 'half') half++;
      else absent++;
      cost += wageFor(m.status, m.overtimeHours, w.dailyWage);
    }
    return { present, half, absent, cost, unmarked: list.length - present - half - absent };
  }, [list, marks]);

  const setMark = (id: string, patch: Partial<Mark>) => {
    setMarks((all) => {
      const prev: Mark | undefined = all[id];
      return { ...all, [id]: { ...(prev ?? { status: 'present', overtimeHours: 0 }), ...patch } };
    });
    setDirty(true);
  };

  if (!workers.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous day" onClick={() => setDate((d) => addDaysIso(d, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Input type="date" aria-label="Attendance date" className="w-44" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <Button variant="ghost" size="icon" aria-label="Next day" disabled={date >= todayIso()} onClick={() => setDate((d) => addDaysIso(d, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          {date !== todayIso() && (
            <Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>
              Today
            </Button>
          )}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600 dark:text-stone-300">
          <span><b className="text-stone-900 dark:text-white">{summary.present}</b> present</span>
          <span><b className="text-stone-900 dark:text-white">{summary.half}</b> half-day</span>
          <span><b className="text-stone-900 dark:text-white">{summary.absent}</b> absent</span>
          {summary.unmarked > 0 && <span className="text-stone-400">{summary.unmarked} not marked</span>}
          <span className="ml-auto">Day’s wages <b className="text-stone-900 dark:text-white">{money(summary.cost)}</b></span>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const next: Record<string, Mark> = {};
                for (const w of list) next[w.id] = { status: 'present', overtimeHours: marks[w.id]?.overtimeHours ?? 0 };
                setMarks(next);
                setDirty(true);
              }}
            >
              Mark all present
            </Button>
            <Button loading={save.isPending} disabled={!dirty || Object.keys(marks).length === 0} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        )}
      </Card>
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<HardHat />} title="No active workers" description="Add the people working on site to start marking attendance." />
        </Card>
      ) : (
        <Card className="divide-y divide-stone-100 dark:divide-stone-800">
          {list.map((w) => {
            const m = marks[w.id];
            return (
              <div key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={w.name} />
                <div className="min-w-36 flex-1">
                  <p className="font-medium">{w.name}</p>
                  <p className="text-xs text-stone-500">
                    {WorkerTrades.label(w.trade)} · {money(w.dailyWage)}/day
                  </p>
                </div>
                <Segmented
                  aria-label={`Attendance for ${w.name}`}
                  value={m?.status ?? ('' as Mark['status'])}
                  onChange={(status) => canEdit && setMark(w.id, { status })}
                  options={[
                    { value: 'present', label: 'Present', tone: 'good' },
                    { value: 'half', label: 'Half day', tone: 'warn' },
                    { value: 'absent', label: 'Absent', tone: 'bad' },
                  ]}
                />
                <label className="flex items-center gap-2 text-xs text-stone-500">
                  OT hrs
                  <Input
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    className="h-9 w-16"
                    disabled={!canEdit || !m || m.status === 'absent'}
                    value={m?.overtimeHours || ''}
                    onChange={(e) => setMark(w.id, { overtimeHours: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function WorkersList() {
  const { pid, canEdit, currency } = useProjectCtx();
  const { money } = useMoney();
  const lookups = useLookups(pid);
  const workers = useList(pid, 'workers', { limit: 1000 });
  const { create, update, remove } = useResourceMutations(pid, 'workers');
  const [editing, setEditing] = useState<Worker | 'new' | null>(null);
  const { confirm, dialog } = useConfirm();
  const toast = useToast();
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);
  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'trade', label: 'Trade', type: 'select', options: WorkerTrades.list, required: true },
    { name: 'dailyWage', label: 'Daily wage', type: 'money', required: true },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'vendorId', label: 'Labour contractor', type: 'select', options: lookups.options.vendors, hint: 'If paid through a contractor.' },
    { name: 'active', label: 'Currently working on site', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
  ];
  if (!workers.data) return <Spinner />;
  return (
    <>
      {dialog}
      <div className="mb-4 flex justify-end">
        {canEdit && (
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add worker
          </Button>
        )}
      </div>
      <Card>
        <DataTable
          rows={workers.data.items}
          rowKey={(w) => w.id}
          onRowClick={canEdit ? (w) => setEditing(w) : undefined}
          empty={<EmptyState icon={<HardHat />} title="No workers yet" action={canEdit ? <Button onClick={() => setEditing('new')}>Add worker</Button> : undefined} />}
          columns={[
            { key: 'name', header: 'Name', cell: (w) => <span className="flex items-center gap-3 font-medium"><Avatar name={w.name} className="size-7" />{w.name}</span> },
            { key: 'trade', header: 'Trade', cell: (w) => WorkerTrades.label(w.trade) },
            { key: 'via', header: 'Contractor', className: 'hidden md:table-cell', cell: (w) => <span className="text-stone-500">{lookups.names.vendors.get(w.vendorId ?? '') ?? 'Direct'}</span> },
            { key: 'status', header: 'Status', cell: (w) => (w.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
            { key: 'wage', header: 'Daily wage', align: 'right', cell: (w) => money(w.dailyWage) },
          ]}
        />
      </Card>
      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={existing ? existing.name : 'Add worker'}
        currency={currency}
        fields={fields}
        initial={existing ?? { trade: 'helper', active: true, dailyWage: '' }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm(`Delete ${existing.name}?`, 'Tip: mark them inactive instead to keep their attendance history in wage totals.'))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (p) => {
          const body = { ...p, dailyWage: p.dailyWage ?? 0 };
          if (existing) await update.mutateAsync({ id: existing.id, ...body });
          else await create.mutateAsync(body);
          setEditing(null);
        }}
      />
    </>
  );
}

function Wages() {
  const { pid, canEdit } = useProjectCtx();
  const { money } = useMoney();
  const report = useReport(pid);
  const lookups = useLookups(pid);
  const [paying, setPaying] = useState<Partial<Expense> | null>(null);
  if (!report.data) return <Spinner />;
  const labourCategory = lookups.categories.find((c) => c.name === LABOUR_CATEGORY_NAME)?.id ?? null;
  const rows = report.data.labour;
  const totals = rows.reduce((s, l) => ({ earned: s.earned + l.earned, paid: s.paid + l.paid }), { earned: 0, paid: 0 });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Earned <b>{money(totals.earned)}</b> · Paid <b>{money(totals.paid)}</b> · Balance <b>{money(totals.earned - totals.paid)}</b>
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => downloadFile(`/projects/${pid}/export/attendance.csv`, 'attendance.csv')}>
            Attendance CSV
          </Button>
          <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => downloadFile(`/projects/${pid}/export/labour.csv`, 'labour.csv')}>
            Wages CSV
          </Button>
        </div>
      </div>
      <Card>
        <DataTable
          rows={rows}
          rowKey={(l) => l.workerId}
          columns={[
            { key: 'name', header: 'Worker', cell: (l) => <span><span className="font-medium">{l.name}</span><span className="block text-xs text-stone-500">{WorkerTrades.label(l.trade)}</span></span> },
            { key: 'days', header: 'Days', align: 'right', cell: (l) => l.presentDays + l.halfDays / 2 },
            { key: 'ot', header: 'OT hrs', align: 'right', className: 'hidden sm:table-cell', cell: (l) => l.overtimeHours || '—' },
            { key: 'earned', header: 'Earned', align: 'right', cell: (l) => money(l.earned) },
            { key: 'paid', header: 'Paid', align: 'right', cell: (l) => money(l.paid) },
            {
              key: 'balance',
              header: 'Balance',
              align: 'right',
              cell: (l) => <span className={l.balance > 0 ? 'font-semibold' : 'text-stone-500'}>{l.balance < 0 ? `${money(-l.balance)} advance` : money(l.balance)}</span>,
            },
            ...(canEdit
              ? [
                  {
                    key: 'pay',
                    header: '',
                    align: 'right' as const,
                    cell: (l: (typeof rows)[number]) => (
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() =>
                          setPaying({ workerId: l.workerId, title: `Wages - ${l.name}`, amount: l.balance > 0 ? l.balance : undefined, categoryId: labourCategory, paymentMode: 'cash' })
                        }
                      >
                        Pay
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <p className="mt-3 text-xs text-stone-500">Earned = present days × daily wage + half days × ½ wage + overtime at the hourly rate of an 8-hour day. Payments are expenses linked to the worker.</p>
      <ExpenseFormModal key={paying ? 'pay' : 'none'} expense={paying ? 'new' : null} defaults={paying ?? undefined} onClose={() => setPaying(null)} />
    </>
  );
}

export function Labour() {
  const [tab, setTab] = useState<'attendance' | 'workers' | 'wages'>('attendance');
  return (
    <>
      <PageHeader title="Labour" description="Attendance, workers and wages." />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'attendance', label: 'Attendance' },
          { value: 'workers', label: 'Workers' },
          { value: 'wages', label: 'Wages' },
        ]}
      />
      {tab === 'attendance' && <AttendanceSheet />}
      {tab === 'workers' && <WorkersList />}
      {tab === 'wages' && <Wages />}
    </>
  );
}

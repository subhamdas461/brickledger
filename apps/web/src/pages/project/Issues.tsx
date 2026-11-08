import { IssueSeverities, IssueStatuses, formatDate, todayIso, type Issue } from '@brickledger/shared/web';
import { CircleCheck, CircleDot, OctagonExclamationPoint, Plus, TriangleExclamationPoint } from 'lucide-react';
import { useState } from 'react';
import { FormModal } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Tabs } from '../../components/ui/menu';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { useList, useLookups, useResourceMutations, useUpload } from '../../lib/queries';
import { Attachments, PendingFilesPicker, uploadFile, useCanDelete } from './common';

/** Severity always ships with an icon + label, never colour alone. */
const SEVERITY = {
  critical: { icon: OctagonExclamationPoint, color: 'var(--critical)' },
  high: { icon: TriangleExclamationPoint, color: 'var(--serious)' },
  medium: { icon: TriangleExclamationPoint, color: 'var(--warning)' },
  low: { icon: CircleDot, color: 'var(--ink-muted)' },
} as const;

export function Issues() {
  const { pid, canEdit } = useProjectCtx();
  const [tab, setTab] = useState<'active' | 'resolved' | 'all'>('active');
  const issues = useList(pid, 'issues', { limit: 1000 });
  const lookups = useLookups(pid);
  const { create, update, remove } = useResourceMutations(pid, 'issues');
  const upload = useUpload(pid);
  const [editing, setEditing] = useState<Issue | 'new' | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);
  if (!issues.data) return <Spinner />;

  const all = issues.data.items;
  const shown = all.filter((i) => (tab === 'all' ? true : tab === 'resolved' ? i.status === 'resolved' : i.status !== 'resolved'));
  const today = todayIso();

  return (
    <>
      {dialog}
      <PageHeader
        title="Issues & snags"
        description="Quality problems, defects and anything that needs fixing before handover."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Report issue
            </Button>
          )
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'active', label: 'Open', count: all.filter((i) => i.status !== 'resolved').length },
          { value: 'resolved', label: 'Resolved', count: all.filter((i) => i.status === 'resolved').length },
          { value: 'all', label: 'All', count: all.length },
        ]}
      />
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<CircleCheck />} title={tab === 'resolved' ? 'Nothing resolved yet' : 'No open issues'} description="Report cracks, leaks, wrong deliveries or workmanship problems with photos." />
        </Card>
      ) : (
        <div className="grid gap-3">
          {shown.map((i) => {
            const s = SEVERITY[i.severity as keyof typeof SEVERITY] ?? SEVERITY.medium;
            const overdue = i.status !== 'resolved' && i.dueDate && i.dueDate < today;
            return (
              <Card key={i.id} className="flex cursor-pointer gap-4 p-4 transition hover:border-stone-300 dark:hover:border-stone-700" onClick={() => setEditing(i)}>
                <s.icon className="mt-0.5 size-5 shrink-0" style={{ color: s.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={i.status === 'resolved' ? 'font-medium text-stone-400 line-through' : 'font-medium'}>{i.title}</p>
                    <Badge tone={i.severity === 'critical' ? 'red' : i.severity === 'high' ? 'amber' : 'neutral'}>{IssueSeverities.label(i.severity)}</Badge>
                    <Badge tone={i.status === 'resolved' ? 'green' : i.status === 'in_progress' ? 'blue' : 'neutral'}>{IssueStatuses.label(i.status)}</Badge>
                  </div>
                  {i.description && <p className="mt-1 line-clamp-2 text-sm text-stone-600 dark:text-stone-400">{i.description}</p>}
                  <p className="mt-2 text-xs text-stone-500">
                    {[
                      `Reported ${formatDate(i.createdAt.slice(0, 10))}`,
                      i.assignee && `Assigned to ${i.assignee}`,
                      i.phaseId && lookups.names.phases.get(i.phaseId),
                      i.dueDate && `${overdue ? 'Overdue - was due' : 'Due'} ${formatDate(i.dueDate)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => {
          setPending([]);
          setEditing(null);
        }}
        title={existing ? 'Issue' : 'Report an issue'}
        fields={[
          { name: 'title', label: 'What’s wrong?', type: 'text', required: true, span: 2 },
          { name: 'severity', label: 'Severity', type: 'select', options: IssueSeverities.list, required: true },
          { name: 'status', label: 'Status', type: 'select', options: IssueStatuses.list, required: true },
          { name: 'assignee', label: 'Who will fix it', type: 'text' },
          { name: 'dueDate', label: 'Fix by', type: 'date' },
          { name: 'phaseId', label: 'Phase', type: 'select', options: lookups.options.phases, span: 2 },
          { name: 'description', label: 'Details', type: 'textarea', rows: 3 },
          ...(!existing && canEdit ? [{ type: 'custom' as const, name: 'files', render: () => <PendingFilesPicker files={pending} onChange={setPending} /> }] : []),
        ]}
        initial={existing ?? { severity: 'medium', status: 'open' }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm('Delete this issue?', existing.title))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (p) => {
          if (existing) await update.mutateAsync({ id: existing.id, ...p });
          else {
            const created = await create.mutateAsync(p);
            for (const f of pending) await uploadFile(upload, f, { entityType: 'issue', entityId: created.id, category: 'photo' }).catch((e) => toast.error(errorMessage(e)));
            setPending([]);
          }
          setEditing(null);
        }}
      >
        {existing && <Attachments entityType="issue" entityId={existing.id} label="Photos" />}
      </FormModal>
    </>
  );
}

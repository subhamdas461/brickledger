import { Weathers, formatDate, todayIso, type DailyLog, type FileItem } from '@brickledger/shared/web';
import { BookOpen, Cloud, CloudLightning, CloudRain, Plus, Snowflake, Sun, Thermometer, TriangleExclamationPoint, Users } from 'lucide-react';
import { useState } from 'react';
import { FormModal } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { useList, useResourceMutations, useUpload } from '../../lib/queries';
import { Attachments, FileThumb, PendingFilesPicker, uploadFile, useCanDelete } from './common';

const WEATHER_ICON = { sunny: Sun, cloudy: Cloud, rainy: CloudRain, stormy: CloudLightning, hot: Thermometer, cold: Snowflake } as const;

export function Diary() {
  const { pid, canEdit } = useProjectCtx();
  const logs = useList(pid, 'logs', { limit: 200 });
  const photos = useList(pid, 'files', { entityType: 'log', limit: 1000 });
  const { create, update, remove } = useResourceMutations(pid, 'logs');
  const upload = useUpload(pid);
  const [editing, setEditing] = useState<DailyLog | 'new' | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const existing = editing && editing !== 'new' ? editing : null;
  const canDelete = useCanDelete(existing);
  if (!logs.data) return <Spinner />;

  const photosBy = new Map<string, FileItem[]>();
  for (const f of photos.data?.items ?? []) if (f.entityId) photosBy.set(f.entityId, [...(photosBy.get(f.entityId) ?? []), f]);

  return (
    <>
      {dialog}
      <PageHeader
        title="Site diary"
        description="A daily record of work, weather, labour and problems - your memory when disputes come up."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Today’s entry
            </Button>
          )
        }
      />
      {logs.data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen />} title="No diary entries yet" description="Write a few lines at the end of each day - with photos." action={canEdit ? <Button onClick={() => setEditing('new')}>Write first entry</Button> : undefined} />
        </Card>
      ) : (
        <ol className="relative space-y-4 border-l border-stone-200 pl-6 dark:border-stone-800">
          {logs.data.items.map((log) => {
            const W = log.weather ? WEATHER_ICON[log.weather as keyof typeof WEATHER_ICON] : null;
            const pics = photosBy.get(log.id) ?? [];
            return (
              <li key={log.id} className="relative">
                <span className="absolute -left-[31px] top-5 size-3 rounded-full border-2 border-white bg-brand-500 dark:border-stone-950" />
                <Card className="cursor-pointer p-5 transition hover:border-stone-300 dark:hover:border-stone-700" onClick={() => setEditing(log)}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <p className="font-semibold">{formatDate(log.date)}</p>
                    {W && (
                      <span className="flex items-center gap-1.5 text-stone-500">
                        <W className="size-4" />
                        {Weathers.label(log.weather)}
                      </span>
                    )}
                    {log.labourCount != null && (
                      <span className="flex items-center gap-1.5 text-stone-500">
                        <Users className="size-4" />
                        {log.labourCount} on site
                      </span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-700 dark:text-stone-300">{log.workDone}</p>
                  {log.issues && (
                    <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                      <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0" />
                      {log.issues}
                    </p>
                  )}
                  {pics.length > 0 && (
                    <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6" onClick={(e) => e.stopPropagation()}>
                      {pics.slice(0, 6).map((f) => (
                        <FileThumb key={f.id} file={f} className="aspect-square" />
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
      <FormModal
        key={existing?.id ?? String(editing)}
        open={Boolean(editing)}
        onClose={() => {
          setPending([]);
          setEditing(null);
        }}
        title={existing ? `Diary · ${formatDate(existing.date)}` : 'New diary entry'}
        fields={[
          { name: 'date', label: 'Date', type: 'date', required: true },
          { name: 'weather', label: 'Weather', type: 'select', options: Weathers.list },
          { name: 'labourCount', label: 'People on site', type: 'number', step: 1, min: 0 },
          { name: 'workDone', label: 'Work done today', type: 'textarea', required: true, rows: 4, placeholder: 'e.g. Brickwork on first floor east wall, curing of slab…' },
          { name: 'issues', label: 'Problems / delays', type: 'textarea', rows: 2 },
          { name: 'notes', label: 'Other notes', type: 'textarea', rows: 2 },
          ...(!existing && canEdit ? [{ type: 'custom' as const, name: 'files', render: () => <PendingFilesPicker files={pending} onChange={setPending} /> }] : []),
        ]}
        initial={existing ?? { date: todayIso() }}
        onDelete={
          existing && canDelete
            ? async () => {
                if (!(await confirm('Delete this entry?', 'Attached photos stay in Documents.'))) return;
                await remove.mutateAsync(existing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (p) => {
          if (existing) await update.mutateAsync({ id: existing.id, ...p });
          else {
            const created = await create.mutateAsync(p);
            for (const f of pending) await uploadFile(upload, f, { entityType: 'log', entityId: created.id, category: 'photo' }).catch((e) => toast.error(errorMessage(e)));
            setPending([]);
          }
          setEditing(null);
        }}
      >
        {existing && <Attachments entityType="log" entityId={existing.id} label="Site photos" />}
      </FormModal>
    </>
  );
}

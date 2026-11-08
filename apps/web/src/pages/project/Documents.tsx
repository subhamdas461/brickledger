import { FileCategories, formatBytes, formatDate, todayIso, addDaysIso, type FileItem } from '@brickledger/shared/web';
import { FolderOpen, Pencil, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { FormModal } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useList, useResourceMutations, useUpload } from '../../lib/queries';
import { FileThumb, uploadFile, useCanDelete } from './common';

export function Documents() {
  const { pid, canEdit } = useProjectCtx();
  const [category, setCategory] = useState('');
  const files = useList(pid, 'files', { category, limit: 1000 });
  const upload = useUpload(pid);
  const { update, remove } = useResourceMutations(pid, 'files');
  const [editing, setEditing] = useState<FileItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const canDelete = useCanDelete(editing);

  async function handle(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      try {
        await uploadFile(upload, f, { entityType: 'document', category: category || (f.type.startsWith('image/') ? 'photo' : 'other') });
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
  }

  const items = files.data?.items ?? [];
  const today = todayIso();
  const soon = addDaysIso(today, 30);

  return (
    <>
      {dialog}
      <PageHeader
        title="Documents & photos"
        description="Drawings, approvals, agreements, warranties and every site photo in one place."
        actions={
          canEdit && (
            <>
              <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void handle(e.target.files).then(() => (e.target.value = ''))} />
              <Button icon={<Upload className="size-4" />} loading={upload.isPending} onClick={() => input.current?.click()}>
                Upload
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {[{ value: '', label: 'All' }, ...FileCategories.list].map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition',
              category === c.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (canEdit) void handle(e.dataTransfer.files);
        }}
        className={cn('rounded-3xl transition', dragging && 'bg-brand-50 ring-2 ring-dashed ring-brand-400 dark:bg-brand-500/10')}
      >
        {!files.data ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState icon={<FolderOpen />} title="Nothing here yet" description={canEdit ? 'Drop files here or use Upload. Images are compressed automatically.' : 'No files have been shared yet.'} />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((f) => {
              const expiring = f.expiresOn && f.expiresOn <= soon;
              return (
                <Card key={f.id} className="group overflow-hidden">
                  <FileThumb file={f} className="aspect-[4/3] rounded-none border-0 border-b" />
                  <div className="flex items-start gap-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={f.name}>
                        {f.name}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {FileCategories.label(f.category)} · {formatBytes(f.sizeBytes)}
                      </p>
                      {f.expiresOn && (
                        <Badge tone={f.expiresOn < today ? 'red' : expiring ? 'amber' : 'neutral'} className="mt-1.5">
                          {f.expiresOn < today ? 'Expired' : 'Expires'} {formatDate(f.expiresOn)}
                        </Badge>
                      )}
                    </div>
                    {canEdit && (
                      <button aria-label={`Edit ${f.name}`} onClick={() => setEditing(f)} className="rounded-lg p-1.5 text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-stone-700 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-stone-800">
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <FormModal
        key={editing?.id ?? 'none'}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="File details"
        fields={[
          { name: 'name', label: 'Name', type: 'text', required: true, span: 2 },
          { name: 'category', label: 'Category', type: 'select', options: FileCategories.list, required: true },
          { name: 'expiresOn', label: 'Valid until', type: 'date', hint: 'For permits, insurance and warranties - you’ll get a reminder.' },
          { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
        ]}
        initial={editing ?? {}}
        onDelete={
          editing && canDelete
            ? async () => {
                if (!(await confirm(`Delete ${editing.name}?`, 'The file is permanently removed from storage.'))) return;
                await remove.mutateAsync(editing.id).catch((e) => toast.error(errorMessage(e)));
                setEditing(null);
              }
            : undefined
        }
        onSubmit={async (p) => {
          await update.mutateAsync({ id: editing!.id, ...p });
          setEditing(null);
        }}
      />
    </>
  );
}

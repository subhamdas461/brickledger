import { formatBytes, formatMoney, formatMoneyCompact, type FileItem } from '@brickledger/shared/web';
import {
  Box,
  BrickWall,
  Columns3,
  DoorOpen,
  Droplet,
  File,
  FileText,
  Grid3x3,
  HardHat,
  House,
  ImagePlus,
  Lamp,
  Paintbrush,
  Ruler,
  Shovel,
  Stamp,
  Zap,
} from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { compressImage } from '../../lib/image';
import { useList, useUpload } from '../../lib/queries';
import { FileViewer } from './FileViewer';

/** Mirrors the server rule: managers delete anything, contributors only what they created. */
export function useCanDelete(entity: { createdBy: string | null } | null | undefined): boolean {
  const { isManager, canEdit } = useProjectCtx();
  const { me } = useAuth();
  if (!entity) return false;
  return isManager || (canEdit && entity.createdBy === me?.user.id);
}

export function useMoney() {
  const { currency } = useProjectCtx();
  return {
    money: (n: number | null | undefined) => formatMoney(n ?? 0, currency),
    compact: (n: number | null | undefined) => formatMoneyCompact(n ?? 0, currency),
    currency,
  };
}

const ICONS: Record<string, typeof House> = {
  stamp: Stamp,
  ruler: Ruler,
  shovel: Shovel,
  columns: Columns3,
  brick: BrickWall,
  hardhat: HardHat,
  roof: House,
  door: DoorOpen,
  bolt: Zap,
  droplet: Droplet,
  grid: Grid3x3,
  paint: Paintbrush,
  lamp: Lamp,
  box: Box,
};

export function CategoryIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const Icon = (icon && ICONS[icon]) || Box;
  return <Icon className={cn('size-4', className)} />;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/** Plain, accessible data table with right-aligned tabular numbers. */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, footer }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: ReactNode; footer?: ReactNode }) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left dark:border-stone-800">
            {columns.map((c) => (
              <th key={c.key} className={cn('whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-400', c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn(onRowClick && 'cursor-pointer transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/40')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'tabular text-right', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-2">{children}</div>;
}

/** Uploads one file (images are compressed first). Metadata fields go before the file part. */
export async function uploadFile(
  upload: ReturnType<typeof useUpload>,
  file: File,
  meta: { entityType?: string; entityId?: string; category?: string; name?: string; expiresOn?: string },
) {
  const prepared = await compressImage(file);
  const form = new FormData();
  for (const [k, v] of Object.entries(meta)) if (v) form.append(k, v);
  form.append('file', prepared, prepared.name);
  return upload.mutateAsync(form);
}

/** A file's thumbnail. With `onOpen` it opens the in-page viewer; without, the file in a new tab. */
export function FileThumb({ file, className, onOpen }: { file: FileItem; className?: string; onOpen?: () => void }) {
  const isImage = file.mimeType.startsWith('image/');
  const classes = cn(
    'group relative block w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-stone-700 dark:bg-stone-800',
    onOpen && 'cursor-zoom-in',
    className,
  );
  const inner = isImage ? (
    <img src={file.url} alt={file.name} loading="lazy" className="size-full object-cover transition group-hover:scale-[1.03]" />
  ) : (
    <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
      {file.mimeType === 'application/pdf' ? <FileText className="size-6 text-red-500" /> : <File className="size-6 text-stone-400" />}
      <span className="line-clamp-2 text-[11px] text-stone-600 dark:text-stone-300">{file.name}</span>
    </div>
  );
  const title = `${file.name} · ${formatBytes(file.sizeBytes)}`;
  if (onOpen) {
    return (
      <button type="button" title={title} aria-label={`View ${file.name}`} onClick={onOpen} className={classes}>
        {inner}
      </button>
    );
  }
  return (
    <a href={file.url} target="_blank" rel="noreferrer" title={title} className={classes}>
      {inner}
    </a>
  );
}

/** Photos/receipts attached to an entity: tap one to view, edit, replace or delete it. */
export function Attachments({ entityType, entityId, label = 'Photos & receipts' }: { entityType: string; entityId: string; label?: string }) {
  const { pid, canEdit } = useProjectCtx();
  const files = useList(pid, 'files', { entityType, entityId }, Boolean(entityId));
  const upload = useUpload(pid);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const items = files.data?.items ?? [];
  return (
    <div className="mt-6 border-t border-stone-100 pt-5 dark:border-stone-800">
      <FileViewer files={items} openId={viewing} onOpen={setViewing} onClose={closeViewer} noun={entityType === 'expense' ? 'bill' : 'photo'} />
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</p>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={async (e) => {
                const chosen = Array.from(e.target.files ?? []);
                e.target.value = '';
                for (const f of chosen) {
                  try {
                    await uploadFile(upload, f, { entityType, entityId, category: f.type.startsWith('image/') ? (entityType === 'expense' ? 'receipt' : 'photo') : 'invoice' });
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }
              }}
            />
            <Button size="sm" variant="secondary" icon={<ImagePlus className="size-3.5" />} loading={upload.isPending} onClick={() => input.current?.click()}>
              Add
            </Button>
          </>
        )}
      </div>
      {items.length ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {items.map((f) => (
            <FileThumb key={f.id} file={f} className="aspect-square" onOpen={() => setViewing(f.id)} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-stone-500">Nothing attached yet.</p>
      )}
    </div>
  );
}

/** Picks files for an entity that doesn't exist yet; uploaded right after it is created. */
export function PendingFilesPicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700">
      <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onChange([...files, ...Array.from(e.target.files ?? [])])} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={<ImagePlus className="size-3.5" />} onClick={() => input.current?.click()}>
          Attach receipt / photo
        </Button>
        {files.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 text-xs dark:bg-stone-800">
            {f.name}
            <button type="button" aria-label={`Remove ${f.name}`} className="text-stone-400 hover:text-stone-700" onClick={() => onChange(files.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

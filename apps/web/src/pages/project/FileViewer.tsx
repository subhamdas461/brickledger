import { FileCategories, formatBytes, formatDate, type FileItem } from '@brickledger/shared/web';
import { ChevronLeft, ChevronRight, Download, File as FileIcon, FileText, ImageOff, ImageUp, LoaderCircle, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FormModal, type FieldDef } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { useConfirm } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useReplaceFile, useResourceMutations } from '../../lib/queries';
import { useCanDelete } from './common';

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Full-screen viewer for photos, bills and documents, with edit, replace and delete.
 * `openId` picks the file; arrows, swipes and ← → move through `files`.
 */
export function FileViewer({ files, openId, onOpen, onClose, noun = 'file' }: { files: FileItem[]; openId: string | null; onOpen: (id: string) => void; onClose: () => void; noun?: string }) {
  const index = openId ? files.findIndex((f) => f.id === openId) : -1;
  const file = index >= 0 ? files[index]! : null;
  const ref = useRef<HTMLDialogElement>(null);
  const open = Boolean(file);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  // The file was deleted elsewhere, or the list moved on: nothing left to show.
  useEffect(() => {
    if (openId && files.length && index < 0) onClose();
  }, [openId, files.length, index, onClose]);

  const go = (delta: number) => {
    const next = files[index + delta];
    if (next) onOpen(next.id);
  };
  const goRef = useRef(go);
  goRef.current = go;
  // ← → on the whole page: moving to another file swaps the buttons, so focus can leave the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      // Keys belong to an edit or delete window open on top.
      if (!el || e.defaultPrevented || isTyping(e.target) || el.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowLeft') goRef.current(-1);
      if (e.key === 'ArrowRight') goRef.current(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!file) return null;
  return (
    <dialog
      ref={ref}
      aria-label={file.name}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      // Full screen fades in; the pop-in that suits small windows looks like a glitch at this size.
      style={{ animation: 'var(--animate-fade-in)' }}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-stone-950 p-0 text-stone-100 backdrop:bg-black/80"
    >
      <Viewer key={file.id} file={file} position={files.length > 1 ? `${index + 1} of ${files.length}` : null} noun={noun} onClose={onClose} onPrev={index > 0 ? () => go(-1) : undefined} onNext={index < files.length - 1 ? () => go(1) : undefined} onDeleted={() => {
        const neighbour = files[index + 1] ?? files[index - 1];
        if (neighbour) onOpen(neighbour.id);
        else onClose();
      }} />
    </dialog>
  );
}

function Viewer({ file, position, noun, onClose, onPrev, onNext, onDeleted }: { file: FileItem; position: string | null; noun: string; onClose: () => void; onPrev?: () => void; onNext?: () => void; onDeleted: () => void }) {
  const { pid, canEdit } = useProjectCtx();
  const canReplace = useCanDelete(file); // replacing destroys the original, so it follows the delete rule
  const { update, remove } = useResourceMutations(pid, 'files');
  const replace = useReplaceFile(pid);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const swipe = useRef<number | null>(null);
  const standalone = !file.entityType || file.entityType === 'document';

  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, span: 2 },
    { name: 'category', label: 'Type', type: 'select', options: FileCategories.list, required: true },
    ...(standalone ? [{ name: 'expiresOn', label: 'Valid until', type: 'date' as const, hint: 'For permits, insurance and warranties - you’ll get a reminder.' }] : []),
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, span: 2 },
  ];

  async function onReplace(chosen: File | undefined) {
    if (!chosen) return;
    try {
      await replace.mutateAsync({ id: file.id, file: chosen });
      toast.success(`${capital(noun)} replaced`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function onDelete() {
    if (!(await confirm(`Delete this ${noun}?`, `“${file.name}” is removed for everyone on the project. This can’t be undone.`))) return;
    try {
      await remove.mutateAsync(file.id);
      toast.success(`${capital(noun)} deleted`);
      onDeleted();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-1 border-b border-white/10 px-2 py-2 sm:gap-2 sm:px-4">
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-semibold">{file.name}</p>
            <p className="truncate text-xs text-stone-400">{[position, FileCategories.label(file.category), formatBytes(file.sizeBytes), formatDate(file.createdAt)].filter(Boolean).join(' · ')}</p>
          </div>
          {canEdit && <Tool icon={<Pencil className="size-4" />} label="Edit" onClick={() => setEditing(true)} />}
          {canReplace && (
            <>
              <input ref={picker} type="file" accept="image/*,application/pdf" hidden onChange={(e) => {
                const chosen = e.target.files?.[0];
                e.target.value = '';
                void onReplace(chosen);
              }} />
              <Tool icon={replace.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ImageUp className="size-4" />} label="Replace" disabled={replace.isPending} onClick={() => picker.current?.click()} />
            </>
          )}
          <a href={`${file.url}&download=1`} download={file.fileName} aria-label="Download" title="Download" className={toolClass}>
            <Download className="size-4" />
            <span className="hidden sm:inline">Download</span>
          </a>
          {canReplace && <Tool icon={<Trash2 className="size-4" />} label="Delete" danger onClick={() => void onDelete()} />}
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className="ml-1 rounded-xl p-2 text-stone-300 hover:bg-white/10 hover:text-white">
            <X className="size-5" />
          </button>
        </header>

        <div
          className="relative min-h-0 flex-1"
          onTouchStart={(e) => (swipe.current = e.touches.length === 1 && !zoomed ? e.touches[0]!.clientX : null)}
          onTouchEnd={(e) => {
            if (swipe.current === null) return;
            const dx = e.changedTouches[0]!.clientX - swipe.current;
            swipe.current = null;
            if (dx > 60) onPrev?.();
            if (dx < -60) onNext?.();
          }}
        >
          <Preview key={file.url} file={file} onZoomChange={setZoomed} />
          {replace.isPending && (
            <div className="absolute inset-0 grid place-items-center bg-stone-950/70 text-sm text-stone-200">
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-5 animate-spin" /> Uploading the new {noun}…
              </span>
            </div>
          )}
          {onPrev && <Arrow side="left" onClick={onPrev} />}
          {onNext && <Arrow side="right" onClick={onNext} />}
        </div>
        {file.notes && <p className="border-t border-white/10 px-4 py-2.5 text-sm text-stone-300">{file.notes}</p>}
      </div>

      {dialog}
      <FormModal
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${noun}`}
        fields={fields}
        initial={file}
        submitLabel="Save"
        onSubmit={async (p) => {
          await update.mutateAsync({ id: file.id, ...p });
          toast.success('Saved');
          setEditing(false);
        }}
      />
    </>
  );
}

const toolClass = 'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium text-stone-200 transition hover:bg-white/10 hover:text-white disabled:opacity-50';

function Tool({ icon, label, onClick, danger, disabled }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cn(toolClass, danger && 'text-red-300 hover:bg-red-500/20 hover:text-red-200')}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Arrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous' : 'Next'}
      onClick={onClick}
      className={cn('absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-stone-800/80 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-stone-700', side === 'left' ? 'left-2 sm:left-4' : 'right-2 sm:right-4')}
    >
      <Icon className="size-6" />
    </button>
  );
}

/** Images fit the screen; a click zooms in where you clicked (handy for reading bills). PDFs show inline on wide screens. */
function Preview({ file, onZoomChange }: { file: FileItem; onZoomChange: (zoomed: boolean) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState<{ width: number; fx: number; fy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!zoom || !el) return;
    const img = el.querySelector('img');
    if (!img) return;
    el.scrollLeft = zoom.fx * img.offsetWidth - el.clientWidth / 2;
    el.scrollTop = zoom.fy * img.offsetHeight - el.clientHeight / 2;
  }, [zoom]);
  useEffect(() => onZoomChange(Boolean(zoom)), [zoom, onZoomChange]);

  if (file.mimeType.startsWith('image/')) {
    if (state === 'error') return <Fallback file={file} icon={<ImageOff className="size-10" />} text="This image couldn’t be shown." />;
    return (
      <div ref={box} className={cn('absolute inset-0', zoom ? 'overflow-auto' : 'flex items-center justify-center p-3 sm:p-6')}>
        {state === 'loading' && <LoaderCircle className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 animate-spin text-stone-500" />}
        <img
          src={file.url}
          alt={file.name}
          draggable={false}
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
          onClick={(e) => {
            if (zoom) return setZoom(null);
            const r = e.currentTarget.getBoundingClientRect();
            // 2.5x, or the photo's full resolution when that's sharper (up to 4x).
            const width = Math.max(r.width * 2.5, Math.min(e.currentTarget.naturalWidth, r.width * 4));
            setZoom({ width, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
          }}
          style={zoom ? { width: zoom.width, maxWidth: 'none' } : undefined}
          className={cn('select-none rounded-lg', zoom ? 'cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain', state !== 'ready' && 'opacity-0')}
        />
      </div>
    );
  }
  if (file.mimeType === 'application/pdf') {
    return (
      <div className="absolute inset-0">
        <iframe src={file.url} title={file.name} className="hidden size-full bg-white md:block" />
        <div className="size-full md:hidden">
          <Fallback file={file} icon={<FileText className="size-10 text-red-400" />} text="PDF document" />
        </div>
      </div>
    );
  }
  return <Fallback file={file} icon={<FileIcon className="size-10" />} text="No preview for this file type." />;
}

function Fallback({ file, icon, text }: { file: FileItem; icon: ReactNode; text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-stone-400">
      {icon}
      <p className="text-sm">{text}</p>
      <a href={file.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20">
        Open {file.fileName || file.name}
      </a>
    </div>
  );
}

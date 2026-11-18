import { ENTITY_SECTION, activityWords, formatDate, type NotificationItem, type NotificationsResponse } from '@brickledger/shared/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, LoaderCircle, MonitorSmartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { storage } from '../lib/storage';
import { Avatar } from './ui/surface';

const COUNT_KEY = ['notifications', 'count'] as const;
const LIST_KEY = ['notifications', 'list'] as const;
const DESKTOP_PREF = 'bl-desktop-alerts';
const PAGE = 30;

/** Where a notification leads: its project page, and the expense itself when it still exists. */
export function notificationLink(n: Pick<NotificationItem, 'projectId' | 'entityType' | 'entityId' | 'action'>) {
  const section = ENTITY_SECTION[n.entityType] ?? '';
  const base = `/app/p/${n.projectId}${section ? `/${section}` : ''}`;
  return n.entityType === 'expenses' && n.entityId && n.action !== 'delete' ? `${base}?open=${n.entityId}` : base;
}

/** "added ₹21,000 · Cement" — the words after the person's name. */
function words(n: NotificationItem) {
  return activityWords(n.summary, n.user?.name);
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return formatDate(iso);
}

function desktopAlertsOn() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted' && storage.get(DESKTOP_PREF) === '1';
}

/**
 * Bell with the unread count; opens the list of changes other members made in your projects.
 * Checks every minute (also in a background tab, so desktop alerts arrive).
 */
export function NotificationBell({ placement }: { placement: 'sidebar' | 'header' }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const count = useQuery({
    queryKey: COUNT_KEY,
    queryFn: () => api<{ unread: number; latestId: number }>('/notifications/count'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const unread = count.data?.unread ?? 0;

  // Desktop alerts for changes that arrive while this tab is in the background.
  const lastSeen = useRef<number | null>(null);
  useEffect(() => {
    const latest = count.data?.latestId;
    if (latest === undefined) return;
    const previous = lastSeen.current;
    lastSeen.current = latest;
    if (previous === null || latest <= previous || !desktopAlertsOn() || document.visibilityState === 'visible') return;
    void api<NotificationsResponse>('/notifications', { query: { after: previous, limit: 5 } }).then((res) => {
      for (const n of res.items.slice(0, 3)) {
        const alert = new Notification(n.projectName || 'BrickLedger', { body: `${n.user?.name ?? 'Someone'}${words(n)}`, tag: `bl-${n.id}`, icon: '/favicon.svg' });
        alert.onclick = () => {
          window.focus();
          navigate(notificationLink(n));
          alert.close();
        };
      }
    });
  }, [count.data?.latestId, navigate]);

  // Opening the panel elsewhere (other tab, phone) also clears the badge here on the next check.
  useEffect(() => {
    if (!open) void qc.invalidateQueries({ queryKey: LIST_KEY });
  }, [open, qc]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications: ${unread > 99 ? '99+' : unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-stone-950">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && <NotificationPanel placement={placement} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NotificationPanel({ placement, onClose }: { placement: 'sidebar' | 'header'; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(PAGE);
  const [desktop, setDesktop] = useState(desktopAlertsOn);
  const list = useQuery({
    queryKey: [...LIST_KEY, limit],
    queryFn: () => api<NotificationsResponse>('/notifications', { query: { limit } }),
    placeholderData: (prev) => prev,
  });
  const markRead = useMutation({
    mutationFn: (upTo?: number) => api<{ unread: number; latestId: number }>('/notifications/read', { method: 'POST', body: upTo === undefined ? {} : { upTo } }),
    onSuccess: (res) => qc.setQueryData(COUNT_KEY, res),
  });

  // Seeing the list counts as reading it; the "new" highlights stay until the panel closes.
  const latestId = list.data?.latestId;
  const marked = useRef(false);
  useEffect(() => {
    if (latestId === undefined || marked.current) return;
    marked.current = true;
    if ((list.data?.unread ?? 0) > 0) markRead.mutate(latestId);
  }, [latestId, list.data?.unread, markRead]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current && !panel.current.contains(target) && !(target as HTMLElement).closest?.('[aria-label^="Notifications"]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  async function toggleDesktop() {
    if (desktop) {
      storage.remove(DESKTOP_PREF);
      setDesktop(false);
      return;
    }
    const permission = typeof Notification === 'undefined' ? 'denied' : await Notification.requestPermission();
    if (permission === 'granted') {
      storage.set(DESKTOP_PREF, '1');
      setDesktop(true);
    }
  }

  const items = list.data?.items ?? [];
  const groups = new Map<string, NotificationItem[]>();
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');
  for (const n of items) {
    const day = new Date(n.createdAt).toLocaleDateString('en-CA');
    const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : formatDate(day);
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied' && !desktop;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Notifications"
      className={cn(
        'z-50 flex animate-pop-in flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white text-stone-900 shadow-2xl shadow-stone-900/15 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100',
        placement === 'sidebar' ? 'fixed left-[16.75rem] top-3 max-h-[calc(100dvh-1.5rem)] w-[400px]' : 'fixed inset-x-3 top-16 max-h-[calc(100dvh-5rem)]',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 dark:border-stone-800">
        <h2 className="text-base font-semibold">Notifications</h2>
        <button
          type="button"
          onClick={() => markRead.mutate(undefined)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <CheckCheck className="size-3.5" />
          Mark all read
        </button>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {!list.data ? (
          <div className="grid place-items-center py-14">
            <LoaderCircle className="size-6 animate-spin text-stone-400" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Bell className="mx-auto size-8 text-stone-300" />
            <p className="mt-3 text-sm font-medium">You’re all caught up</p>
            <p className="mt-1 text-xs text-stone-500">When your team adds or changes anything in your projects, it shows up here.</p>
          </div>
        ) : (
          [...groups.entries()].map(([label, group]) => (
            <section key={label}>
              <h3 className="sticky top-0 bg-white/95 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 backdrop-blur dark:bg-stone-900/95">{label}</h3>
              <ul>
                {group.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate(notificationLink(n));
                      }}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50',
                        n.unread && 'bg-brand-50/60 dark:bg-brand-500/[0.07]',
                      )}
                    >
                      <Avatar name={n.user?.name ?? '?'} className="mt-0.5 size-8 shrink-0 text-[11px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug text-stone-700 dark:text-stone-300">
                          <span className="font-semibold text-stone-900 dark:text-white">{n.user?.name ?? 'Someone'}</span>
                          {words(n)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-stone-500">
                          {n.projectName} · {ago(n.createdAt)}
                        </span>
                      </span>
                      {n.unread && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand-600" aria-label="New" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {items.length >= limit && (
          <div className="p-3 text-center">
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              {list.isFetching ? 'Loading…' : 'Show older'}
            </button>
          </div>
        )}
      </div>

      {typeof Notification !== 'undefined' && (
        <div className="flex items-center gap-2 border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500 dark:border-stone-800">
          <MonitorSmartphone className="size-3.5 shrink-0" />
          <span className="flex-1">{blocked ? 'Desktop alerts are blocked in this browser’s site settings.' : 'Desktop alerts while this tab is in the background'}</span>
          {!blocked && (
            <button
              type="button"
              role="switch"
              aria-checked={desktop}
              aria-label="Desktop alerts"
              onClick={() => void toggleDesktop()}
              className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', desktop ? 'bg-brand-600' : 'bg-stone-300 dark:bg-stone-700')}
            >
              <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', desktop ? 'left-[18px]' : 'left-0.5')} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { PLANS, formatDate, type AdminUserDetail, type AdminUserRow, type PlanId } from '@brickledger/shared/web';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, KeyRound, LogOut, Pencil, Search, ShieldBan, ShieldCheck, Trash2, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { Avatar, Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { ApiError, api, downloadFile } from '../../lib/api';
import { Pager, Panel, actionLabel, count, detailLine, timeAgo, useAdmin } from './parts';

const planName = (plan: string | null) => (plan ? (PLANS[plan as PlanId]?.name ?? plan) : '-');

function StatusBadges({ user }: { user: { bannedAt: string | null; isSuperAdmin: boolean } }) {
  return (
    <>
      {user.isSuperAdmin && <Badge tone="violet">Super admin</Badge>}
      {user.bannedAt && <Badge tone="red">Banned</Badge>}
    </>
  );
}

export function Users() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [offset, setOffset] = useState(0);
  const toast = useToast();
  const limit = 25;

  // Search as you type, without a request for every key press.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(input.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [input]);

  const { data, isFetching } = useAdmin<{ items: AdminUserRow[]; total: number }>('/users', { q, status, sort, limit, offset });

  return (
    <>
      <PageHeader
        title="Accounts"
        description={data ? `${count(data.total)} ${data.total === 1 ? 'account' : 'accounts'}${q || status !== 'all' ? ' match' : ''}` : undefined}
        actions={
          <Button
            variant="secondary"
            icon={<Download className="size-4" />}
            onClick={() => downloadFile('/admin/users/export.csv', 'brickledger-users.csv', { q, status, sort }).catch(() => toast.error('Export failed. Please try again.'))}
          >
            Export CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <Input aria-label="Search accounts" placeholder="Search by name or email" value={input} onChange={(e) => setInput(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Filter by status" className="sm:w-40" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} options={[{ value: 'all', label: 'All accounts' }, { value: 'active', label: 'Not banned' }, { value: 'banned', label: 'Banned' }, { value: 'admin', label: 'Super admins' }]} />
        <Select aria-label="Sort by" className="sm:w-44" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }} options={[{ value: 'newest', label: 'Newest first' }, { value: 'lastSeen', label: 'Recently active' }, { value: 'name', label: 'Name A-Z' }]} />
      </div>

      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<UsersIcon className="size-6" />} title="No accounts found" description="Try a different name or email." />
        </Card>
      ) : (
        <Card className={isFetching ? 'overflow-hidden opacity-70 transition-opacity' : 'overflow-hidden'}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800">
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 text-right font-medium">Projects</th>
                  <th className="px-4 py-2.5 font-medium">Signed up</th>
                  <th className="px-4 py-2.5 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {data.items.map((u) => (
                  <tr key={u.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/40">
                    <td className="px-4 py-2.5">
                      <Link to={`/admin/users/${u.id}`} className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 font-medium text-stone-900 dark:text-stone-100">
                            {u.name} <StatusBadges user={u} />
                          </span>
                          <span className="block truncate text-xs text-stone-500">{u.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-stone-700 dark:text-stone-300">
                      {planName(u.plan)}
                      {u.trialing ? ' trial' : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-700 dark:text-stone-300">{count(u.projects)}</td>
                    <td className="px-4 py-2.5 text-stone-600 dark:text-stone-400">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-2.5 text-stone-600 dark:text-stone-400">{timeAgo(u.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </Card>
      )}
    </>
  );
}

type Dialog = 'ban' | 'edit' | 'delete' | 'signOut' | null;

export function UserDetail() {
  const { id = '' } = useParams();
  const { data: user, error, refetch } = useAdmin<AdminUserDetail>(`/users/${id}`);
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const [resetUrl, setResetUrl] = useState<string | null>(null);

  if (error instanceof ApiError && error.status === 404) {
    return <EmptyState title="Account not found" description="It may have been deleted." action={<Link className="text-sm font-medium text-brand-700 hover:underline" to="/admin/users">Back to accounts</Link>} />;
  }
  if (!user) return <Spinner />;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That didn’t work. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const path = `/admin/users/${user.id}`;
  return (
    <>
      <Link to="/admin/users" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-900 dark:hover:text-white">
        <ArrowLeft className="size-4" /> Accounts
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {user.name} <StatusBadges user={user} />
          </span>
        }
        description={user.email}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => { setForm({ name: user.name, email: user.email }); setDialog('edit'); }}>
              Edit
            </Button>
            <Button
              variant="secondary"
              icon={<KeyRound className="size-4" />}
              onClick={() => run(async () => setResetUrl((await api<{ url: string }>(`${path}/reset-link`, { method: 'POST' })).url), 'Reset link created')}
            >
              Reset link
            </Button>
            <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => setDialog('signOut')}>
              Sign out everywhere
            </Button>
            {!user.isSuperAdmin &&
              (user.bannedAt ? (
                <Button variant="secondary" icon={<ShieldCheck className="size-4" />} loading={busy} onClick={() => run(() => api(`${path}/unban`, { method: 'POST' }), 'Account unbanned')}>
                  Unban
                </Button>
              ) : (
                <Button variant="secondary" icon={<ShieldBan className="size-4" />} onClick={() => { setReason(''); setDialog('ban'); }}>
                  Ban
                </Button>
              ))}
            {!user.isSuperAdmin && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => { setConfirmEmail(''); setDialog('delete'); }}>
                Delete
              </Button>
            )}
          </div>
        }
      />

      {user.bannedAt && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100">
          <p className="font-semibold">Banned {timeAgo(user.bannedAt).toLowerCase()}</p>
          <p className="mt-1">{user.banReason}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ['Signed up', formatDate(user.createdAt)],
              ['Last active', timeAgo(user.lastSeenAt)],
              ['Last sign-in', timeAgo(user.lastLoginAt)],
              ['Phone', user.phone ?? '-'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-stone-500">{label}</dt>
                <dd className="text-right text-stone-900 dark:text-stone-100">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Workspaces">
          <ul className="mt-3 space-y-2 text-sm">
            {user.workspaces.length === 0 && <li className="text-stone-500">None</li>}
            {user.workspaces.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-stone-900 dark:text-stone-100">{w.name}</span>
                <span className="shrink-0 text-xs text-stone-500 capitalize">
                  {w.role} · {planName(w.plan)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Projects they own" subtitle="Names and counts only">
          <ul className="scroll-thin mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">
            {user.projects.length === 0 && <li className="text-stone-500">None</li>}
            {user.projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-stone-900 dark:text-stone-100">
                  {p.name} {p.isDemo && <span className="text-xs text-stone-500">(sample)</span>}
                </span>
                <span className="shrink-0 text-xs text-stone-500">
                  {count(p.expenses)} expenses · {count(p.members)} people
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Signed in on" subtitle={`${user.sessions.length} active ${user.sessions.length === 1 ? 'session' : 'sessions'}`}>
          <ul className="scroll-thin mt-3 max-h-64 space-y-3 overflow-y-auto text-sm">
            {user.sessions.length === 0 && <li className="text-stone-500">Not signed in anywhere.</li>}
            {user.sessions.map((s) => (
              <li key={s.id}>
                <p className="truncate text-stone-900 dark:text-stone-100">{s.userAgent ?? 'Unknown device'}</p>
                <p className="text-xs text-stone-500">
                  {s.ip ?? 'Unknown address'} · {timeAgo(s.lastUsedAt ?? s.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Admin actions on this account" className="lg:col-span-2">
          <ul className="mt-3 space-y-2 text-sm">
            {user.history.length === 0 && <li className="text-stone-500">None yet.</li>}
            {user.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="text-stone-900 dark:text-stone-100">
                  {actionLabel(h.action)}
                  {detailLine(h.details) && <span className="text-stone-500"> - {detailLine(h.details)}</span>}
                </span>
                <span className="text-xs text-stone-500">
                  {h.adminEmail} · {timeAgo(h.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Modal
        open={dialog === 'ban'}
        onClose={() => setDialog(null)}
        title={`Ban ${user.name}?`}
        description="They’re signed out everywhere within 30 seconds and can’t sign in. Their data stays, and people they share projects with keep access. You can undo this."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => run(() => api(`${path}/ban`, { method: 'POST', body: { reason: reason.trim() } }), 'Account banned')}>
              Ban account
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="Kept in the audit log. The user isn’t shown this." required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={dialog === 'signOut'}
        onClose={() => setDialog(null)}
        title="Sign out everywhere?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => run(() => api(`${path}/sign-out`, { method: 'POST' }), 'Signed out on all devices')}>Sign out</Button>
          </>
        }
      >
        <p className="text-sm text-stone-600 dark:text-stone-300">{user.name} will need to sign in again on every device. Nothing is deleted.</p>
      </Modal>

      <Modal
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        title="Edit account"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => run(() => api(path, { method: 'PATCH', body: form }), 'Account updated')}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email" hint="They’ll sign in with the new address."><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={`Delete ${user.name}?`}
        description="This can’t be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={confirmEmail.trim().toLowerCase() !== user.email}
              onClick={async () => {
                if (await run(() => api(path, { method: 'DELETE', body: { confirmEmail: confirmEmail.trim() } }), 'Account deleted')) navigate('/admin/users');
              }}
            >
              Delete forever
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Deletes this account and {user.workspaces.filter((w) => w.role === 'owner').length ? 'the workspaces it owns, with' : 'its'} {count(user.projects.length)} {user.projects.length === 1 ? 'project' : 'projects'} and all their files. Anyone sharing those projects loses them too. To keep the data, ban instead.
        </p>
        <Field className="mt-4" label={`Type ${user.email} to confirm`}>
          <Input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" />
        </Field>
      </Modal>

      <Modal
        open={Boolean(resetUrl)}
        onClose={() => { setResetUrl(null); void refetch(); }}
        title="Password reset link"
        description="Send this to the account owner. It works once and expires in an hour. It won’t be shown again."
        footer={<Button onClick={() => { setResetUrl(null); void refetch(); }}>Done</Button>}
      >
        <p className="rounded-xl bg-stone-100 p-3 font-mono text-xs break-all text-stone-800 dark:bg-stone-800 dark:text-stone-200">{resetUrl}</p>
        <Button
          className="mt-3"
          variant="secondary"
          icon={<Copy className="size-4" />}
          onClick={() => {
            void navigator.clipboard.writeText(resetUrl ?? '').then(() => toast.success('Link copied'));
          }}
        >
          Copy link
        </Button>
      </Modal>
    </>
  );
}

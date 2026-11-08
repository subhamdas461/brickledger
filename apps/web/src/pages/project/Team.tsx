import { ProjectRoleDescriptions, ProjectRoles, formatDate, type ProjectRole } from '@brickledger/shared/web';
import { useMutation } from '@tanstack/react-query';
import { Copy, MessageCircle, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/form';
import { Avatar, Badge, Card, CardHeader, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useMembers, useRefreshProject } from '../../lib/queries';

export function Team() {
  const { pid, project, isManager } = useProjectCtx();
  const members = useMembers(pid);
  const refresh = useRefreshProject(pid);
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<{ email: string; role: ProjectRole }>({ email: '', role: 'viewer' });
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const invite = useMutation({
    mutationFn: () => api<{ inviteUrl: string }>(`/projects/${pid}/invites`, { method: 'POST', body: form }),
    onSuccess: (res) => {
      setLink({ email: form.email, url: res.inviteUrl });
      setForm({ email: '', role: form.role });
      refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.isPlanLimit) toast.error(err.message, { label: 'Upgrade', onClick: () => navigate('/app/settings?tab=billing') });
      else toast.error(errorMessage(err));
    },
  });

  if (!members.data) return <Spinner />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate();
  };
  const whatsapp = (url: string) => `https://wa.me/?text=${encodeURIComponent(`Join "${project.name}" on BrickLedger to follow our house construction: ${url}`)}`;

  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader title="Team" description="Who can see and change this project." />
      {isManager && (
        <Card>
          <CardHeader title="Invite someone" subtitle="They’ll get an email - you can also share the link on WhatsApp." />
          <form onSubmit={submit} className="grid gap-3 p-5 sm:grid-cols-[1fr_180px_auto] sm:items-end">
            <Field label="Email">
              <Input type="email" required placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as ProjectRole })} options={ProjectRoles.list} />
            </Field>
            <Button type="submit" icon={<UserPlus className="size-4" />} loading={invite.isPending}>
              Invite
            </Button>
            <p className="text-xs text-stone-500 sm:col-span-3">{ProjectRoleDescriptions[form.role]}</p>
          </form>
          {link && (
            <div className="mx-5 mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="font-medium text-emerald-900 dark:text-emerald-200">Invitation sent to {link.email}</p>
              <p className="mt-1 break-all text-xs text-emerald-800/80 dark:text-emerald-200/70">{link.url}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy className="size-3.5" />}
                  onClick={async () => {
                    await navigator.clipboard.writeText(link.url).catch(() => undefined);
                    toast.success('Link copied');
                  }}
                >
                  Copy link
                </Button>
                <a href={whatsapp(link.url)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#25D366] px-3 text-xs font-semibold text-white hover:brightness-95">
                  <MessageCircle className="size-3.5" /> Share on WhatsApp
                </a>
              </div>
            </div>
          )}
        </Card>
      )}
      <Card>
        <CardHeader title={`Members (${members.data.members.length})`} />
        <ul className="divide-y divide-stone-100 p-2 dark:divide-stone-800">
          {members.data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-3">
              <Avatar name={m.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name} {m.userId === me?.user.id && <span className="text-stone-400">(you)</span>}
                </p>
                <p className="truncate text-xs text-stone-500">{m.email}</p>
              </div>
              {m.viaWorkspace ? (
                <Badge tone="brand">Workspace admin</Badge>
              ) : isManager && m.userId !== me?.user.id ? (
                <>
                  <Select
                    className="h-9 w-36"
                    value={m.role}
                    options={ProjectRoles.list}
                    onChange={async (e) => {
                      try {
                        await api(`/projects/${pid}/members/${m.userId}`, { method: 'PATCH', body: { role: e.target.value } });
                        refresh();
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!(await confirm(`Remove ${m.name}?`, 'They will immediately lose access to this project.', 'Remove'))) return;
                      await api(`/projects/${pid}/members/${m.userId}`, { method: 'DELETE' }).catch((err) => toast.error(errorMessage(err)));
                      refresh();
                    }}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <Badge>{ProjectRoles.label(m.role)}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {isManager && members.data.invites.length > 0 && (
        <Card>
          <CardHeader title="Pending invitations" />
          <ul className="divide-y divide-stone-100 p-2 dark:divide-stone-800">
            {members.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <Badge>{ProjectRoles.label(i.role)}</Badge>
                <span className="text-xs text-stone-500">Expires {formatDate(i.expiresAt.slice(0, 10))}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/projects/${pid}/invites/${i.id}`, { method: 'DELETE' }).catch((err) => toast.error(errorMessage(err)));
                    refresh();
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

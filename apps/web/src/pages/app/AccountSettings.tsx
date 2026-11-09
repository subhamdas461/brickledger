import { CURRENCIES, OrgRoles, PLANS, formatBytes, formatDate, type BillingInterval, type OrgDetail, type OrgMember, type PlanId } from '@brickledger/shared/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ExternalLink, LoaderCircle, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Meter } from '../../components/charts';
import { EntityForm, type FieldDef } from '../../components/entity-form';
import { PricingCards } from '../../components/pricing';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/form';
import { Tabs } from '../../components/ui/menu';
import { Avatar, Badge, Card, CardHeader, PageHeader, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage, setAccessToken } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { keys, useOrg, usePlans } from '../../lib/queries';

type Tab = 'profile' | 'workspace' | 'billing';

export function AccountSettings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'profile';
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={(t) => setParams(t === 'profile' ? {} : { tab: t })}
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'workspace', label: 'Workspace' },
          { value: 'billing', label: 'Plan & billing' },
        ]}
      />
      {tab === 'profile' && <Profile />}
      {tab === 'workspace' && <Workspace />}
      {tab === 'billing' && <Billing />}
    </div>
  );
}

function Profile() {
  const { me, reloadMe, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [deletePw, setDeletePw] = useState('');
  const { confirm, dialog } = useConfirm();
  const changePw = useMutation({
    mutationFn: () => api<{ accessToken: string }>('/me/password', { method: 'POST', body: pw }),
    onSuccess: (res) => {
      setAccessToken(res.accessToken);
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed. Other devices were signed out.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const fields: FieldDef[] = [
    { name: 'name', label: 'Full name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+91 98xxxxxxx' },
  ];
  if (!me) return null;
  return (
    <div className="space-y-6">
      {dialog}
      <Card>
        <CardHeader title="Your profile" subtitle={me.user.email} />
        <div className="p-5">
          <EntityForm
            formId="profile"
            fields={fields}
            initial={me.user}
            onSubmit={async (payload) => {
              await api('/me', { method: 'PATCH', body: payload });
              await reloadMe();
              toast.success('Profile saved');
            }}
          />
          <div className="mt-4 flex justify-end">
            <Button type="submit" form="profile">
              Save profile
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Change password" subtitle="You’ll stay signed in here; other devices are signed out." />
        <form
          className="grid gap-4 p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            changePw.mutate();
          }}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="secondary" loading={changePw.isPending} disabled={!pw.currentPassword || pw.newPassword.length < 8}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
      <Card className="border-red-200 dark:border-red-500/30">
        <CardHeader title="Delete account" subtitle="Permanently deletes your account and the workspaces you own, including all their projects and files." />
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <Field label="Confirm with your password" className="flex-1">
            <Input type="password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
          </Field>
          <Button
            variant="danger"
            icon={<Trash className="size-4" />}
            disabled={!deletePw}
            onClick={async () => {
              if (!(await confirm('Delete your account?', 'This cannot be undone. Projects in workspaces you own will be deleted for everyone.', 'Delete forever'))) return;
              try {
                await api('/me', { method: 'DELETE', body: { password: deletePw } });
                await logout();
                navigate('/');
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            Delete account
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Workspace() {
  const { me, currentOrg, setCurrentOrgId, reloadMe } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const org = useOrg(currentOrg?.id);
  const isAdmin = currentOrg?.role === 'owner' || currentOrg?.role === 'admin';
  const members = useQuery({
    queryKey: keys.orgMembers(currentOrg?.id ?? ''),
    queryFn: () => api<OrgMember[]>(`/orgs/${currentOrg!.id}/members`),
    enabled: Boolean(currentOrg && isAdmin),
  });
  const { confirm, dialog } = useConfirm();
  if (!me || !currentOrg) return null;
  return (
    <div className="space-y-6">
      {dialog}
      {me.orgs.length > 1 && (
        <Card className="p-5">
          <Field label="Active workspace" hint="New projects and billing apply to this workspace.">
            <Select value={currentOrg.id} onChange={(e) => setCurrentOrgId(e.target.value)} options={me.orgs.map((o) => ({ value: o.id, label: `${o.name} (${OrgRoles.label(o.role)})` }))} />
          </Field>
        </Card>
      )}
      {org.data && (
        <Card>
          <CardHeader title="Workspace details" subtitle={isAdmin ? 'Shown on invitations and reports.' : 'Only owners and admins can edit these.'} />
          <div className="p-5">
            <EntityForm
              key={org.data.id}
              formId="org"
              fields={[
                { name: 'name', label: 'Workspace name', type: 'text', required: true },
                { name: 'defaultCurrency', label: 'Default currency for new projects', type: 'select', required: true, options: CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })) },
              ]}
              initial={org.data}
              onSubmit={async (payload) => {
                await api(`/orgs/${currentOrg.id}`, { method: 'PATCH', body: payload });
                await Promise.all([reloadMe(), qc.invalidateQueries({ queryKey: keys.org(currentOrg.id) })]);
                toast.success('Workspace saved');
              }}
            />
            {isAdmin && (
              <div className="mt-4 flex justify-end">
                <Button type="submit" form="org">
                  Save
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
      {isAdmin && (
        <Card>
          <CardHeader title="People in this workspace" subtitle="Admins manage every project. Members only see projects they’re invited to." />
          <ul className="divide-y divide-stone-100 p-2 dark:divide-stone-800">
            {(members.data ?? []).map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-stone-500">
                    {m.email} · {m.projects} project{m.projects === 1 ? '' : 's'}
                  </p>
                </div>
                {m.role === 'owner' || currentOrg.role !== 'owner' ? (
                  <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'}>{OrgRoles.label(m.role)}</Badge>
                ) : (
                  <Select
                    className="h-9 w-32"
                    value={m.role}
                    options={[
                      { value: 'admin', label: 'Admin' },
                      { value: 'member', label: 'Member' },
                    ]}
                    onChange={async (e) => {
                      try {
                        await api(`/orgs/${currentOrg.id}/members/${m.userId}`, { method: 'PATCH', body: { role: e.target.value } });
                        void members.refetch();
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  />
                )}
                {m.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!(await confirm(`Remove ${m.name}?`, 'They will lose access to every project in this workspace.', 'Remove'))) return;
                      try {
                        await api(`/orgs/${currentOrg.id}/members/${m.userId}`, { method: 'DELETE' });
                        void members.refetch();
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function UsageRow({ label, used, limit, format = String }: { label: string; used: number; limit: number | null; format?: (n: number) => string }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-stone-600 dark:text-stone-300">{label}</span>
        <span className="tabular font-medium">
          {format(used)} {limit === null ? '· Unlimited' : `of ${format(limit)}`}
        </span>
      </div>
      {limit !== null && <Meter value={used} max={limit} />}
    </div>
  );
}

function Billing() {
  const { currentOrg, reloadMe } = useAuth();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const org = useOrg(currentOrg?.id);
  const plans = usePlans();
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [awaitingPayment, setAwaitingPayment] = useState<{ plan: Exclude<PlanId, 'free'>; interval: BillingInterval; until: number } | null>(null);
  const { confirm, dialog } = useConfirm();
  const isAdmin = currentOrg?.role === 'owner' || currentOrg?.role === 'admin';

  useEffect(() => {
    const outcome = params.get('checkout');
    if (!outcome) return;
    if (outcome === 'success') toast.success('Thanks! Your plan is being activated.');
    else toast.info('Checkout cancelled - no changes were made.');
    void reloadMe();
    void qc.invalidateQueries({ queryKey: keys.org(currentOrg?.id ?? '') });
    setParams({ tab: 'billing' }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Razorpay's payment page can't send people back here, so watch for the plan changing instead.
  useEffect(() => {
    if (!awaitingPayment) return;
    const d = org.data;
    if (d && d.effectivePlan === awaitingPayment.plan && d.planInterval === awaitingPayment.interval && d.planStatus === 'active') {
      setAwaitingPayment(null);
      toast.success(`Payment received. You’re on ${PLANS[awaitingPayment.plan].name} now.`);
      void reloadMe();
      return;
    }
    const poll = setInterval(() => {
      if (Date.now() > awaitingPayment.until) {
        setAwaitingPayment(null);
        toast.info('Still no payment confirmation. If you paid, your plan will update here shortly.');
      } else {
        void qc.invalidateQueries({ queryKey: keys.org(currentOrg?.id ?? '') });
      }
    }, 4000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingPayment, org.data]);

  if (!currentOrg || org.isLoading || !org.data) return <Spinner />;
  const o: OrgDetail = org.data;
  const plan = PLANS[o.effectivePlan];
  const trialDays = o.planStatus === 'trialing' && o.trialEndsAt ? Math.max(0, Math.ceil((Date.parse(o.trialEndsAt) - Date.now()) / 86_400_000)) : null;

  async function choose(planId: Exclude<PlanId, 'free'>, interval: BillingInterval) {
    if (plans.data?.provider === 'razorpay' && o.hasSubscription && o.planStatus === 'active' && o.effectivePlan !== 'free' && o.billingProvider !== 'mock') {
      const ok = await confirm('Switch plan?', 'Your current subscription stops as soon as you’ve paid for the new one, so you’re never billed for both. Unused days on the current plan aren’t refunded.', 'Continue');
      if (!ok) return;
    }
    // Opened right away: browsers block new tabs opened after waiting for a server reply.
    const paymentTab = plans.data?.provider === 'razorpay' ? window.open('', '_blank') : null;
    setBusyPlan(planId);
    try {
      const { url } = await api<{ url: string }>(`/orgs/${o.id}/billing/checkout`, { method: 'POST', body: { plan: planId, interval } });
      if (paymentTab) {
        paymentTab.opener = null;
        paymentTab.location.href = url;
        setAwaitingPayment({ plan: planId, interval, until: Date.now() + 15 * 60_000 });
        setBusyPlan(null);
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      paymentTab?.close();
      toast.error(errorMessage(err));
      setBusyPlan(null);
    }
  }

  return (
    <div className="space-y-6">
      {dialog}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-stone-500">Current plan · {o.name}</p>
            <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">
              {plan.name}
              {o.planStatus === 'trialing' && trialDays !== null && <Badge tone="brand">Trial · {trialDays} days left</Badge>}
              {o.planStatus === 'past_due' && <Badge tone="red">Payment due</Badge>}
              {o.planStatus === 'canceled' && o.plan !== 'free' && <Badge tone="amber">Cancelled</Badge>}
            </p>
            <p className="mt-1 text-sm text-stone-500">
              {o.planStatus === 'trialing' && o.trialEndsAt
                ? `Your trial ends on ${formatDate(o.trialEndsAt.slice(0, 10))}. You’ll move to Starter unless you upgrade.`
                : o.currentPeriodEnd && o.effectivePlan !== 'free'
                  ? `${o.planInterval === 'year' ? 'Yearly' : 'Monthly'} plan · renews ${formatDate(o.currentPeriodEnd.slice(0, 10))}`
                  : 'Free forever. Upgrade any time.'}
            </p>
          </div>
          {isAdmin && o.hasSubscription && o.effectivePlan !== 'free' && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                icon={<ExternalLink className="size-4" />}
                onClick={async () => {
                  try {
                    const res = await api<{ url: string | null }>(`/orgs/${o.id}/billing/portal`, { method: 'POST', body: {} });
                    if (res.url) window.location.assign(res.url);
                    else toast.info('Manage this subscription from your payment provider’s emails, or cancel below.');
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Manage billing
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!(await confirm('Cancel subscription?', 'You keep your plan until the end of the paid period, then move to Starter. No data is deleted.', 'Cancel subscription'))) return;
                  try {
                    await api(`/orgs/${o.id}/billing/cancel`, { method: 'POST', body: {} });
                    await Promise.all([reloadMe(), qc.invalidateQueries({ queryKey: keys.org(o.id) })]);
                    toast.success('Subscription cancelled');
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          <UsageRow label="Projects" used={o.usage.projects} limit={o.limits.projects} />
          <UsageRow label="People" used={o.usage.members} limit={o.limits.members} />
          <UsageRow label="Storage" used={o.usage.storageMb} limit={o.limits.storageMb} format={(mb) => formatBytes(mb * 1024 * 1024)} />
        </div>
      </Card>
      {awaitingPayment && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
          <p className="flex items-center gap-2.5">
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
            Finish paying for {PLANS[awaitingPayment.plan].name} in the other tab. This page updates by itself once it goes through.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAwaitingPayment(null)}>Stop waiting</Button>
        </div>
      )}
      {plans.data?.testMode && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <strong>Test mode:</strong> no real money is charged. Pay with card <span className="font-mono">4718 6091 0820 4366</span>, any future expiry date and any CVV.
        </div>
      )}
      {isAdmin ? (
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <CreditCard className="size-5 text-stone-400" /> Change plan
          </h2>
          <PricingCards current={o.planStatus === 'trialing' ? undefined : o.effectivePlan} onChoose={choose} busyPlan={busyPlan} />
        </div>
      ) : (
        <Card className="p-5 text-sm text-stone-500">Only workspace owners and admins can change the plan.</Card>
      )}
    </div>
  );
}

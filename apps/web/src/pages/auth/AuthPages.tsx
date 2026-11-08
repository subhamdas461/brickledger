import { ProjectRoleDescriptions, ProjectRoles, type InvitePreview, type ProjectDetail } from '@brickledger/shared/web';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Mail, TriangleExclamationPoint } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { Logo } from '../../components/logo';
import { Button, ButtonLink } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/form';
import { Card, Spinner } from '../../components/ui/surface';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link to="/">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-stone-500 dark:text-stone-400">{footer}</div>}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-stone-900 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_30%_20%,rgb(234_88_12/0.45),transparent),radial-gradient(50%_50%_at_80%_80%,rgb(42_120_214/0.25),transparent)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <p className="max-w-md text-3xl font-semibold leading-tight tracking-tight">Every brick, bill and worker of your build - in one place.</p>
          <ul className="mt-8 space-y-3 text-sm text-stone-300">
            {['Budget vs actual for every construction head', 'Materials, labour attendance and wages', 'Offline Android app with automatic sync', 'Share with your contractor, family or bank'].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <CircleCheck className="size-4 text-brand-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0" />
      {message}
    </div>
  );
}

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

export function Login() {
  const { login, status } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get('next'));
  if (status === 'authenticated') return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your BrickLedger account."
      footer={
        <>
          New here?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
            Create an account
          </Link>
        </>
      }
    >
      <ErrorNote message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label={
            <span className="flex justify-between">
              Password
              <Link to="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">
                Forgot password?
              </Link>
            </span>
          }
          htmlFor="password"
        >
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { register, status } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invite = params.get('invite') ?? undefined;
  const [form, setForm] = useState({ name: '', email: params.get('email') ?? '', password: '', company: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  if (status === 'authenticated' && !busy) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register({ ...form, company: form.company || undefined, inviteToken: invite });
      if (invite) {
        // The server accepts the invitation during sign-up; the project shows up in the list.
        navigate('/app', { replace: true });
      } else if (params.get('demo')) {
        const demo = await api<ProjectDetail>('/projects/demo', { method: 'POST', body: {} });
        navigate(`/app/p/${demo.id}`, { replace: true });
      } else {
        navigate(safeNext(params.get('next')), { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <AuthShell
      title={invite ? 'Create your account to join' : 'Start your free trial'}
      subtitle={invite ? 'You were invited to a project on BrickLedger.' : '14 days of Pro, no credit card required.'}
      footer={
        <>
          Already have an account?{' '}
          <Link to={invite ? `/login?next=/invite/${invite}` : '/login'} className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </>
      }
    >
      <ErrorNote message={error} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name" htmlFor="name" error={fieldErrors.name}>
          <Input id="name" autoComplete="name" required value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters." error={fieldErrors.password}>
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        </Field>
        {!invite && (
          <Field label="Company or family name" htmlFor="company" hint="Optional - used as your workspace name.">
            <Input id="company" autoComplete="organization" value={form.company} onChange={set('company')} />
          </Field>
        )}
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          {params.get('demo') ? 'Create account & open sample' : 'Create account'}
        </Button>
        <p className="text-center text-xs text-stone-500">
          By creating an account you agree to our{' '}
          <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell title="Reset your password" subtitle="We’ll email you a link to choose a new one." footer={<Link to="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">Back to sign in</Link>}>
      {sent ? (
        <Card className="flex gap-3 p-4 text-sm">
          <Mail className="size-5 shrink-0 text-brand-600" />
          <p>If an account exists for <b>{email}</b>, a reset link is on its way. It expires in one hour.</p>
        </Card>
      ) : (
        <>
          <ErrorNote message={error} />
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={busy}>
              Send reset link
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token') ?? '';
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell title="Choose a new password" subtitle="You’ll be signed out of other devices.">
      <ErrorNote message={token ? error : 'This reset link is incomplete. Request a new one.'} />
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" htmlFor="password" hint="At least 8 characters.">
          <Input id="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!token}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}

export function AcceptInvite() {
  const { token = '' } = useParams();
  const { status, me } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ['invite', token], queryFn: () => api<InvitePreview>(`/invites/${token}`), retry: false });

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ projectId: string | null }>(`/invites/${token}/accept`, { method: 'POST', body: {} });
      navigate(res.projectId ? `/app/p/${res.projectId}` : '/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (isLoading || status === 'loading') return <Spinner className="min-h-dvh" />;
  const invalid = loadError || !data || data.expired || data.accepted;
  return (
    <AuthShell
      title={invalid ? 'Invitation unavailable' : `Join “${data!.projectName ?? data!.orgName}”`}
      subtitle={
        invalid
          ? data?.accepted
            ? 'This invitation has already been used.'
            : data?.expired
              ? 'This invitation has expired. Ask the project manager to send a new one.'
              : 'This invitation link is not valid.'
          : `${data!.invitedBy ?? 'A project manager'} invited ${data!.email} as ${ProjectRoles.label(data!.role)}.`
      }
    >
      {invalid ? (
        <ButtonLink to="/" variant="secondary" className="w-full">
          Go to homepage
        </ButtonLink>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 text-sm text-stone-600 dark:text-stone-300">
            <p className="font-semibold text-stone-900 dark:text-white">{ProjectRoles.label(data!.role)}</p>
            <p className="mt-1">{ProjectRoleDescriptions[data!.role]}</p>
          </Card>
          <ErrorNote message={error} />
          {status === 'authenticated' ? (
            <>
              <Button className="w-full" size="lg" loading={busy} onClick={accept}>
                Accept invitation
              </Button>
              <p className="text-center text-xs text-stone-500">Signed in as {me?.user.email}</p>
            </>
          ) : (
            <div className="grid gap-2">
              <ButtonLink to={`/register?invite=${token}&email=${encodeURIComponent(data!.email)}`} size="lg">
                Create account & join
              </ButtonLink>
              <ButtonLink to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} size="lg" variant="secondary">
                I already have an account
              </ButtonLink>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo />
      <p className="mt-10 text-6xl font-bold tracking-tight text-stone-900 dark:text-white">404</p>
      <p className="mt-2 text-stone-500">This page doesn’t exist.</p>
      <ButtonLink to="/" className="mt-6">
        Go home
      </ButtonLink>
    </div>
  );
}

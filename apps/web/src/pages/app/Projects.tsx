import {
  AreaUnits,
  CURRENCIES,
  ProjectRoles,
  ProjectStatuses,
  formatMoneyCompact,
  todayIso,
  type ProjectDetail,
  type ProjectListItem,
} from '@brickledger/shared/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, House, MapPin, Plus, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Meter } from '../../components/charts';
import { EntityForm, type FieldDef } from '../../components/entity-form';
import { Button, ButtonLink } from '../../components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton, Spinner } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { keys, useOrg, useProjects } from '../../lib/queries';

const statusTone = { planning: 'violet', in_progress: 'blue', on_hold: 'amber', completed: 'green' } as const;

function ProjectCard({ p }: { p: ProjectListItem }) {
  const navigate = useNavigate();
  const committed = p.stats.spent + p.stats.due;
  return (
    <Card
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/app/p/${p.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/p/${p.id}`)}
      className="group cursor-pointer p-5 transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-lg hover:shadow-stone-900/5 dark:hover:border-stone-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <House className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-stone-900 dark:text-white">{p.name}</h3>
            <p className="flex items-center gap-1 truncate text-xs text-stone-500">
              <MapPin className="size-3" />
              {p.city || p.address || p.orgName}
            </p>
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-stone-500" />
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge tone={statusTone[p.status as keyof typeof statusTone] ?? 'neutral'}>{ProjectStatuses.label(p.status)}</Badge>
        {p.role !== 'manager' && <Badge>{ProjectRoles.label(p.role)}</Badge>}
        {p.name.startsWith('Sample:') && <Badge tone="brand">Sample</Badge>}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-stone-500">Committed</p>
          <p className="text-lg font-semibold text-stone-900 dark:text-white">{formatMoneyCompact(committed, p.currency)}</p>
          <p className="text-xs text-stone-500">of {formatMoneyCompact(p.totalBudget, p.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Progress</p>
          <p className="text-lg font-semibold text-stone-900 dark:text-white">{p.stats.progress}%</p>
          <p className="text-xs text-stone-500">{p.stats.openTasks} open task{p.stats.openTasks === 1 ? '' : 's'}</p>
        </div>
      </div>
      <Meter className="mt-4" value={committed} max={p.totalBudget} />
    </Card>
  );
}

export function Projects() {
  const { data, isLoading } = useProjects();
  const { me } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const demo = useMutation({
    mutationFn: () => api<ProjectDetail>('/projects/demo', { method: 'POST', body: {} }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      navigate(`/app/p/${p.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (isLoading) {
    return (
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-60" />
        ))}
      </div>
    );
  }

  const projects = data ?? [];
  return (
    <>
      <PageHeader
        title={`Hello, ${me?.user.name.split(' ')[0] ?? ''}`}
        description={projects.length ? 'Pick a project to see where things stand today.' : 'Let’s set up your first build.'}
        actions={
          <ButtonLink to="/app/new" icon={<Plus className="size-4" />}>
            New project
          </ButtonLink>
        }
      />
      {projects.length === 0 ? (
        <Card className="overflow-hidden">
          <div className="grid md:grid-cols-2">
            <EmptyState
              icon={<House />}
              title="Create your first project"
              description="Enter your budget and dates - we’ll set up 14 budget heads, a phase-by-phase schedule and common materials for you."
              action={<ButtonLink to="/app/new">Create project</ButtonLink>}
            />
            <div className="border-t border-stone-100 md:border-l md:border-t-0 dark:border-stone-800">
              <EmptyState
                icon={<Sparkles />}
                title="Or explore a sample"
                description="A realistic villa build, five months in: bills, stock, labour, schedule and alerts. Delete it anytime."
                action={
                  <Button variant="secondary" loading={demo.isPending} onClick={() => demo.mutate()}>
                    Open sample project
                  </Button>
                }
              />
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
          {!projects.some((p) => p.name.startsWith('Sample:')) && (
            <button
              onClick={() => demo.mutate()}
              disabled={demo.isPending}
              className="flex min-h-60 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200 p-6 text-center text-sm text-stone-500 transition hover:border-brand-300 hover:text-brand-700 dark:border-stone-800 dark:hover:border-brand-500/40"
            >
              <Sparkles className="mb-2 size-5" />
              <span className="font-semibold">Explore a sample project</span>
              <span className="mt-1 text-xs">Doesn’t count toward your plan</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { currentOrg } = useAuth();
  const fields: FieldDef[] = [
    { name: 'name', label: 'Project name', type: 'text', required: true, placeholder: 'e.g. Our home, Whitefield', span: 2, autoFocus: true },
    { name: 'address', label: 'Site address', type: 'text', placeholder: 'Plot / street', span: 2 },
    { name: 'city', label: 'City', type: 'text' },
    { name: 'status', label: 'Stage', type: 'select', options: ProjectStatuses.list.filter((s) => s.value !== 'completed'), required: true },
    { type: 'section', name: 's1', label: 'Budget' },
    { name: 'currency', label: 'Currency', type: 'select', options: CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })), required: true },
    { name: 'totalBudget', label: 'Total budget', type: 'money', placeholder: '0', hint: 'We split it across standard construction heads. You can edit each later.' },
    { type: 'section', name: 's2', label: 'House details' },
    { name: 'builtUpArea', label: 'Built-up area', type: 'number', placeholder: '2400', hint: 'Used for cost per unit area.' },
    { name: 'areaUnit', label: 'Area unit', type: 'select', options: AreaUnits.list, required: true },
    { name: 'plotArea', label: 'Plot area', type: 'number' },
    { name: 'floors', label: 'Floors', type: 'number', step: 1, min: 0 },
    { type: 'section', name: 's3', label: 'Timeline' },
    { name: 'startDate', label: 'Start date', type: 'date' },
    { name: 'targetEndDate', label: 'Target completion', type: 'date' },
    { name: 'useTemplates', label: 'Set up budget heads, phases and common materials for me', type: 'checkbox', span: 2, description: 'Recommended - everything stays editable.' },
  ];
  const org = useOrg(currentOrg?.id);
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  if (currentOrg && org.isLoading) return <Spinner />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New project" description="A project is one house or building. You can invite your team after creating it." />
      <Card className="p-6">
        <EntityForm
          formId="new-project"
          fields={fields}
          initial={{
            status: 'in_progress',
            currency: org.data?.defaultCurrency ?? 'INR',
            areaUnit: 'sqft',
            startDate: todayIso(),
            targetEndDate: todayIso(nextYear),
            useTemplates: true,
          }}
          onSubmit={async (payload) => {
            try {
              const project = await api<ProjectDetail>('/projects', {
                method: 'POST',
                body: { ...payload, totalBudget: payload.totalBudget ?? 0, orgId: currentOrg?.id, floors: payload.floors ?? null },
              });
              void qc.invalidateQueries({ queryKey: keys.projects });
              toast.success(`“${project.name}” created`);
              navigate(`/app/p/${project.id}`);
            } catch (err) {
              if (err instanceof ApiError && err.isPlanLimit) {
                toast.error(err.message, { label: 'Upgrade', onClick: () => navigate('/app/settings?tab=billing') });
                return;
              }
              throw err;
            }
          }}
        />
        <div className="mt-6 flex justify-end gap-2 border-t border-stone-100 pt-5 dark:border-stone-800">
          <ButtonLink to="/app" variant="secondary">
            Cancel
          </ButtonLink>
          <Button type="submit" form="new-project">
            Create project
          </Button>
        </div>
      </Card>
    </div>
  );
}

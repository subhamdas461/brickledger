import { AreaUnits, CURRENCIES, ProjectStatuses } from '@brickledger/shared/web';
import { useQueryClient } from '@tanstack/react-query';
import { Trash } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EntityForm, type FieldDef } from '../../components/entity-form';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/form';
import { Card, CardHeader, PageHeader } from '../../components/ui/surface';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { keys, useRefreshProject } from '../../lib/queries';

export function ProjectSettings() {
  const { pid, project, isManager } = useProjectCtx();
  const { me } = useAuth();
  const refresh = useRefreshProject(pid);
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmName, setConfirmName] = useState('');
  const orgRole = me?.orgs.find((o) => o.id === project.orgId)?.role;
  const canDeleteProject = orgRole === 'owner' || orgRole === 'admin';

  const fields: FieldDef[] = [
    { name: 'name', label: 'Project name', type: 'text', required: true, span: 2 },
    { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
    { name: 'address', label: 'Site address', type: 'text', span: 2 },
    { name: 'city', label: 'City', type: 'text' },
    { name: 'status', label: 'Stage', type: 'select', options: ProjectStatuses.list, required: true },
    { name: 'currency', label: 'Currency', type: 'select', required: true, options: CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })) },
    { name: 'totalBudget', label: 'Total budget', type: 'money' },
    { name: 'builtUpArea', label: 'Built-up area', type: 'number' },
    { name: 'areaUnit', label: 'Area unit', type: 'select', options: AreaUnits.list, required: true },
    { name: 'plotArea', label: 'Plot area', type: 'number' },
    { name: 'floors', label: 'Floors', type: 'number', step: 1, min: 0 },
    { name: 'startDate', label: 'Start date', type: 'date' },
    { name: 'targetEndDate', label: 'Target completion', type: 'date' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Project settings" />
      <Card>
        <CardHeader title="Details" subtitle={isManager ? undefined : 'Only project managers can edit these.'} />
        <div className="p-5">
          <EntityForm
            key={project.updatedAt}
            formId="project-settings"
            fields={fields}
            initial={project}
            currency={project.currency}
            onSubmit={async (payload) => {
              await api(`/projects/${pid}`, { method: 'PATCH', body: { ...payload, totalBudget: payload.totalBudget ?? 0 } });
              refresh();
              toast.success('Project saved');
            }}
          />
          {isManager && (
            <div className="mt-5 flex justify-end">
              <Button type="submit" form="project-settings">
                Save changes
              </Button>
            </div>
          )}
        </div>
      </Card>
      {canDeleteProject && (
        <Card className="border-red-200 dark:border-red-500/30">
          <CardHeader title="Delete project" subtitle="Removes the project for everyone. This can’t be undone from the app." />
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
            <Field label={`Type “${project.name}” to confirm`} className="flex-1">
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
            </Field>
            <Button
              variant="danger"
              icon={<Trash className="size-4" />}
              disabled={confirmName !== project.name}
              onClick={async () => {
                try {
                  await api(`/projects/${pid}`, { method: 'DELETE' });
                  await qc.invalidateQueries({ queryKey: keys.projects });
                  toast.success('Project deleted');
                  navigate('/app');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Delete project
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

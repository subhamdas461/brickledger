import {
  todayIso,
  type ActivityItem,
  type Dashboard,
  type EntityMap,
  type OrgDetail,
  type PendingInvite,
  type PlansResponse,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectMember,
  type ProjectReport,
  type ResourceKey,
} from '@brickledger/shared/web';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';
import { compressImage } from './image';

export type Params = Record<string, string | number | boolean | undefined | null>;
export interface ListResult<T> {
  items: T[];
  total: number;
  sum: number;
}

/** Query keys put the project id second so one predicate can refresh everything about a project. */
export const keys = {
  projects: ['projects'] as const,
  project: (pid: string) => ['project', pid] as const,
  dashboard: (pid: string) => ['dashboard', pid] as const,
  report: (pid: string) => ['report', pid] as const,
  list: (pid: string, key: ResourceKey, params?: Params) => ['res', pid, key, params ?? {}] as const,
  members: (pid: string) => ['members', pid] as const,
  activity: (pid: string) => ['activity', pid] as const,
  org: (orgId: string) => ['org', orgId] as const,
  orgMembers: (orgId: string) => ['orgMembers', orgId] as const,
  plans: ['plans'] as const,
};

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: () => api<ProjectListItem[]>('/projects') });
}

export function useProject(pid: string) {
  return useQuery({ queryKey: keys.project(pid), queryFn: () => api<ProjectDetail>(`/projects/${pid}`) });
}

export function useDashboard(pid: string) {
  return useQuery({
    queryKey: keys.dashboard(pid),
    queryFn: () => api<Dashboard>(`/projects/${pid}/dashboard`, { query: { today: todayIso() } }),
    placeholderData: keepPreviousData,
  });
}

export function useReport(pid: string) {
  return useQuery({
    queryKey: keys.report(pid),
    queryFn: () => api<ProjectReport>(`/projects/${pid}/report`, { query: { today: todayIso() } }),
  });
}

export function useList<K extends ResourceKey>(pid: string, key: K, params?: Params, enabled = true) {
  return useQuery({
    queryKey: keys.list(pid, key, params),
    queryFn: () => api<ListResult<EntityMap[K]>>(`/projects/${pid}/${key}`, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMembers(pid: string) {
  return useQuery({
    queryKey: keys.members(pid),
    queryFn: () => api<{ members: ProjectMember[]; invites: PendingInvite[] }>(`/projects/${pid}/members`),
  });
}

export function useActivity(pid: string, limit = 50) {
  return useQuery({ queryKey: [...keys.activity(pid), limit], queryFn: () => api<ActivityItem[]>(`/projects/${pid}/activity`, { query: { limit } }) });
}

export function useOrg(orgId: string | undefined) {
  return useQuery({ queryKey: keys.org(orgId ?? ''), queryFn: () => api<OrgDetail>(`/orgs/${orgId}`), enabled: Boolean(orgId) });
}

export function usePlans() {
  return useQuery({ queryKey: keys.plans, queryFn: () => api<PlansResponse>('/billing/plans'), staleTime: 3600_000 });
}

export function useRefreshProject(pid: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === pid });
    void qc.invalidateQueries({ queryKey: keys.projects });
  };
}

export function useResourceMutations<K extends ResourceKey>(pid: string, key: K) {
  const refresh = useRefreshProject(pid);
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<EntityMap[K]>(`/projects/${pid}/${key}`, { method: 'POST', body }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api<EntityMap[K]>(`/projects/${pid}/${key}/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/projects/${pid}/${key}/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return { create, update, remove };
}

export function useUpload(pid: string) {
  const refresh = useRefreshProject(pid);
  return useMutation({
    mutationFn: (form: FormData) => api<EntityMap['files']>(`/projects/${pid}/files`, { method: 'POST', body: form }),
    onSuccess: refresh,
  });
}

/** Swaps a file's content and keeps its details. Images are compressed first, like new uploads. */
export function useReplaceFile(pid: string) {
  const refresh = useRefreshProject(pid);
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const prepared = await compressImage(file);
      const form = new FormData();
      form.append('file', prepared, prepared.name);
      return api<EntityMap['files']>(`/projects/${pid}/files/${id}/content`, { method: 'PUT', body: form });
    },
    onSuccess: refresh,
  });
}

/** Reference data used by pickers and for showing names (categories, vendors...). */
export function useLookups(pid: string) {
  const categories = useList(pid, 'categories', { limit: 1000 });
  const phases = useList(pid, 'phases', { limit: 1000 });
  const vendors = useList(pid, 'vendors', { limit: 1000 });
  const workers = useList(pid, 'workers', { limit: 1000 });
  const materials = useList(pid, 'materials', { limit: 1000 });
  return useMemo(() => {
    const opts = <T extends { id: string; name: string }>(items: T[] | undefined) => (items ?? []).map((i) => ({ value: i.id, label: i.name }));
    const names = <T extends { id: string; name: string }>(items: T[] | undefined) => new Map((items ?? []).map((i) => [i.id, i.name]));
    return {
      categories: categories.data?.items ?? [],
      phases: phases.data?.items ?? [],
      vendors: vendors.data?.items ?? [],
      workers: workers.data?.items ?? [],
      materials: materials.data?.items ?? [],
      options: {
        categories: opts(categories.data?.items),
        phases: opts(phases.data?.items),
        vendors: opts(vendors.data?.items),
        workers: opts(workers.data?.items?.filter((w) => w.active)),
        materials: opts(materials.data?.items),
      },
      names: {
        categories: names(categories.data?.items),
        phases: names(phases.data?.items),
        vendors: names(vendors.data?.items),
        workers: names(workers.data?.items),
        materials: names(materials.data?.items),
      },
    };
  }, [categories.data, phases.data, vendors.data, workers.data, materials.data]);
}

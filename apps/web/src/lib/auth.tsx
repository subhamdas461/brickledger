import type { AuthResponse, MeResponse, OrgSummary } from '@brickledger/shared/web';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onUnauthorized, refreshSession, setAccessToken } from './api';
import { storage } from './storage';

type Status = 'loading' | 'authenticated' | 'anonymous';

const SESSION_HINT = 'bl-session';

interface AuthContextValue {
  status: Status;
  me: MeResponse | null;
  /** Workspace used for creating projects and billing. */
  currentOrg: OrgSummary | null;
  setCurrentOrgId(id: string): void;
  login(email: string, password: string): Promise<void>;
  register(input: { name: string; email: string; password: string; company?: string; inviteToken?: string }): Promise<void>;
  logout(): Promise<void>;
  reloadMe(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [orgId, setOrgId] = useState<string | null>(() => storage.get('bl-org'));

  const accept = useCallback((data: AuthResponse | MeResponse) => {
    if ('accessToken' in data) setAccessToken(data.accessToken);
    // Non-secret hint: lets anonymous visitors skip the refresh round-trip on page load.
    storage.set(SESSION_HINT, '1');
    setMe({ user: data.user, orgs: data.orgs });
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    storage.remove(SESSION_HINT);
    setMe(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    onUnauthorized(clear);
    if (!storage.get(SESSION_HINT)) {
      setStatus('anonymous');
      return;
    }
    let cancelled = false;
    refreshSession().then((session) => {
      if (cancelled) return;
      if (session) accept(session);
      else {
        storage.remove(SESSION_HINT);
        setStatus('anonymous');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accept, clear]);

  const currentOrg = useMemo(() => {
    if (!me) return null;
    return me.orgs.find((o) => o.id === orgId) ?? me.orgs.find((o) => o.role === 'owner') ?? me.orgs[0] ?? null;
  }, [me, orgId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      currentOrg,
      setCurrentOrgId(id) {
        setOrgId(id);
        storage.set('bl-org', id);
      },
      async login(email, password) {
        accept(await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } }));
      },
      async register(input) {
        accept(await api<AuthResponse>('/auth/register', { method: 'POST', body: input }));
      },
      async logout() {
        await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
        clear();
      },
      async reloadMe() {
        accept(await api<MeResponse>('/me'));
      },
    }),
    [status, me, currentOrg, accept, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

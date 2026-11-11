import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, SessionUser } from '@bitebrew/shared';
import { get, NetworkError, post } from '../api/client';
import { lastUser, rememberUser } from '../lib/offlineQueue';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const u = (await get<{ user: SessionUser | null }>('/auth/me')).user;
        rememberUser(u);
        return u;
      } catch (e) {
        // Server unreachable: keep the till usable for offline orders with the last signed-in user.
        if (e instanceof NetworkError) return lastUser();
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(['me'], null);
    };
    window.addEventListener('bb:unauthorized', onUnauthorized);
    return () => window.removeEventListener('bb:unauthorized', onUnauthorized);
  }, [qc]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { user } = await post<{ user: SessionUser }>('/auth/login', { username, password });
      // Drop any data cached for a previous user, but keep the live `me` query
      // (clearing it would detach the observer and the UI would not update).
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], user);
      rememberUser(user);
      return user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.setQueryData(['me'], null);
    rememberUser(null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const user = me.data ?? null;
    return {
      user,
      loading: me.isPending,
      login,
      logout,
      can: (p) => !!user?.permissions.includes(p),
    };
  }, [me.data, me.isPending, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

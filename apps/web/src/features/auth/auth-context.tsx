import { type PermissionCode } from '@educore/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, setAccessToken, setRefreshHandler } from '@/lib/api-client';
import { authService } from './auth.service';
import { type AuthSession, type AuthUser } from './types';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Inicia sesión y devuelve el usuario autenticado. */
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Vuelve a cargar el usuario (p. ej. tras cambiar sus roles). */
  reloadUser: () => Promise<void>;
  /**
   * Indica si el usuario tiene el permiso (con `scope: 'ALL'`, sobre toda la
   * institución y no solo lo asignado). Solo decide qué mostrar en la web: la
   * API verifica los permisos en cada petición.
   */
  can: (permission: PermissionCode, scope?: 'ALL') => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  /** Renovación en curso, compartida por todas las peticiones que la necesiten. */
  const refreshing = useRef<Promise<string | null> | null>(null);

  const applySession = useCallback((session: AuthSession) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  /**
   * Renueva la sesión con la cookie. Una sola renovación a la vez: si varias
   * peticiones (o el doble efecto de StrictMode) la piden simultáneamente,
   * comparten la misma; dos renovaciones con la misma cookie se verían en el
   * servidor como una reutilización del token.
   */
  const refreshSession = useCallback((): Promise<string | null> => {
    refreshing.current ??= (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const session = await authService.refresh();
            applySession(session);
            return session.accessToken;
          } catch (error) {
            // Otra pestaña renovó la sesión hace instantes: la cookie ya es la nueva.
            if (error instanceof ApiError && error.code === 'SESSION_ROTATED' && attempt === 0) {
              await wait(300);
              continue;
            }
            throw error;
          }
        }
        return null;
      } catch {
        clearSession();
        return null;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [applySession, clearSession]);

  useEffect(() => {
    setRefreshHandler(refreshSession);
    void refreshSession();
    return () => setRefreshHandler(null);
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await authService.login(email, password);
      applySession(session);
      return session.user;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const reloadUser = useCallback(async () => {
    setUser(await authService.me());
  }, []);

  const can = useCallback(
    (permission: PermissionCode, scope?: 'ALL') =>
      user?.permissions.some(
        (p) => p.code === permission && (!scope || p.scopes.includes(scope)),
      ) ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ status, user, login, logout, reloadUser, can }),
    [status, user, login, logout, reloadUser, can],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}

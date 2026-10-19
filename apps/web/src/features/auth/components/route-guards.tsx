import { type PermissionCode } from '@educore/shared';
import { ShieldX } from 'lucide-react';
import { type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/feedback';
import { useAuth } from '../auth-context';

/** Exige sesión: mientras se recupera muestra carga; sin sesión, lleva al login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LoadingState label="Verificando tu sesión…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return (
      <Navigate
        to="/iniciar-sesion"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return children;
}

/** Las páginas públicas de acceso no se muestran a quien ya inició sesión. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingState label="Cargando…" />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

export function AccessDenied() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <ShieldX className="size-10 text-danger" aria-hidden />
      <h1 className="text-xl font-semibold">Acceso denegado</h1>
      <p className="text-muted-foreground">
        No tienes permiso para ver esta sección. Si crees que es un error, comunícate con el
        administrador de la institución.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}

/**
 * Muestra la página solo si el usuario tiene el permiso. Es una ayuda de
 * navegación: la API vuelve a verificar el permiso en cada petición.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? children : <AccessDenied />;
}

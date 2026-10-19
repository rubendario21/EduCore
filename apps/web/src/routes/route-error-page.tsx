import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { NotFoundPage } from './not-found-page';

/** Límite de errores de las rutas: evita la pantalla en blanco ante fallos de render. */
export function RouteErrorPage() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
    >
      <h1 className="text-2xl font-semibold">Algo salió mal</h1>
      <p className="text-muted-foreground">
        Ocurrió un error inesperado al mostrar esta página. Intenta recargarla.
      </p>
      <Button onClick={() => window.location.reload()}>Recargar</Button>
    </div>
  );
}

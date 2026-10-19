import { CircleAlert, CircleCheck, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, getErrorMessage, INVALID_RESPONSE, NETWORK_ERROR } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useHealth } from '../hooks/use-health';

type Tone = 'ok' | 'error' | 'pending';

function StatusRow({ label, tone, detail }: { label: string; tone: Tone; detail: string }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'error' ? CircleAlert : LoaderCircle;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon
        aria-hidden
        className={cn(
          'size-5 shrink-0',
          tone === 'ok' && 'text-success',
          tone === 'error' && 'text-danger',
          tone === 'pending' && 'animate-spin text-muted-foreground',
        )}
      />
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-sm text-muted-foreground">{detail}</span>
    </li>
  );
}

export function SystemStatusCard() {
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt } = useHealth();

  // La API está disponible si respondió con su propio formato, aunque sea un
  // error (p. ej. 503 porque la base de datos no responde). Un fallo de red o
  // una respuesta ajena (p. ej. 502 del proxy) indica que la API no responde.
  const apiAnswered =
    data !== undefined ||
    (error instanceof ApiError && error.code !== NETWORK_ERROR && error.code !== INVALID_RESPONSE);
  const apiTone: Tone = isPending ? 'pending' : apiAnswered ? 'ok' : 'error';
  const dbTone: Tone = isPending
    ? 'pending'
    : data?.checks.database.status === 'up'
      ? 'ok'
      : 'error';

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Estado del sistema</CardTitle>
          <CardDescription>
            Conectividad entre la aplicación, la API y la base de datos.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Volver a comprobar el estado"
        >
          <RefreshCw aria-hidden className={cn(isFetching && 'animate-spin')} />
          Comprobar
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" aria-live="polite">
          <StatusRow
            label="API"
            tone={apiTone}
            detail={isPending ? 'Comprobando…' : apiTone === 'ok' ? 'Disponible' : 'Sin conexión'}
          />
          <StatusRow
            label="Base de datos"
            tone={dbTone}
            detail={
              isPending
                ? 'Comprobando…'
                : data
                  ? `Disponible · ${data.checks.database.latencyMs ?? '—'} ms`
                  : 'No disponible'
            }
          />
        </ul>
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {getErrorMessage(error)}
          </p>
        )}
        {dataUpdatedAt > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Última comprobación: {new Date(dataUpdatedAt).toLocaleTimeString('es-CO')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

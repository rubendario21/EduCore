import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { PageHeader, type PageMeta, Pagination } from '@/components/page';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/input';
import { apiClient, toQuery } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: { id: string; email: string; name: string | null } | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

/** Grupos de acciones para filtrar (prefijo terminado en *). */
const ACTION_GROUPS = [
  { value: '', label: 'Todas las acciones' },
  { value: 'auth.*', label: 'Inicio de sesión y contraseñas' },
  { value: 'users.*', label: 'Usuarios' },
  { value: 'access.*', label: 'Roles' },
  { value: 'institution.*', label: 'Institución' },
  { value: 'academics.*', label: 'Estructura académica' },
];

/** Descripción legible de las acciones más frecuentes; el resto se muestra con su código. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login.succeeded': 'Inicio de sesión',
  'auth.login.failed': 'Intento de inicio de sesión fallido',
  'auth.login.blocked': 'Intento con la cuenta bloqueada',
  'auth.account.locked': 'Cuenta bloqueada por intentos fallidos',
  'auth.logout': 'Cierre de sesión',
  'auth.password.changed': 'Cambio de contraseña',
  'auth.password.reset': 'Contraseña restablecida',
  'auth.password.reset_requested': 'Solicitud de recuperación de contraseña',
  'auth.account.activated': 'Cuenta activada',
  'auth.session.reuse_detected': 'Posible robo de sesión detectado',
  'users.account.created': 'Usuario creado',
  'users.account.updated': 'Usuario editado',
  'users.account.suspended': 'Usuario suspendido',
  'users.account.reactivated': 'Usuario reactivado',
  'users.roles.changed': 'Roles de usuario cambiados',
  'users.profile.updated': 'Perfil propio editado',
  'access.role.created': 'Rol creado',
  'access.role.updated': 'Rol editado',
  'access.role.deleted': 'Rol eliminado',
  'institution.setup.completed': 'Configuración inicial de la institución',
  'institution.profile.updated': 'Datos de la institución editados',
  'institution.settings.updated': 'Configuración editada',
  'academics.year.activated': 'Año lectivo activado',
  'academics.year.closed': 'Año lectivo cerrado',
};

const show = (value: unknown) =>
  value === null || value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

function EntryDetails({ entry }: { entry: AuditEntry }) {
  return (
    <div className="flex flex-col gap-2 bg-surface-muted/40 px-3 py-3 text-xs">
      {entry.changes && (
        <table className="w-full">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Campo</th>
              <th className="py-1 pr-3 font-medium">Antes</th>
              <th className="py-1 font-medium">Después</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(entry.changes).map(([field, { from, to }]) => (
              <tr key={field} className="align-top">
                <td className="py-1 pr-3 font-mono">{field}</td>
                <td className="break-all py-1 pr-3 text-danger">{show(from)}</td>
                <td className="break-all py-1 text-success">{show(to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {entry.metadata && (
        <pre className="whitespace-pre-wrap break-all font-mono">
          {JSON.stringify(entry.metadata, null, 2)}
        </pre>
      )}
      <p className="text-muted-foreground">
        IP: {entry.ip ?? '—'} · Petición:{' '}
        <span className="font-mono">{entry.requestId ?? '—'}</span>
      </p>
    </div>
  );
}

export function AuditPage() {
  const [filters, setFilters] = useState({ page: 1, pageSize: 25, action: '', from: '', to: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = {
    page: filters.page,
    pageSize: filters.pageSize,
    action: filters.action,
    // Días completos en la hora local de quien consulta, enviados en ISO con zona.
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
  };
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['audit-logs', query],
    queryFn: ({ signal }) =>
      apiClient.get<{ data: AuditEntry[]; meta: PageMeta }>(`/audit-logs${toQuery(query)}`, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Auditoría"
        description="Registro inalterable de las operaciones relevantes de la institución."
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <Select
            aria-label="Tipo de acción"
            className="sm:w-72"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, page: 1, action: e.target.value }))}
          >
            {ACTION_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            aria-label="Desde"
            className="sm:w-44"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, page: 1, from: e.target.value }))}
          />
          <Input
            type="date"
            aria-label="Hasta"
            className="sm:w-44"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, page: 1, to: e.target.value }))}
          />
        </div>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No hay eventos para estos filtros" />
        ) : (
          <>
            <ul className="divide-y">
              {data.data.map((entry) => {
                const open = expanded === entry.id;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : entry.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-muted/50"
                    >
                      <span className="w-40 shrink-0 text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {entry.actor
                            ? (entry.actor.name ?? entry.actor.email)
                            : 'Sistema o usuario desconocido'}
                        </span>
                      </span>
                      <ChevronDown
                        className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </button>
                    {open && <EntryDetails entry={entry} />}
                  </li>
                );
              })}
            </ul>
            <Pagination
              meta={data.meta}
              onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
            />
          </>
        )}
      </Card>
    </div>
  );
}

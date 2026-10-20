import { PERMISSIONS } from '@educore/shared';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Building2,
  CalendarDays,
  Clock,
  Library,
  MailQuestion,
  Users,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/auth-context';
import { useProfile } from '@/features/auth/profile-context';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

export interface DashboardSummary {
  generatedAt: string;
  today: string;
  users: {
    active: number;
    invited: number;
    suspended: number;
    byRole: Array<{ code: string; name: string; count: number }>;
  };
  institution: { activeCampuses: number; activeShifts: number };
  academics: {
    activeGrades: number;
    activeSubjects: number;
    activeYear: {
      id: string;
      year: number;
      name: string;
      startsOn: string;
      endsOn: string;
      periodCount: number;
      currentPeriod: { number: number; name: string; startsOn: string; endsOn: string } | null;
      activeGroups: number;
    } | null;
  };
}

function Stat({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString('es-CO')}</p>
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardContent() {
  const { can } = useAuth();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: ({ signal }) => apiClient.get<DashboardSummary>('/dashboard/summary', { signal }),
  });

  if (isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const year = data.academics.activeYear;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Usuarios activos"
          value={data.users.active}
          icon={<Users className="size-5" aria-hidden />}
        />
        <Stat
          label="Invitaciones pendientes"
          value={data.users.invited}
          icon={<MailQuestion className="size-5" aria-hidden />}
          hint="Cuentas sin activar"
        />
        <Stat
          label="Sedes activas"
          value={data.institution.activeCampuses}
          icon={<Building2 className="size-5" aria-hidden />}
        />
        <Stat
          label="Jornadas activas"
          value={data.institution.activeShifts}
          icon={<Clock className="size-5" aria-hidden />}
        />
        <Stat
          label="Grados activos"
          value={data.academics.activeGrades}
          icon={<Library className="size-5" aria-hidden />}
        />
        <Stat
          label="Asignaturas activas"
          value={data.academics.activeSubjects}
          icon={<BookOpen className="size-5" aria-hidden />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" aria-hidden /> Año lectivo
            </CardTitle>
            <CardDescription>Hoy es {formatDate(data.today)}</CardDescription>
          </CardHeader>
          <CardContent>
            {year ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Año activo</dt>
                  <dd className="font-medium">{year.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Inicio</dt>
                  <dd>{formatDate(year.startsOn)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fin</dt>
                  <dd>{formatDate(year.endsOn)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Período en curso</dt>
                  <dd>{year.currentPeriod ? year.currentPeriod.name : 'Ninguno hoy (receso)'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Grupos activos</dt>
                  <dd className="tabular-nums">{year.activeGroups}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sin datos: no hay un año lectivo activo.{' '}
                {can(PERMISSIONS.ACADEMIC_YEARS_MANAGE) && (
                  <Link to="/academico" className="text-primary hover:underline">
                    Configúralo en Estructura académica.
                  </Link>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usuarios activos por rol</CardTitle>
            <CardDescription>Un usuario con varios roles cuenta en cada uno.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.users.byRole.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos: no hay usuarios activos.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.users.byRole.map((role) => {
                  const pct = data.users.active > 0 ? (role.count / data.users.active) * 100 : 0;
                  return (
                    <li key={role.code} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span>{role.name}</span>
                        <span className="tabular-nums text-muted-foreground">{role.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-surface-muted" aria-hidden>
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const PORTAL_MESSAGES = {
  STUDENT:
    'Aquí verás tus calificaciones, asistencia, horario y tareas a medida que la institución active cada módulo.',
  GUARDIAN:
    'Aquí podrás seguir las calificaciones, la asistencia y los comunicados de tus estudiantes a medida que la institución active cada módulo.',
  TEACHER: 'Tus cursos y listas de clase están en Mis cursos.',
} as const;

export function HomePage() {
  const { user, can } = useAuth();
  const { profile } = useProfile();
  // El tablero institucional es del perfil administrativo, aunque la cuenta tenga el permiso.
  const showDashboard =
    (profile === 'STAFF' || profile === null) && can(PERMISSIONS.DASHBOARD_VIEW);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={`Hola, ${user?.firstNames.split(' ')[0] ?? ''}`}
        description={
          user
            ? `${user.institution.name} · ${user.roles.map((r) => r.name).join(', ')}`
            : undefined
        }
      />
      {showDashboard ? (
        <DashboardContent />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {profile && profile !== 'STAFF'
              ? PORTAL_MESSAGES[profile]
              : 'Bienvenido a EduCore. Las secciones de tu perfil (horarios, calificaciones, tareas) estarán disponibles a medida que la institución active cada módulo.'}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

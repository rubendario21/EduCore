import { PERMISSIONS } from '@educore/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader, Pagination } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { academicsService, useAcademicYears } from '@/features/academics/academics.service';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage } from '@/lib/api-client';
import { formatDate, fullName } from '@/lib/format';
import { EnrollDialog } from '../components/enroll-dialog';
import {
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUS_TONES,
  ENROLLMENT_STATUSES,
  type EnrollmentFilters,
  enrollmentsService,
  RENEWAL_SKIP_LABELS,
  type RenewalReport,
} from '../enrollments.service';

function RenewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: years = [] } = useAcademicYears();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [strategy, setStrategy] = useState<'NEXT' | 'SAME'>('NEXT');
  const [preview, setPreview] = useState<RenewalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setPreview(null);
    setError(null);
  };
  const mutation = useMutation({
    mutationFn: (dryRun: boolean) =>
      enrollmentsService.renew({
        fromAcademicYearId: from,
        toAcademicYearId: to,
        gradeStrategy: strategy,
        dryRun,
      }),
    onSuccess: async (report) => {
      if (report.dryRun) return setPreview(report);
      await queryClient.invalidateQueries({ queryKey: ['enrollments'] });
      toast.success(`Se crearon ${report.created.length} prematrícula(s).`);
      reset();
      onOpenChange(false);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Renovar matrículas"
      description="Crea prematrículas en el año de destino para los estudiantes matriculados en el año de origen. Primero se muestra una simulación."
      className="max-w-2xl"
      submitLabel={preview ? `Confirmar (${preview.created.length})` : 'Simular'}
      submitDisabled={!!preview && preview.created.length === 0}
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (!from || !to) return setError('Selecciona los dos años lectivos.');
        if (from === to) return setError('Elige años distintos.');
        setError(null);
        mutation.mutate(!preview);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Desde el año">
          {(c) => (
            <Select {...c} value={from} onChange={(e) => (setFrom(e.target.value), reset())}>
              <option value="">Selecciona…</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Hacia el año">
          {(c) => (
            <Select {...c} value={to} onChange={(e) => (setTo(e.target.value), reset())}>
              <option value="">Selecciona…</option>
              {years
                .filter((y) => y.status !== 'CLOSED')
                .map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Grado de destino">
          {(c) => (
            <Select
              {...c}
              value={strategy}
              onChange={(e) => (setStrategy(e.target.value as 'NEXT' | 'SAME'), reset())}
            >
              <option value="NEXT">Grado siguiente</option>
              <option value="SAME">Mismo grado</option>
            </Select>
          )}
        </Field>
      </div>
      {preview && (
        <div className="flex flex-col gap-3 text-sm">
          <Alert tone="info">
            Se crearían {preview.created.length} prematrícula(s) y se omitirían{' '}
            {preview.skipped.length}. La promoción según resultados académicos se configurará con el
            SIEE.
          </Alert>
          {preview.created.length > 0 && (
            <details open={preview.created.length <= 10}>
              <summary className="cursor-pointer font-medium">Se renuevan</summary>
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {preview.created.map((c) => (
                  <li key={c.studentId}>
                    {c.name}: {c.fromGrade} → {c.toGrade}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">Se omiten</summary>
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {preview.skipped.map((s) => (
                  <li key={s.studentId}>
                    {s.name}: {RENEWAL_SKIP_LABELS[s.reason]}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </FormDialog>
  );
}

export function EnrollmentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: years = [] } = useAcademicYears();
  const activeYear = years.find((y) => y.status === 'ACTIVE');
  const [filters, setFilters] = useState<EnrollmentFilters & { search: string }>({
    page: 1,
    pageSize: 20,
    search: '',
    status: '',
  });
  const yearId = filters.academicYearId ?? activeYear?.id ?? '';
  const search = useDeferredValue(filters.search);
  const [enrolling, setEnrolling] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const { data: grades = [] } = useQuery({
    queryKey: ['grades'],
    queryFn: ({ signal }) => academicsService.grades(signal),
  });
  const { data: groups = [] } = useQuery({
    queryKey: ['school-groups', { academicYearId: yearId }],
    queryFn: ({ signal }) => academicsService.groups({ academicYearId: yearId }, signal),
    enabled: !!yearId,
  });
  const query = { ...filters, academicYearId: yearId || undefined, search };
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['enrollments', query],
    queryFn: ({ signal }) => enrollmentsService.list(query, signal),
    placeholderData: keepPreviousData,
  });
  const update = (patch: Partial<typeof filters>) =>
    setFilters((f) => ({ ...f, page: 1, ...patch }));
  const canManage = can(PERMISSIONS.ENROLLMENTS_MANAGE);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Matrículas"
        description="Matrícula por año lectivo, ubicación en grupos, retiros, traslados y renovación."
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setRenewing(true)}>
                <RefreshCw aria-hidden /> Renovar
              </Button>
              <Button onClick={() => setEnrolling(true)}>
                <Plus aria-hidden /> Matricular
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Buscar matrículas"
              placeholder="Nombre, documento o código"
              className="pl-8"
              value={filters.search}
              onChange={(e) => update({ search: e.target.value })}
            />
          </div>
          <Select
            aria-label="Año lectivo"
            value={yearId}
            onChange={(e) => update({ academicYearId: e.target.value, schoolGroupId: undefined })}
          >
            <option value="">Todos los años</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Grado"
            value={filters.gradeId ?? ''}
            onChange={(e) =>
              update({ gradeId: e.target.value || undefined, schoolGroupId: undefined })
            }
          >
            <option value="">Todos los grados</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Estado"
            value={filters.status ?? ''}
            onChange={(e) => update({ status: e.target.value as EnrollmentFilters['status'] })}
          >
            <option value="">Todos los estados</option>
            {ENROLLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ENROLLMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          {yearId && (
            <Select
              aria-label="Grupo"
              className="lg:col-span-2"
              value={filters.schoolGroupId ?? ''}
              onChange={(e) => update({ schoolGroupId: e.target.value || undefined })}
            >
              <option value="">Todos los grupos</option>
              {groups
                .filter((g) => !filters.gradeId || g.gradeId === filters.gradeId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {g.campusName}
                  </option>
                ))}
            </Select>
          )}
        </div>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No hay matrículas que coincidan" />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <Th>Estudiante</Th>
                  <Th>Año y grado</Th>
                  <Th>Grupo</Th>
                  <Th>Fecha</Th>
                  <Th>Estado</Th>
                </tr>
              </THead>
              <TBody>
                {data.data.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-muted/50">
                    <Td>
                      <Link
                        to={`/matriculas/${e.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {fullName(e.student)}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {e.student.documentType} {e.student.documentNumber}
                      </span>
                    </Td>
                    <Td>
                      {e.academicYear.year} · {e.grade.name}
                    </Td>
                    <Td>
                      {e.currentGroup?.name ?? (
                        <span className="text-muted-foreground">Sin grupo</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(e.enrolledOn)}</Td>
                    <Td>
                      <Badge tone={ENROLLMENT_STATUS_TONES[e.status]}>
                        {ENROLLMENT_STATUS_LABELS[e.status]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination
              meta={data.meta}
              onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
            />
          </div>
        )}
      </Card>
      {canManage && (
        <>
          <EnrollDialog
            open={enrolling}
            onOpenChange={setEnrolling}
            onEnrolled={(id) => navigate(`/matriculas/${id}`)}
          />
          <RenewDialog open={renewing} onOpenChange={setRenewing} />
        </>
      )}
    </div>
  );
}

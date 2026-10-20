import { PERMISSIONS } from '@educore/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader, Pagination } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { useAcademicYears } from '@/features/academics/academics.service';
import { useAuth } from '@/features/auth/auth-context';
import { applyServerErrors } from '@/lib/forms';
import { formatDate, fullName } from '@/lib/format';
import {
  ADMISSION_STATUS_LABELS,
  ADMISSION_STATUS_TONES,
  ADMISSION_STATUSES,
  type AdmissionStatus,
  admissionsService,
} from '../admissions.service';
import { AdmissionFields } from '../components/admission-form';
import { toAdmissionInput, useAdmissionForm } from '../components/admission-form.schema';

function CreateAdmissionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useAdmissionForm();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => admissionsService.create(toAdmissionInput(form.getValues())),
    onSuccess: async (admission) => {
      await queryClient.invalidateQueries({ queryKey: ['admissions'] });
      toast.success(`Solicitud ${admission.code} registrada como borrador.`);
      onOpenChange(false);
      form.reset();
      navigate(`/admisiones/${admission.id}`);
    },
    onError: (e) =>
      setError(
        applyServerErrors(e, form.setError, [
          'academicYearId',
          'gradeId',
          'applicant',
          'guardian',
          'previousSchool',
          'notes',
        ]),
      ),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
      title="Nueva solicitud de admisión"
      description="Los datos del aspirante solo se convierten en estudiante al matricularlo."
      className="max-w-3xl"
      submitLabel="Registrar"
      pending={mutation.isPending}
      error={error}
      onSubmit={form.handleSubmit(() => {
        setError(null);
        mutation.mutate();
      })}
    >
      <AdmissionFields form={form} />
    </FormDialog>
  );
}

export function AdmissionsPage() {
  const { can } = useAuth();
  const { data: years = [] } = useAcademicYears();
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    search: '',
    status: '' as AdmissionStatus | '',
    academicYearId: '',
  });
  const search = useDeferredValue(filters.search);
  const [creating, setCreating] = useState(false);
  const query = { ...filters, search };
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['admissions', query],
    queryFn: ({ signal }) => admissionsService.list(query, signal),
    placeholderData: keepPreviousData,
  });
  const update = (patch: Partial<typeof filters>) =>
    setFilters((f) => ({ ...f, page: 1, ...patch }));
  const canManage = can(PERMISSIONS.ADMISSIONS_MANAGE);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Admisiones"
        description="Solicitudes de ingreso: documentos, revisión, decisión y matrícula."
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Nueva solicitud
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Buscar solicitudes"
              placeholder="Nombre o documento del aspirante"
              className="pl-8"
              value={filters.search}
              onChange={(e) => update({ search: e.target.value })}
            />
          </div>
          <Select
            aria-label="Año lectivo"
            className="sm:w-44"
            value={filters.academicYearId}
            onChange={(e) => update({ academicYearId: e.target.value })}
          >
            <option value="">Todos los años</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Estado"
            className="sm:w-44"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as AdmissionStatus | '' })}
          >
            <option value="">Todos los estados</option>
            {ADMISSION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ADMISSION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No hay solicitudes que coincidan" />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <Th>Solicitud</Th>
                  <Th>Aspirante</Th>
                  <Th>Grado</Th>
                  <Th>Registrada</Th>
                  <Th>Estado</Th>
                </tr>
              </THead>
              <TBody>
                {data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-muted/50">
                    <Td>
                      <Link
                        to={`/admisiones/${a.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {a.code}
                      </Link>
                    </Td>
                    <Td>
                      {fullName(a.applicant)}
                      <span className="block text-xs text-muted-foreground">
                        {a.applicant.documentType} {a.applicant.documentNumber}
                      </span>
                    </Td>
                    <Td>
                      {a.grade.name} · {a.academicYear.year}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(a.createdAt)}</Td>
                    <Td>
                      <Badge tone={ADMISSION_STATUS_TONES[a.status]}>
                        {ADMISSION_STATUS_LABELS[a.status]}
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
      {canManage && <CreateAdmissionDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}

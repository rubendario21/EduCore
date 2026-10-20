import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS } from '@educore/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Upload } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader, Pagination } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { useAuth } from '@/features/auth/auth-context';
import { applyServerErrors } from '@/lib/forms';
import { fullName } from '@/lib/format';
import { PersonFields } from '../components/person-fields';
import { emptyPerson, personSchema, valuesToPerson } from '../components/person-form';
import {
  peopleService,
  STUDENT_STATUS_LABELS,
  STUDENT_STATUS_TONES,
  STUDENT_STATUSES,
  type StudentStatus,
} from '../people.service';

const createSchema = z.object({
  person: personSchema,
  code: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[A-Za-z0-9-]{1,30}$/.test(v),
      'Hasta 30 letras, números o guiones.',
    ),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateStudentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { person: emptyPerson('TI'), code: '' },
  });
  const mutation = useMutation({
    mutationFn: (v: CreateValues) =>
      peopleService.createStudent({ person: valuesToPerson(v.person), code: v.code || undefined }),
    onSuccess: async (student) => {
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success('Estudiante registrado.');
      onOpenChange(false);
      form.reset();
      navigate(`/estudiantes/${student.id}`);
    },
    onError: (e) => setError(applyServerErrors(e, form.setError, ['person', 'code'])),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
      title="Nuevo estudiante"
      description="Después podrás vincular sus acudientes y matricularlo."
      className="max-w-2xl"
      submitLabel="Registrar"
      pending={mutation.isPending}
      error={error}
      onSubmit={form.handleSubmit((v) => {
        setError(null);
        mutation.mutate(v);
      })}
    >
      <PersonFields form={form} prefix="person" />
      <Field
        label="Código institucional"
        error={form.formState.errors.code?.message}
        hint="Opcional."
      >
        {(c) => <Input {...c} {...form.register('code')} className="sm:w-60" />}
      </Field>
    </FormDialog>
  );
}

export function StudentsPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    search: '',
    status: '' as StudentStatus | '',
  });
  const search = useDeferredValue(filters.search);
  const [creating, setCreating] = useState(false);
  const query = { ...filters, search };
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['students', query],
    queryFn: ({ signal }) => peopleService.students(query, signal),
    placeholderData: keepPreviousData,
  });
  const update = (patch: Partial<typeof filters>) =>
    setFilters((f) => ({ ...f, page: 1, ...patch }));
  const canManage = can(PERMISSIONS.STUDENTS_MANAGE);
  const canImport =
    canManage && can(PERMISSIONS.GUARDIANS_MANAGE) && can(PERMISSIONS.ENROLLMENTS_MANAGE);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Estudiantes"
        description="Estudiantes de la institución, con sus acudientes y su historial."
        actions={
          <>
            {canImport && (
              <Button variant="outline" asChild>
                <Link to="/importar-estudiantes">
                  <Upload aria-hidden /> Importar
                </Link>
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> Nuevo estudiante
              </Button>
            )}
          </>
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
              aria-label="Buscar estudiantes"
              placeholder="Buscar por nombre, documento o código"
              className="pl-8"
              value={filters.search}
              onChange={(e) => update({ search: e.target.value })}
            />
          </div>
          <Select
            aria-label="Filtrar por estado"
            className="sm:w-44"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as StudentStatus | '' })}
          >
            <option value="">Todos los estados</option>
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STUDENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No hay estudiantes que coincidan"
            description={
              filters.search || filters.status
                ? 'Prueba con otros filtros.'
                : 'Registra el primero o importa un archivo.'
            }
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <Th>Nombre</Th>
                  <Th>Documento</Th>
                  <Th>Código</Th>
                  <Th>Acudiente principal</Th>
                  <Th>Estado</Th>
                </tr>
              </THead>
              <TBody>
                {data.data.map((s) => {
                  const primary = s.guardians.find((g) => g.isPrimary);
                  return (
                    <tr key={s.id} className="hover:bg-surface-muted/50">
                      <Td>
                        <Link
                          to={`/estudiantes/${s.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {fullName(s.person)}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {s.person.documentType} {s.person.documentNumber}
                      </Td>
                      <Td>{s.code ?? '—'}</Td>
                      <Td>
                        {primary ? (
                          fullName(primary.person)
                        ) : (
                          <span className="text-muted-foreground">Sin acudiente</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={STUDENT_STATUS_TONES[s.status]}>
                          {STUDENT_STATUS_LABELS[s.status]}
                        </Badge>
                      </Td>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
            <Pagination
              meta={data.meta}
              onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
            />
          </div>
        )}
      </Card>
      {canManage && <CreateStudentDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}

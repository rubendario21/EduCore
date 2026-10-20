import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS } from '@educore/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader, Pagination } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { useAuth } from '@/features/auth/auth-context';
import { applyServerErrors, nullIfEmpty, optionalText } from '@/lib/forms';
import { fullName } from '@/lib/format';
import { PersonFields } from '../components/person-fields';
import {
  emptyPerson,
  personSchema,
  personToValues,
  valuesToPerson,
} from '../components/person-form';
import { type Guardian, peopleService, RELATIONSHIP_LABELS } from '../people.service';

const schema = z.object({
  person: personSchema,
  occupation: optionalText(120),
  workplace: optionalText(150),
});
type Values = z.infer<typeof schema>;

function GuardianDialog({
  guardian,
  open,
  onOpenChange,
}: {
  guardian: Guardian | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: guardian
      ? {
          person: personToValues(guardian.person),
          occupation: guardian.occupation ?? '',
          workplace: guardian.workplace ?? '',
        }
      : { person: emptyPerson('CC'), occupation: '', workplace: '' },
  });
  const mutation = useMutation({
    mutationFn: (v: Values) => {
      const input = {
        person: valuesToPerson(v.person),
        occupation: nullIfEmpty(v.occupation),
        workplace: nullIfEmpty(v.workplace),
      };
      return guardian
        ? peopleService.updateGuardian(guardian.id, input)
        : peopleService.createGuardian(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['guardians'] });
      toast.success(guardian ? 'Acudiente actualizado.' : 'Acudiente registrado.');
      onOpenChange(false);
    },
    onError: (e) =>
      setError(applyServerErrors(e, form.setError, ['person', 'occupation', 'workplace'])),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
      title={guardian ? 'Editar acudiente' : 'Nuevo acudiente'}
      description={
        guardian
          ? undefined
          : 'Para vincularlo a un estudiante, hazlo desde la ficha del estudiante.'
      }
      className="max-w-2xl"
      submitLabel="Guardar"
      pending={mutation.isPending}
      error={error}
      onSubmit={form.handleSubmit((v) => {
        setError(null);
        mutation.mutate(v);
      })}
    >
      <PersonFields form={form} prefix="person" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ocupación" error={form.formState.errors.occupation?.message}>
          {(c) => <Input {...c} {...form.register('occupation')} />}
        </Field>
        <Field label="Lugar de trabajo" error={form.formState.errors.workplace?.message}>
          {(c) => <Input {...c} {...form.register('workplace')} />}
        </Field>
      </div>
    </FormDialog>
  );
}

export function GuardiansPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ page: 1, pageSize: 20, search: '' });
  const search = useDeferredValue(filters.search);
  const [editing, setEditing] = useState<Guardian | null | 'new'>(null);
  const query = { ...filters, search };
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['guardians', query],
    queryFn: ({ signal }) => peopleService.guardians(query, signal),
    placeholderData: keepPreviousData,
  });
  const canManage = can(PERMISSIONS.GUARDIANS_MANAGE);
  const canSeeStudents = can(PERMISSIONS.STUDENTS_READ);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Acudientes"
        description="Madres, padres y demás responsables de los estudiantes."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Nuevo acudiente
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Buscar acudientes"
              placeholder="Buscar por nombre o documento"
              className="pl-8"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, page: 1, search: e.target.value }))}
            />
          </div>
        </div>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No hay acudientes que coincidan" />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <Th>Nombre</Th>
                  <Th>Documento</Th>
                  <Th>Contacto</Th>
                  <Th>Estudiantes</Th>
                  {canManage && <Th className="w-10" />}
                </tr>
              </THead>
              <TBody>
                {data.data.map((g) => (
                  <tr key={g.id} className="align-top hover:bg-surface-muted/50">
                    <Td className="font-medium">{fullName(g.person)}</Td>
                    <Td className="whitespace-nowrap">
                      {g.person.documentType} {g.person.documentNumber}
                    </Td>
                    <Td className="text-muted-foreground">
                      {[g.person.phone, g.person.email].filter(Boolean).join(' · ') || '—'}
                    </Td>
                    <Td>
                      <ul className="flex flex-col gap-0.5">
                        {g.students.map((s) => (
                          <li key={s.studentId}>
                            {canSeeStudents ? (
                              <Link
                                to={`/estudiantes/${s.studentId}`}
                                className="text-primary hover:underline"
                              >
                                {fullName(s.person)}
                              </Link>
                            ) : (
                              fullName(s.person)
                            )}{' '}
                            <span className="text-xs text-muted-foreground">
                              ({RELATIONSHIP_LABELS[s.relationship]})
                            </span>
                          </li>
                        ))}
                        {g.students.length === 0 && <li className="text-muted-foreground">—</li>}
                      </ul>
                    </Td>
                    {canManage && (
                      <Td>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${fullName(g.person)}`}
                          onClick={() => setEditing(g)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                      </Td>
                    )}
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
        <GuardianDialog
          guardian={editing === 'new' ? null : editing}
          open={editing !== null}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </div>
  );
}

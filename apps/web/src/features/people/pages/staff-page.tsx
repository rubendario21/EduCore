import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS, RECORD_STATUSES } from '@educore/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader, Pagination } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { useAuth } from '@/features/auth/auth-context';
import { useRoles } from '@/features/roles/roles.service';
import { getErrorMessage } from '@/lib/api-client';
import { applyServerErrors, emailField, nullIfEmpty, optionalText } from '@/lib/forms';
import { formatDate, fullName } from '@/lib/format';
import { PersonFields } from '../components/person-fields';
import {
  emptyPerson,
  personSchema,
  personToValues,
  valuesToPerson,
} from '../components/person-form';
import {
  accessGrantedMessage,
  peopleService,
  STAFF_TYPE_LABELS,
  STAFF_TYPES,
  type StaffMember,
  type StaffType,
} from '../people.service';

const schema = z.object({
  person: personSchema,
  staffType: z.enum(STAFF_TYPES),
  title: optionalText(120),
  hireDate: z.string(),
  status: z.enum(RECORD_STATUSES),
});
type Values = z.infer<typeof schema>;

function StaffDialog({
  member,
  open,
  onOpenChange,
}: {
  member: StaffMember | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: member
      ? {
          person: personToValues(member.person),
          staffType: member.staffType,
          title: member.title ?? '',
          hireDate: member.hireDate ?? '',
          status: member.status,
        }
      : {
          person: emptyPerson('CC'),
          staffType: 'TEACHER',
          title: '',
          hireDate: '',
          status: 'ACTIVE',
        },
  });
  const mutation = useMutation({
    mutationFn: (v: Values) => {
      const base = {
        person: valuesToPerson(v.person),
        staffType: v.staffType,
        title: nullIfEmpty(v.title),
        hireDate: nullIfEmpty(v.hireDate),
      };
      return member
        ? peopleService.updateStaff(member.id, { ...base, status: v.status })
        : peopleService.createStaff(base);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success(member ? 'Datos actualizados.' : 'Miembro del personal registrado.');
      onOpenChange(false);
    },
    onError: (e) =>
      setError(
        applyServerErrors(e, form.setError, ['person', 'staffType', 'title', 'hireDate', 'status']),
      ),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
      title={member ? 'Editar miembro del personal' : 'Nuevo miembro del personal'}
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
        <Field label="Tipo" required hint="Solo el personal docente recibe asignaturas.">
          {(c) => (
            <Select {...c} {...form.register('staffType')}>
              {STAFF_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STAFF_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Cargo" error={form.formState.errors.title?.message}>
          {(c) => <Input {...c} placeholder="Docente de matemáticas" {...form.register('title')} />}
        </Field>
        <Field label="Fecha de ingreso">
          {(c) => <Input {...c} type="date" {...form.register('hireDate')} />}
        </Field>
        {member && (
          <Field label="Estado">
            {(c) => (
              <Select {...c} {...form.register('status')}>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
              </Select>
            )}
          </Field>
        )}
      </div>
    </FormDialog>
  );
}

function AccessDialog({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: roles = [] } = useRoles(member !== null);
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (value: string) => peopleService.staffAccess(member!.id, value, selected),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      const { tone, text } = accessGrantedMessage(result);
      toast[tone](text, { duration: tone === 'warning' ? 10_000 : undefined });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const staffRoles = roles.filter((r) => r.code !== 'STUDENT' && r.code !== 'GUARDIAN');
  return (
    <FormDialog
      open={member !== null}
      onOpenChange={(o) => {
        if (!o) {
          setEmail('');
          setSelected([]);
          setError(null);
          onClose();
        }
      }}
      title="Dar acceso a EduCore"
      description={member ? fullName(member.person) : undefined}
      submitLabel="Dar acceso"
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        const parsed = emailField.safeParse(email);
        if (!parsed.success) return setError('Ingresa un correo electrónico válido.');
        if (selected.length === 0) return setError('Asigna al menos un rol.');
        mutation.mutate(parsed.data);
      }}
    >
      <Field label="Correo de acceso" required>
        {(c) => (
          <Input {...c} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </Field>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Roles</legend>
        {staffRoles.map((r) => (
          <label key={r.code} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <Checkbox
              checked={selected.includes(r.code)}
              onChange={(e) =>
                setSelected((s) =>
                  e.target.checked ? [...s, r.code] : s.filter((c) => c !== r.code),
                )
              }
            />
            {r.name}
          </label>
        ))}
      </fieldset>
    </FormDialog>
  );
}

export function StaffPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    search: '',
    staffType: '' as StaffType | '',
  });
  const search = useDeferredValue(filters.search);
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);
  const [granting, setGranting] = useState<StaffMember | null>(null);
  const query = { ...filters, search };
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['staff', query],
    queryFn: ({ signal }) => peopleService.staff(query, signal),
    placeholderData: keepPreviousData,
  });
  const canManage = can(PERMISSIONS.STAFF_MANAGE);
  const canGrant =
    canManage && can(PERMISSIONS.USERS_CREATE) && can(PERMISSIONS.USERS_ROLES_ASSIGN);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Personal"
        description="Docentes, directivos, administrativos y personal de apoyo."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Nuevo
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
              aria-label="Buscar personal"
              placeholder="Buscar por nombre o documento"
              className="pl-8"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, page: 1, search: e.target.value }))}
            />
          </div>
          <Select
            aria-label="Filtrar por tipo"
            className="sm:w-48"
            value={filters.staffType}
            onChange={(e) =>
              setFilters((f) => ({ ...f, page: 1, staffType: e.target.value as StaffType | '' }))
            }
          >
            <option value="">Todos los tipos</option>
            {STAFF_TYPES.map((t) => (
              <option key={t} value={t}>
                {STAFF_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No hay personal que coincida" />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <Th>Nombre</Th>
                  <Th>Tipo y cargo</Th>
                  <Th>Ingreso</Th>
                  <Th>Acceso</Th>
                  <Th>Estado</Th>
                  {canManage && <Th className="w-20" />}
                </tr>
              </THead>
              <TBody>
                {data.data.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-muted/50">
                    <Td>
                      <span className="font-medium">{fullName(m.person)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.person.documentType} {m.person.documentNumber}
                      </span>
                    </Td>
                    <Td>
                      {STAFF_TYPE_LABELS[m.staffType]}
                      {m.title && (
                        <span className="block text-xs text-muted-foreground">{m.title}</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(m.hireDate)}</Td>
                    <Td>
                      {m.person.hasAccess ? (
                        <Badge tone="primary">Con cuenta</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {m.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </Td>
                    {canManage && (
                      <Td className="whitespace-nowrap">
                        {canGrant && !m.person.hasAccess && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Dar acceso a ${fullName(m.person)}`}
                            onClick={() => setGranting(m)}
                          >
                            <KeyRound aria-hidden />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${fullName(m.person)}`}
                          onClick={() => setEditing(m)}
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
        <StaffDialog
          member={editing === 'new' ? null : editing}
          open={editing !== null}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      {canGrant && <AccessDialog member={granting} onClose={() => setGranting(null)} />}
    </div>
  );
}

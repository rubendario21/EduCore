import { zodResolver } from '@hookform/resolvers/zod';
import { MEMBERSHIP_STATUSES, PERMISSIONS } from '@educore/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm, type UseFormRegister, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader, Pagination } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { useAuth } from '@/features/auth/auth-context';
import { useRoles } from '@/features/roles/roles.service';
import { applyServerErrors, nullIfEmpty } from '@/lib/forms';
import { formatDateTime, fullName } from '@/lib/format';
import { UserFormFields } from '../components/user-form-fields';
import {
  USER_FIELD_NAMES,
  type UserFields,
  userFieldsSchema,
} from '../components/user-form.schema';
import {
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUS_TONES,
  type UserFilters,
  usersService,
} from '../users.service';

const createSchema = userFieldsSchema.extend({
  roleCodes: z.array(z.string()).min(1, 'Asigna al menos un rol.'),
});
type CreateForm = z.infer<typeof createSchema>;

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: roles = [] } = useRoles(open);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      email: '',
      documentType: 'CC',
      documentNumber: '',
      firstNames: '',
      lastNames: '',
      birthDate: '',
      phone: '',
      address: '',
      roleCodes: [],
    },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateForm) =>
      usersService.create({
        ...values,
        birthDate: nullIfEmpty(values.birthDate),
        phone: nullIfEmpty(values.phone),
        address: nullIfEmpty(values.address),
      }),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      if (user.activationEmail === 'FAILED') {
        toast.warning(
          `Usuario creado, pero no se pudo enviar el correo a ${user.email}. Revisa la configuración del correo y usa "Reenviar acceso" en su ficha.`,
          { duration: 10_000 },
        );
      } else {
        toast.success(`Usuario creado. Enviamos a ${user.email} el enlace para activar su cuenta.`);
      }
      onOpenChange(false);
      form.reset();
      navigate(`/usuarios/${user.id}`);
    },
    onError: (e) =>
      setError(applyServerErrors(e, form.setError, [...USER_FIELD_NAMES, 'roleCodes'])),
  });

  const selected = useWatch({ control: form.control, name: 'roleCodes' });
  const toggleRole = (code: string, checked: boolean) =>
    form.setValue('roleCodes', checked ? [...selected, code] : selected.filter((c) => c !== code), {
      shouldValidate: form.formState.isSubmitted,
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title="Nuevo usuario"
      description="La persona recibirá un correo para definir su contraseña. Tú nunca la conocerás."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="create-user-form" disabled={mutation.isPending}>
            {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            Crear usuario
          </Button>
        </>
      }
    >
      <form
        id="create-user-form"
        noValidate
        className="flex flex-col gap-5"
        onSubmit={form.handleSubmit((values) => {
          setError(null);
          mutation.mutate(values);
        })}
      >
        {error && <Alert>{error}</Alert>}
        <UserFormFields
          // El formulario de alta extiende los datos personales con los roles.
          register={form.register as unknown as UseFormRegister<UserFields>}
          errors={form.formState.errors}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">
            Roles <span className="text-danger">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => (
              <label
                key={role.code}
                className="flex items-start gap-2 rounded-md border p-2 text-sm"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.includes(role.code)}
                  onChange={(e) => toggleRole(role.code, e.target.checked)}
                />
                <span>
                  <span className="font-medium">{role.name}</span>
                  {role.description && (
                    <span className="block text-xs text-muted-foreground">{role.description}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {form.formState.errors.roleCodes && (
            <p className="text-xs text-danger">{form.formState.errors.roleCodes.message}</p>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

export function UsersPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState<UserFilters>({
    page: 1,
    pageSize: 20,
    search: '',
    status: '',
    roleCode: '',
  });
  const search = useDeferredValue(filters.search);
  const [creating, setCreating] = useState(false);
  const { data: roles = [] } = useRoles(can(PERMISSIONS.ROLES_READ));

  const query = { ...filters, search };
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['users', query],
    queryFn: ({ signal }) => usersService.list(query, signal),
    placeholderData: keepPreviousData,
  });

  const update = (patch: Partial<UserFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const canCreate = can(PERMISSIONS.USERS_CREATE) && can(PERMISSIONS.USERS_ROLES_ASSIGN);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Usuarios"
        description="Personas con acceso a EduCore en la institución."
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Nuevo usuario
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
              aria-label="Buscar usuarios"
              placeholder="Buscar por nombre, documento o correo"
              className="pl-8"
              value={filters.search}
              onChange={(e) => update({ search: e.target.value })}
            />
          </div>
          <Select
            aria-label="Filtrar por estado"
            className="sm:w-40"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as UserFilters['status'] })}
          >
            <option value="">Todos los estados</option>
            {MEMBERSHIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MEMBERSHIP_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          {roles.length > 0 && (
            <Select
              aria-label="Filtrar por rol"
              className="sm:w-52"
              value={filters.roleCode}
              onChange={(e) => update({ roleCode: e.target.value })}
            >
              <option value="">Todos los roles</option>
              {roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
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
          <EmptyState
            title="No hay usuarios que coincidan"
            description={
              filters.search || filters.status || filters.roleCode
                ? 'Prueba con otros filtros.'
                : undefined
            }
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <Th>Nombre</Th>
                  <Th>Documento</Th>
                  <Th>Roles</Th>
                  <Th>Estado</Th>
                  <Th>Último ingreso</Th>
                </tr>
              </THead>
              <TBody>
                {data.data.map((user) => (
                  <tr key={user.id} className="hover:bg-surface-muted/50">
                    <Td>
                      <Link
                        to={`/usuarios/${user.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {fullName(user)}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{user.email}</span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {user.documentType} {user.documentNumber}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r) => (
                          <Badge key={r.id}>{r.name}</Badge>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={MEMBERSHIP_STATUS_TONES[user.status]}>
                        {MEMBERSHIP_STATUS_LABELS[user.status]}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(user.lastLoginAt)}
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

      {canCreate && <CreateUserDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}

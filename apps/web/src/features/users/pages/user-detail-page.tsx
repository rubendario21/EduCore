import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LoaderCircle, Mail, ShieldAlert, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-context';
import { useRoles } from '@/features/roles/roles.service';
import { getErrorMessage } from '@/lib/api-client';
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
  type User,
  usersService,
} from '../users.service';

function useUserMutation<T>(userId: string, fn: (input: T) => Promise<User>, success: string) {
  const queryClient = useQueryClient();
  const { user: me, reloadUser } = useAuth();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(['users', 'detail', userId], updated);
      await queryClient.invalidateQueries({ queryKey: ['users'], exact: false });
      if (updated.id === me?.id) await reloadUser();
      toast.success(success);
    },
  });
}

function DataCard({ user, editable }: { user: User; editable: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const toForm = (u: User): UserFields => ({
    email: u.email,
    documentType: u.documentType,
    documentNumber: u.documentNumber,
    firstNames: u.firstNames,
    lastNames: u.lastNames,
    birthDate: u.birthDate ?? '',
    phone: u.phone ?? '',
    address: u.address ?? '',
  });
  const form = useForm<UserFields>({
    resolver: zodResolver(userFieldsSchema),
    values: toForm(user),
  });
  const mutation = useUserMutation(
    user.id,
    (v: UserFields) =>
      usersService.update(user.id, {
        ...v,
        birthDate: nullIfEmpty(v.birthDate),
        phone: nullIfEmpty(v.phone),
        address: nullIfEmpty(v.address),
      }),
    'Datos actualizados.',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos personales</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            mutation.mutate(values, {
              onError: (e) => setError(applyServerErrors(e, form.setError, USER_FIELD_NAMES)),
            });
          })}
        >
          {error && <Alert>{error}</Alert>}
          <fieldset disabled={!editable} className="contents">
            <UserFormFields register={form.register} errors={form.formState.errors} />
          </fieldset>
          {editable && (
            <div className="flex justify-end">
              <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
                {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
                Guardar cambios
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function RolesCard({ user, isSelf }: { user: User; isSelf: boolean }) {
  const { can } = useAuth();
  const editable = can(PERMISSIONS.USERS_ROLES_ASSIGN) && !isSelf;
  const { data: roles = [], isPending } = useRoles(can(PERMISSIONS.ROLES_READ));
  const [selected, setSelected] = useState<string[]>(user.roles.map((r) => r.code));
  const [error, setError] = useState<string | null>(null);
  const mutation = useUserMutation(
    user.id,
    (codes: string[]) => usersService.setRoles(user.id, codes),
    'Roles actualizados.',
  );
  const dirty =
    [...selected].sort().join() !==
    user.roles
      .map((r) => r.code)
      .sort()
      .join();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>
          {isSelf
            ? 'No puedes cambiar tus propios roles; pídelo a otro administrador.'
            : 'Solo puedes asignar roles cuyos permisos también tienes.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert>{error}</Alert>}
        {!editable || isPending ? (
          <div className="flex flex-wrap gap-1">
            {user.roles.map((r) => (
              <Badge key={r.id} tone="primary">
                {r.name}
              </Badge>
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <label
                  key={role.code}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <Checkbox
                    checked={selected.includes(role.code)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, role.code] : s.filter((c) => c !== role.code),
                      )
                    }
                  />
                  {role.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                disabled={!dirty || selected.length === 0 || mutation.isPending}
                onClick={() => {
                  setError(null);
                  mutation.mutate(selected, { onError: (e) => setError(getErrorMessage(e)) });
                }}
              >
                {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
                Guardar roles
              </Button>
            </div>
            {selected.length === 0 && (
              <p className="text-xs text-danger">El usuario debe conservar al menos un rol.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AccessCard({ user, isSelf }: { user: User; isSelf: boolean }) {
  const { can } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const statusMutation = useUserMutation(
    user.id,
    (status: 'ACTIVE' | 'SUSPENDED') => usersService.setStatus(user.id, status),
    user.status === 'SUSPENDED'
      ? 'Usuario reactivado.'
      : 'Usuario suspendido. Sus sesiones se cerraron.',
  );
  const emailMutation = useMutation({
    mutationFn: () => usersService.sendAccessEmail(user.id),
    onSuccess: ({ sent }) =>
      toast.success(
        sent === 'ACTIVATION'
          ? 'Enviamos de nuevo el enlace de activación.'
          : 'Enviamos un enlace para restablecer la contraseña.',
      ),
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (!can(PERMISSIONS.USERS_STATUS)) return null;
  const suspended = user.status === 'SUSPENDED';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acceso</CardTitle>
        <CardDescription>Último ingreso: {formatDateTime(user.lastLoginAt)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!suspended && (
          <Button
            variant="outline"
            onClick={() => emailMutation.mutate()}
            disabled={emailMutation.isPending}
          >
            <Mail aria-hidden />
            {user.status === 'INVITED'
              ? 'Reenviar enlace de activación'
              : 'Enviar enlace para restablecer contraseña'}
          </Button>
        )}
        {isSelf ? (
          <p className="text-sm text-muted-foreground">No puedes suspender tu propia cuenta.</p>
        ) : suspended ? (
          <Button
            variant="outline"
            onClick={() =>
              statusMutation.mutate('ACTIVE', { onError: (e) => toast.error(getErrorMessage(e)) })
            }
            disabled={statusMutation.isPending}
          >
            <UserCheck aria-hidden /> Reactivar usuario
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            <UserX aria-hidden /> Suspender usuario
          </Button>
        )}
      </CardContent>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Suspender este usuario?"
        description={`${fullName(user)} no podrá iniciar sesión y sus sesiones abiertas se cerrarán de inmediato. Podrás reactivarlo después.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate('SUSPENDED', {
                  onSettled: () => setConfirming(false),
                  onError: (e) => toast.error(getErrorMessage(e)),
                })
              }
            >
              {statusMutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Suspender
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          La acción queda registrada en la auditoría.
        </p>
      </Dialog>
    </Card>
  );
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { user: me, can } = useAuth();
  const {
    data: user,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['users', 'detail', id],
    queryFn: ({ signal }) => usersService.get(id, signal),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        to="/usuarios"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Usuarios
      </Link>
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <PageHeader
            title={fullName(user)}
            description={user.email}
            actions={
              <Badge tone={MEMBERSHIP_STATUS_TONES[user.status]}>
                {MEMBERSHIP_STATUS_LABELS[user.status]}
              </Badge>
            }
          />
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <DataCard user={user} editable={can(PERMISSIONS.USERS_UPDATE)} />
            <div className="flex flex-col gap-6">
              <RolesCard
                key={user.roles.map((r) => r.code).join()}
                user={user}
                isSelf={user.id === me?.id}
              />
              <AccessCard user={user} isSelf={user.id === me?.id} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

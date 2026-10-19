import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS, type PermissionScope } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LoaderCircle, Lock, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Checkbox, Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage } from '@/lib/api-client';
import { applyServerErrors, optionalText, requiredText } from '@/lib/forms';
import {
  MODULE_LABELS,
  type PermissionInfo,
  type Role,
  rolesQueryKey,
  rolesService,
} from '../roles.service';

const schema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z][A-Z0-9_]{1,49}$/,
      'Empieza por una letra; solo mayúsculas, números y guion bajo.',
    ),
  name: requiredText('El nombre', 3, 100),
  description: optionalText(300),
});
type RoleForm = z.infer<typeof schema>;

type Grants = Map<string, PermissionScope>;

function PermissionPicker({
  catalog,
  grants,
  onChange,
  readOnly,
  canGrant,
}: {
  catalog: PermissionInfo[];
  grants: Grants;
  onChange: (grants: Grants) => void;
  readOnly: boolean;
  canGrant: (code: string) => boolean;
}) {
  const modules = useMemo(() => {
    const byModule = new Map<string, PermissionInfo[]>();
    for (const p of catalog) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
    return [...byModule.entries()];
  }, [catalog]);

  const toggle = (code: string, checked: boolean) => {
    const next = new Map(grants);
    if (checked) next.set(code, 'ALL');
    else next.delete(code);
    onChange(next);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {modules.map(([module, permissions]) => (
        <fieldset key={module} className="rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">{MODULE_LABELS[module] ?? module}</legend>
          <div className="flex flex-col gap-2">
            {permissions.map((p) => {
              const allowed = canGrant(p.code);
              return (
                <label key={p.code} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={grants.has(p.code)}
                    disabled={readOnly || !allowed}
                    onChange={(e) => toggle(p.code, e.target.checked)}
                  />
                  <span>
                    {p.description}
                    {!readOnly && !allowed && (
                      <span className="block text-xs text-muted-foreground">
                        No puedes concederlo: no lo tienes.
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function Editor({ role, catalog }: { role: Role | null; catalog: PermissionInfo[] }) {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const readOnly = !!role?.isSystem || !can(PERMISSIONS.ROLES_MANAGE);
  const [grants, setGrants] = useState<Grants>(
    new Map(role?.permissions.map((p) => [p.code, p.scope]) ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<RoleForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: role?.code ?? '',
      name: role?.name ?? '',
      description: role?.description ?? '',
    },
  });

  const myPermissions = new Set(user?.permissions.map((p) => p.code));
  const done = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: rolesQueryKey });
    toast.success(message);
    navigate('/roles');
  };

  const save = useMutation({
    mutationFn: (values: RoleForm) => {
      const permissions = [...grants].map(([code, scope]) => ({ code, scope }));
      return role
        ? rolesService.update(role.id, {
            name: values.name,
            description: values.description,
            permissions,
          })
        : rolesService.create({ ...values, permissions });
    },
    onSuccess: () => done(role ? 'Rol actualizado.' : 'Rol creado.'),
    onError: (e) => setError(applyServerErrors(e, form.setError, ['code', 'name', 'description'])),
  });

  const remove = useMutation({
    mutationFn: () => rolesService.remove(role!.id),
    onSuccess: () => done('Rol eliminado.'),
    onError: (e) => {
      setConfirmDelete(false);
      setError(getErrorMessage(e));
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((values) => {
        setError(null);
        save.mutate(values);
      })}
    >
      {role?.isSystem && (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <Lock className="size-4" aria-hidden /> Rol de sistema: sus permisos los define EduCore
            y no se pueden modificar.
          </span>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Datos del rol</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Código"
            required
            error={form.formState.errors.code?.message}
            hint="No se puede cambiar después."
          >
            {(c) => <Input {...c} disabled={!!role} {...form.register('code')} />}
          </Field>
          <Field label="Nombre" required error={form.formState.errors.name?.message}>
            {(c) => <Input {...c} disabled={readOnly} {...form.register('name')} />}
          </Field>
          <Field
            label="Descripción"
            error={form.formState.errors.description?.message}
            className="sm:col-span-2"
          >
            {(c) => <Input {...c} disabled={readOnly} {...form.register('description')} />}
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Permisos</CardTitle>
          <CardDescription>{grants.size} seleccionado(s).</CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionPicker
            catalog={catalog}
            grants={grants}
            onChange={setGrants}
            readOnly={readOnly}
            canGrant={(code) => myPermissions.has(code)}
          />
        </CardContent>
      </Card>
      {!readOnly && (
        <div className="flex flex-wrap justify-between gap-2">
          {role ? (
            <Button
              type="button"
              variant="outline"
              className="text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden /> Eliminar rol
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            {role ? 'Guardar cambios' : 'Crear rol'}
          </Button>
        </div>
      )}
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Eliminar este rol?"
        description={
          role && role.memberCount > 0
            ? `El rol tiene ${role.memberCount} usuario(s). Quítalo de esos usuarios antes de eliminarlo.`
            : 'Esta acción no se puede deshacer.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Eliminar
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          La eliminación queda registrada en la auditoría.
        </p>
      </Dialog>
    </form>
  );
}

export function RoleEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const catalog = useQuery({
    queryKey: ['permissions'],
    queryFn: ({ signal }) => rolesService.permissions(signal),
  });
  const role = useQuery({
    queryKey: [...rolesQueryKey, id],
    queryFn: ({ signal }) => rolesService.get(id!, signal),
    enabled: !isNew,
  });

  const loading = catalog.isPending || (!isNew && role.isPending);
  const error = catalog.error ?? role.error;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        to="/roles"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Roles y permisos
      </Link>
      <PageHeader title={isNew ? 'Nuevo rol' : (role.data?.name ?? 'Rol')} />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <Editor role={isNew ? null : role.data!} catalog={catalog.data!} />
      )}
    </div>
  );
}

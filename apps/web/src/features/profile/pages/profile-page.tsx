import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { DOCUMENT_TYPE_LABELS } from '@educore/shared';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authService } from '@/features/auth/auth.service';
import { usersService, type User } from '@/features/users/users.service';
import { ApiError } from '@/lib/api-client';
import {
  applyServerErrors,
  newPasswordField,
  nullIfEmpty,
  optionalText,
  phoneField,
} from '@/lib/forms';
import { formatDateTime, fullName } from '@/lib/format';

const profileSchema = z.object({ phone: phoneField, address: optionalText(300) });
type ProfileForm = z.infer<typeof profileSchema>;

function ProfileDataCard({ profile }: { profile: User }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { phone: profile.phone ?? '', address: profile.address ?? '' },
  });

  const mutation = useMutation({
    mutationFn: (values: ProfileForm) =>
      usersService.updateProfile({
        phone: nullIfEmpty(values.phone),
        address: nullIfEmpty(values.address),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['me', 'profile'], updated);
      form.reset({ phone: updated.phone ?? '', address: updated.address ?? '' });
      toast.success('Tus datos de contacto se guardaron.');
    },
    onError: (e) => setError(applyServerErrors(e, form.setError, ['phone', 'address'])),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mis datos</CardTitle>
        <CardDescription>Los nombres y el documento los gestiona la institución.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="mb-5 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Nombre</dt>
            <dd className="font-medium">{fullName(profile)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Documento</dt>
            <dd>
              {DOCUMENT_TYPE_LABELS[profile.documentType]} {profile.documentNumber}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Correo</dt>
            <dd className="break-all">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Último ingreso</dt>
            <dd>{formatDateTime(profile.lastLoginAt)}</dd>
          </div>
        </dl>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            mutation.mutate(values);
          })}
        >
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teléfono" error={form.formState.errors.phone?.message}>
              {(control) => (
                <Input {...control} type="tel" autoComplete="tel" {...form.register('phone')} />
              )}
            </Field>
            <Field label="Dirección" error={form.formState.errors.address?.message}>
              {(control) => (
                <Input {...control} autoComplete="street-address" {...form.register('address')} />
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
              {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Guardar cambios
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresa tu contraseña actual.'),
    newPassword: newPasswordField,
    confirmation: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmation, {
    path: ['confirmation'],
    message: 'Las contraseñas no coinciden.',
  });
type PasswordForm = z.infer<typeof passwordSchema>;

function ChangePasswordCard() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: PasswordForm) =>
      authService.changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      form.reset();
      toast.success('Contraseña actualizada. Cerramos tus otras sesiones abiertas.');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'CURRENT_PASSWORD_INVALID') {
        form.setError('currentPassword', { message: e.message });
        setError(null);
      } else {
        setError(applyServerErrors(e, form.setError, ['currentPassword', 'newPassword']));
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cambiar contraseña</CardTitle>
        <CardDescription>
          Al cambiarla se cerrarán tus sesiones en otros dispositivos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            mutation.mutate(values);
          })}
        >
          {error && <Alert>{error}</Alert>}
          <Field label="Contraseña actual" error={form.formState.errors.currentPassword?.message}>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Contraseña nueva"
              error={form.formState.errors.newPassword?.message}
              hint="Mínimo 10 caracteres."
            >
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  {...form.register('newPassword')}
                />
              )}
            </Field>
            <Field
              label="Confirma la contraseña"
              error={form.formState.errors.confirmation?.message}
            >
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  {...form.register('confirmation')}
                />
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ProfilePage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: ({ signal }) => usersService.getProfile(signal),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Mi perfil"
        description="Tus datos personales y la seguridad de tu cuenta."
      />
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <ProfileDataCard profile={data} />
      )}
      <ChangePasswordCard />
    </div>
  );
}

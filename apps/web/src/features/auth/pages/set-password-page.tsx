import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/layouts/auth-layout';
import { ApiError } from '@/lib/api-client';
import { applyServerErrors, newPasswordField } from '@/lib/forms';
import { authService } from '../auth.service';

const schema = z
  .object({ newPassword: newPasswordField, confirmation: z.string() })
  .refine((v) => v.newPassword === v.confirmation, {
    path: ['confirmation'],
    message: 'Las contraseñas no coinciden.',
  });
type SetPasswordForm = z.infer<typeof schema>;

const readTokenFromUrl = () => new URL(window.location.href).searchParams.get('token');

/**
 * Borra el token de la barra de direcciones para que no quede en el historial
 * ni se filtre al compartir la URL. Va en un efecto (no en el inicializador del
 * estado) porque React puede ejecutar los inicializadores dos veces.
 */
function useRemoveTokenFromUrl() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  }, []);
}

/** Definir contraseña con el enlace del correo: recuperación o activación de cuenta. */
export function SetPasswordPage({ mode }: { mode: 'reset' | 'activate' }) {
  const [token] = useState(readTokenFromUrl);
  useRemoveTokenFromUrl();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmation: '' },
  });

  const title = mode === 'activate' ? 'Activa tu cuenta' : 'Define una contraseña nueva';

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    setError(null);
    try {
      await authService.resetPassword(token ?? '', newPassword);
      setDone(true);
    } catch (e) {
      const invalidLink = e instanceof ApiError && e.code === 'INVALID_OR_EXPIRED_TOKEN';
      setError(invalidLink ? e.message : applyServerErrors(e, setFieldError, ['newPassword']));
    }
  });

  if (!token) {
    return (
      <AuthLayout title={title}>
        <Alert>El enlace no es válido. Ábrelo de nuevo desde tu correo o solicita uno nuevo.</Alert>
        <Link
          to="/recuperar-contrasena"
          className="mt-4 block text-center text-sm text-primary hover:underline"
        >
          Solicitar un enlace nuevo
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title={mode === 'activate' ? 'Cuenta activada' : 'Contraseña actualizada'}>
        <div className="flex flex-col items-center gap-3 text-center">
          <CircleCheck className="size-10 text-success" aria-hidden />
          <p className="text-sm">
            {mode === 'activate'
              ? 'Tu cuenta está lista. Ya puedes iniciar sesión.'
              : 'Por seguridad, cerramos todas tus sesiones abiertas. Inicia sesión con tu contraseña nueva.'}
          </p>
          <Button asChild className="w-full">
            <Link to="/iniciar-sesion">Iniciar sesión</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={title}
      description="Usa al menos 10 caracteres. Una frase fácil de recordar es más segura que una palabra corta con símbolos."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Contraseña nueva" error={errors.newPassword?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              autoFocus
              {...register('newPassword')}
            />
          )}
        </Field>
        <Field label="Confirma la contraseña" error={errors.confirmation?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              {...register('confirmation')}
            />
          )}
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
          {mode === 'activate' ? 'Activar mi cuenta' : 'Guardar contraseña'}
        </Button>
      </form>
    </AuthLayout>
  );
}

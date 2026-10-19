import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/layouts/auth-layout';
import { getErrorMessage } from '@/lib/api-client';
import { emailField } from '@/lib/forms';
import { useAuth } from '../auth-context';

const schema = z.object({
  email: emailField,
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});
type LoginForm = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      // Solo rutas internas: evita redirecciones abiertas a otros sitios.
      navigate(from?.startsWith('/') && !from.startsWith('//') ? from : '/', { replace: true });
    } catch (e) {
      setError(getErrorMessage(e));
    }
  });

  return (
    <AuthLayout title="Iniciar sesión" description="Ingresa con tu correo institucional.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Correo electrónico" error={errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              autoFocus
              {...register('email')}
            />
          )}
        </Field>
        <Field label="Contraseña" error={errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
          )}
        </Field>
        <Button type="submit" disabled={isSubmitting} className="mt-1 w-full">
          {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
          Ingresar
        </Button>
        <Link
          to="/recuperar-contrasena"
          className="text-center text-sm text-primary hover:underline"
        >
          ¿Olvidaste tu contraseña?
        </Link>
      </form>
    </AuthLayout>
  );
}

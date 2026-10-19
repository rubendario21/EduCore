import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/layouts/auth-layout';
import { getErrorMessage } from '@/lib/api-client';
import { emailField } from '@/lib/forms';
import { authService } from '../auth.service';

const schema = z.object({ email: emailField });
type ForgotForm = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      // La respuesta es la misma exista o no la cuenta (no revela correos registrados).
      setSentMessage((await authService.forgotPassword(email)).message);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  });

  if (sentMessage) {
    return (
      <AuthLayout title="Revisa tu correo">
        <div className="flex flex-col items-center gap-3 text-center">
          <MailCheck className="size-10 text-success" aria-hidden />
          <p className="text-sm">{sentMessage}</p>
          <p className="text-xs text-muted-foreground">
            El enlace vence en 30 minutos y solo sirve una vez.
          </p>
          <Link to="/iniciar-sesion" className="text-sm text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Recuperar contraseña"
      description="Te enviaremos un enlace para definir una contraseña nueva."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Correo electrónico" error={errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              autoFocus
              {...register('email')}
            />
          )}
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
          Enviar enlace
        </Button>
        <Link to="/iniciar-sesion" className="text-center text-sm text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      </form>
    </AuthLayout>
  );
}

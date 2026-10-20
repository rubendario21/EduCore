import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/layouts/auth-layout';
import { getErrorMessage } from '@/lib/api-client';
import { emailField } from '@/lib/forms';
import { useAuth } from '../auth-context';
import { useProfile } from '../profile-context';
import {
  landingOf,
  type Profile,
  PROFILE_INFO,
  profilesOf,
  resolveProfile,
  readPreferredProfile,
} from '../profiles';

/** Orden en que se muestran los perfiles en la pantalla de inicio. */
const LOGIN_PROFILES: Profile[] = ['STUDENT', 'GUARDIAN', 'TEACHER', 'STAFF'];

/**
 * Selección del perfil antes de entrar. Solo orienta la experiencia: los
 * permisos los decide la API según los roles de la cuenta, y si la cuenta no
 * tiene el perfil elegido se avisa después de validar la contraseña.
 */
function ProfilePicker({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  return (
    <div role="radiogroup" aria-label="Ingresar como" className="grid grid-cols-2 gap-2">
      {LOGIN_PROFILES.map((p) => {
        const { label, icon: Icon } = PROFILE_INFO[p];
        const selected = p === value;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(p)}
            className={
              selected
                ? 'flex items-center gap-2 rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-primary'
                : 'flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground'
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

const schema = z.object({
  email: emailField,
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});
type LoginForm = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const { setProfile } = useProfile();
  // Sin sesión no hay perfil activo: se propone el último elegido en este navegador.
  const [chosen, setChosen] = useState<Profile>(() => readPreferredProfile() ?? 'STAFF');
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
      setProfile(chosen);
      const user = await login(email, password);
      const available = profilesOf(user);
      const active = resolveProfile(available, chosen);
      if (active && active !== chosen) {
        toast.info(
          `Tu cuenta no tiene perfil de ${PROFILE_INFO[chosen].label}. Ingresaste como ${PROFILE_INFO[active].label}.`,
        );
      }
      const from = (location.state as { from?: string } | null)?.from;
      // Solo rutas internas: evita redirecciones abiertas a otros sitios.
      navigate(from?.startsWith('/') && !from.startsWith('//') ? from : landingOf(active), {
        replace: true,
      });
    } catch (e) {
      setError(getErrorMessage(e));
    }
  });

  return (
    <AuthLayout title="Iniciar sesión" description={PROFILE_INFO[chosen].description}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <ProfilePicker value={chosen} onChange={setChosen} />
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

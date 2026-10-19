import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { brandingQueryKey, readableTextOn } from '@/features/branding/branding';
import { applyServerErrors } from '@/lib/forms';
import { type Institution, institutionService } from '../institution.service';

const color = z
  .string()
  .trim()
  .refine((v) => v === '' || /^#[0-9A-Fa-f]{6}$/.test(v), 'Formato #RRGGBB.');
const schema = z.object({
  timezone: z.string().min(3, 'Selecciona una zona horaria.'),
  locale: z.enum(['es-CO', 'es', 'en-US']),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Código ISO de 3 letras (p. ej. COP).'),
  primaryColor: color,
  accentColor: color,
  guardianAbsenceExcusesEnabled: z.boolean(),
});
type SettingsForm = z.infer<typeof schema>;

const TIMEZONES = Intl.supportedValuesOf('timeZone').filter((tz) => tz.startsWith('America/'));

function ColorPreview({ value, label }: { value: string; label: string }) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) return null;
  return (
    <span
      className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium"
      style={{ background: value, color: readableTextOn(value) }}
    >
      {label}
    </span>
  );
}

export function SettingsTab({
  institution,
  editable,
}: {
  institution: Institution;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const s = institution.settings;
  const form = useForm<SettingsForm>({
    resolver: zodResolver(schema),
    values: {
      timezone: s.timezone,
      locale: s.locale as SettingsForm['locale'],
      currency: s.currency,
      primaryColor: s.branding.primaryColor ?? '',
      accentColor: s.branding.accentColor ?? '',
      guardianAbsenceExcusesEnabled: s.preferences.guardianAbsenceExcusesEnabled,
    },
  });
  const errors = form.formState.errors;
  const colors = useWatch({ control: form.control, name: ['primaryColor', 'accentColor'] });

  const mutation = useMutation({
    mutationFn: (v: SettingsForm) =>
      institutionService.updateSettings({
        timezone: v.timezone,
        locale: v.locale,
        currency: v.currency,
        branding: { primaryColor: v.primaryColor || null, accentColor: v.accentColor || null },
        preferences: { guardianAbsenceExcusesEnabled: v.guardianAbsenceExcusesEnabled },
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['institution'], updated);
      await queryClient.invalidateQueries({ queryKey: brandingQueryKey });
      toast.success('Configuración guardada.');
    },
    onError: (e) =>
      setError(applyServerErrors(e, form.setError, ['timezone', 'locale', 'currency'])),
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((values) => {
        setError(null);
        mutation.mutate(values);
      })}
    >
      {error && <Alert>{error}</Alert>}
      <fieldset disabled={!editable} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Configuración regional</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Zona horaria" error={errors.timezone?.message}>
              {(c) => (
                <Select {...c} {...form.register('timezone')}>
                  {[...new Set([s.timezone, ...TIMEZONES])].map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Idioma" error={errors.locale?.message}>
              {(c) => (
                <Select {...c} {...form.register('locale')}>
                  <option value="es-CO">Español (Colombia)</option>
                  <option value="es">Español</option>
                  <option value="en-US">English (US)</option>
                </Select>
              )}
            </Field>
            <Field label="Moneda" error={errors.currency?.message} hint="Código ISO 4217.">
              {(c) => <Input {...c} maxLength={3} {...form.register('currency')} />}
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Marca</CardTitle>
            <CardDescription>
              Colores de la institución para el tema claro. Si un color es claro, el texto sobre él
              se oscurece automáticamente para mantener la legibilidad.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {(['primaryColor', 'accentColor'] as const).map((name) => (
              <Field
                key={name}
                label={name === 'primaryColor' ? 'Color principal' : 'Color de acento'}
                error={errors[name]?.message}
                hint="Vacío = color de EduCore."
              >
                {(c) => (
                  <div className="flex gap-2">
                    <Input
                      {...c}
                      placeholder={name === 'primaryColor' ? '#2453C4' : '#0E9384'}
                      maxLength={7}
                      {...form.register(name)}
                    />
                    <ColorPreview value={colors[name === 'primaryColor' ? 0 : 1]} label="Ejemplo" />
                  </div>
                )}
              </Field>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Preferencias</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" {...form.register('guardianAbsenceExcusesEnabled')} />
              <span>
                Los acudientes pueden presentar excusas de inasistencia
                <span className="block text-xs text-muted-foreground">
                  Se usará cuando se active el módulo de asistencia.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      </fieldset>
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
            {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            Guardar configuración
          </Button>
        </div>
      )}
    </form>
  );
}

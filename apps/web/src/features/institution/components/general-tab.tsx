import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { brandingQueryKey } from '@/features/branding/branding';
import {
  applyServerErrors,
  nullIfEmpty,
  optionalText,
  phoneField,
  requiredText,
} from '@/lib/forms';
import { type Institution, institutionService } from '../institution.service';

const schema = z.object({
  legalName: requiredText('El nombre legal', 3, 200),
  tradeName: optionalText(200),
  taxId: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{6,15}$/.test(v), 'Entre 6 y 15 dígitos, sin puntos ni DV.'),
  taxIdDv: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d$/.test(v), 'Un solo dígito.'),
  daneCode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{6,20}$/.test(v), 'Entre 6 y 20 dígitos.'),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Correo no válido.'),
  phone: phoneField,
  website: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), 'URL completa (https://…).'),
  address: optionalText(300),
  city: optionalText(120),
  department: optionalText(120),
});
type GeneralForm = z.infer<typeof schema>;
const FIELDS = Object.keys(schema.shape) as Array<keyof GeneralForm>;

export function GeneralTab({
  institution,
  editable,
}: {
  institution: Institution;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toForm = (i: Institution): GeneralForm =>
    Object.fromEntries(FIELDS.map((f) => [f, i[f] ?? ''])) as GeneralForm;
  const form = useForm<GeneralForm>({ resolver: zodResolver(schema), values: toForm(institution) });
  const errors = form.formState.errors;

  const mutation = useMutation({
    mutationFn: (values: GeneralForm) =>
      institutionService.update({
        ...Object.fromEntries(FIELDS.map((f) => [f, nullIfEmpty(values[f])])),
        legalName: values.legalName,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['institution'], updated);
      await queryClient.invalidateQueries({ queryKey: brandingQueryKey });
      toast.success('Datos de la institución actualizados.');
    },
    onError: (e) => setError(applyServerErrors(e, form.setError, FIELDS)),
  });

  const text = (
    name: keyof GeneralForm,
    label: string,
    extra: { required?: boolean; hint?: string; className?: string; type?: string } = {},
  ) => (
    <Field
      label={label}
      error={errors[name]?.message}
      required={extra.required}
      hint={extra.hint}
      className={extra.className}
    >
      {(c) => <Input {...c} type={extra.type ?? 'text'} {...form.register(name)} />}
    </Field>
  );

  return (
    <Card>
      <CardContent className="p-5">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            mutation.mutate(values);
          })}
        >
          {error && <Alert>{error}</Alert>}
          <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-6">
            {text('legalName', 'Nombre legal', { required: true, className: 'sm:col-span-4' })}
            {text('tradeName', 'Nombre comercial', { className: 'sm:col-span-2' })}
            {text('taxId', 'NIT', {
              hint: 'Sin puntos ni dígito de verificación.',
              className: 'sm:col-span-2',
            })}
            {text('taxIdDv', 'DV', {
              hint: 'Se valida con el algoritmo de la DIAN.',
              className: 'sm:col-span-1',
            })}
            {text('daneCode', 'Código DANE', { className: 'sm:col-span-3' })}
            {text('email', 'Correo', { type: 'email', className: 'sm:col-span-3' })}
            {text('phone', 'Teléfono', { type: 'tel', className: 'sm:col-span-3' })}
            {text('website', 'Sitio web', { type: 'url', className: 'sm:col-span-6' })}
            {text('address', 'Dirección', { className: 'sm:col-span-6' })}
            {text('city', 'Ciudad o municipio', { className: 'sm:col-span-3' })}
            {text('department', 'Departamento', { className: 'sm:col-span-3' })}
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

import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from '@educore/shared';
import { get, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { type PersonValues } from './person-form';

/**
 * Campos de una persona dentro de un formulario mayor, bajo `prefix`
 * (p. ej. `person` o `guardian`). `compact` muestra solo identificación,
 * nombres y contacto (para acudientes y aspirantes).
 */
export function PersonFields<T extends FieldValues>({
  form,
  prefix,
  compact = false,
  withBirthDate = true,
  withContact = true,
}: {
  form: UseFormReturn<T>;
  prefix: string;
  compact?: boolean;
  withBirthDate?: boolean;
  /** Teléfono y correo (no aplican, p. ej., al aspirante de una admisión). */
  withContact?: boolean;
}) {
  const path = (name: keyof PersonValues) => `${prefix}.${name}` as Path<T>;
  const error = (name: keyof PersonValues) =>
    (get(form.formState.errors, `${prefix}.${name}`) as { message?: string } | undefined)?.message;
  const { register } = form;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombres" required error={error('firstNames')}>
        {(c) => <Input {...c} autoComplete="off" {...register(path('firstNames'))} />}
      </Field>
      <Field label="Apellidos" required error={error('lastNames')}>
        {(c) => <Input {...c} autoComplete="off" {...register(path('lastNames'))} />}
      </Field>
      <Field label="Tipo de documento" required error={error('documentType')}>
        {(c) => (
          <Select {...c} {...register(path('documentType'))}>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOCUMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Número de documento"
        required
        error={error('documentNumber')}
        hint="Si la persona ya existe en la institución, se reutiliza."
      >
        {(c) => <Input {...c} autoComplete="off" {...register(path('documentNumber'))} />}
      </Field>
      {withBirthDate && (
        <Field label="Fecha de nacimiento" error={error('birthDate')}>
          {(c) => <Input {...c} type="date" {...register(path('birthDate'))} />}
        </Field>
      )}
      {withContact && (
        <>
          <Field label="Teléfono" error={error('phone')}>
            {(c) => <Input {...c} type="tel" {...register(path('phone'))} />}
          </Field>
          <Field label="Correo de contacto" error={error('email')}>
            {(c) => <Input {...c} type="email" autoComplete="off" {...register(path('email'))} />}
          </Field>
        </>
      )}
      {!compact && (
        <Field label="Dirección" error={error('address')}>
          {(c) => <Input {...c} {...register(path('address'))} />}
        </Field>
      )}
    </div>
  );
}

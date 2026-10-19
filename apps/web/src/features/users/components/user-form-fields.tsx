import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from '@educore/shared';
import { type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { type UserFields } from './user-form.schema';

export function UserFormFields({
  register,
  errors,
}: {
  register: UseFormRegister<UserFields>;
  errors: FieldErrors<UserFields>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombres" required error={errors.firstNames?.message}>
        {(c) => <Input {...c} autoComplete="off" {...register('firstNames')} />}
      </Field>
      <Field label="Apellidos" required error={errors.lastNames?.message}>
        {(c) => <Input {...c} autoComplete="off" {...register('lastNames')} />}
      </Field>
      <Field label="Tipo de documento" required error={errors.documentType?.message}>
        {(c) => (
          <Select {...c} {...register('documentType')}>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOCUMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Número de documento" required error={errors.documentNumber?.message}>
        {(c) => <Input {...c} autoComplete="off" {...register('documentNumber')} />}
      </Field>
      <Field
        label="Correo electrónico"
        required
        error={errors.email?.message}
        className="sm:col-span-2"
      >
        {(c) => <Input {...c} type="email" autoComplete="off" {...register('email')} />}
      </Field>
      <Field label="Fecha de nacimiento" error={errors.birthDate?.message}>
        {(c) => <Input {...c} type="date" {...register('birthDate')} />}
      </Field>
      <Field label="Teléfono" error={errors.phone?.message}>
        {(c) => <Input {...c} type="tel" {...register('phone')} />}
      </Field>
      <Field label="Dirección" error={errors.address?.message} className="sm:col-span-2">
        {(c) => <Input {...c} {...register('address')} />}
      </Field>
    </div>
  );
}

import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isCalendarDate } from './colombia';

/** Fecha de calendario `AAAA-MM-DD` que existe realmente. */
export function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      options: { message: `${propertyName} debe ser una fecha válida (AAAA-MM-DD).`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isCalendarDate(value),
      },
    });
}

/** Quita espacios al inicio y al final de los textos. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Texto vacío → null, para poder borrar campos opcionales desde un formulario. */
export const EmptyToNull = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value,
  );

/** Códigos de catálogo en mayúsculas (`principal` → `PRINCIPAL`). */
export const UpperCode = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
export const CODE_MESSAGE =
  'El código debe tener hasta 20 letras, números, guiones o guiones bajos.';

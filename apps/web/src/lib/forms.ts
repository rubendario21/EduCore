import { type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, getErrorMessage } from './api-client';

/**
 * Lleva los errores de validación de la API a los campos del formulario. La
 * API es la autoridad final: aunque la web valida antes de enviar, el servidor
 * puede rechazar datos (p. ej. un correo ya registrado).
 * Devuelve el mensaje general si el error no corresponde a ningún campo.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): string | null {
  if (error instanceof ApiError && error.fieldErrors.length > 0) {
    const unmatched: string[] = [];
    for (const { field, messages } of error.fieldErrors) {
      // Los campos anidados (`person.firstNames`) se marcan con su ruta completa.
      const root = field.split('.')[0]!;
      if (fields.includes(root)) setError(field as Path<T>, { message: messages.join(' ') });
      else unmatched.push(...messages);
    }
    return unmatched.length > 0 ? unmatched.join(' ') : null;
  }
  return getErrorMessage(error);
}

// --- Validaciones reutilizables (espejo de las reglas de la API) -----------

export const requiredText = (label: string, min = 2, max = 150) =>
  z
    .string()
    .trim()
    .min(min, `${label} debe tener al menos ${min} caracteres.`)
    .max(max, `${label} no puede superar ${max} caracteres.`);

export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres.`);

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Ingresa un correo electrónico válido.');

export const codeField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Hasta 20 letras, números, guiones o guiones bajos.');

export const phoneField = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[0-9+()\s-]{7,40}$/.test(v), 'El teléfono no es válido.');

export const dateField = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: selecciona una fecha válida.`);

/** Política de contraseñas (la API aplica además la lista de contraseñas comunes). */
export const newPasswordField = z
  .string()
  .min(10, 'Debe tener al menos 10 caracteres.')
  .max(128, 'No puede superar 128 caracteres.');

/** Cadena vacía → null, para borrar campos opcionales en la API. */
export const nullIfEmpty = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value.trim();

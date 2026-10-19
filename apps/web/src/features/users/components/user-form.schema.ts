import { DOCUMENT_TYPES } from '@educore/shared';
import { z } from 'zod';
import { emailField, optionalText, phoneField, requiredText } from '@/lib/forms';

/** Datos personales de un usuario (mismas reglas que la API). */
export const userFieldsSchema = z.object({
  email: emailField,
  documentType: z.enum(DOCUMENT_TYPES, { message: 'Selecciona el tipo de documento.' }),
  documentNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,30}$/, 'Entre 3 y 30 letras, números o guiones.'),
  firstNames: requiredText('Los nombres', 2, 120),
  lastNames: requiredText('Los apellidos', 2, 120),
  birthDate: z.string(),
  phone: phoneField,
  address: optionalText(300),
});

export type UserFields = z.infer<typeof userFieldsSchema>;

export const USER_FIELD_NAMES = [
  'email',
  'documentType',
  'documentNumber',
  'firstNames',
  'lastNames',
  'birthDate',
  'phone',
  'address',
] as const;

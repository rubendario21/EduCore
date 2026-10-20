import { DOCUMENT_TYPES } from '@educore/shared';
import { z } from 'zod';
import { nullIfEmpty, optionalText, phoneField, requiredText } from '@/lib/forms';
import { type Person, type PersonInput } from '../people.service';

/** Datos de una persona (mismas reglas que la API). El correo es de contacto, opcional. */
export const personSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES, { message: 'Selecciona el tipo de documento.' }),
  documentNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,30}$/, 'Entre 3 y 30 letras, números o guiones.'),
  firstNames: requiredText('Los nombres', 2, 120),
  lastNames: requiredText('Los apellidos', 2, 120),
  birthDate: z.string(),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Ingresa un correo válido.'),
  phone: phoneField,
  address: optionalText(300),
});

export type PersonValues = z.infer<typeof personSchema>;

export const emptyPerson = (documentType: PersonValues['documentType'] = 'TI'): PersonValues => ({
  documentType,
  documentNumber: '',
  firstNames: '',
  lastNames: '',
  birthDate: '',
  email: '',
  phone: '',
  address: '',
});

export const personToValues = (p: Person): PersonValues => ({
  documentType: p.documentType,
  documentNumber: p.documentNumber,
  firstNames: p.firstNames,
  lastNames: p.lastNames,
  birthDate: p.birthDate ?? '',
  email: p.email ?? '',
  phone: p.phone ?? '',
  address: p.address ?? '',
});

export const valuesToPerson = (v: PersonValues): PersonInput => ({
  documentType: v.documentType,
  documentNumber: v.documentNumber.trim(),
  firstNames: v.firstNames.trim(),
  lastNames: v.lastNames.trim(),
  birthDate: nullIfEmpty(v.birthDate),
  email: nullIfEmpty(v.email),
  phone: nullIfEmpty(v.phone),
  address: nullIfEmpty(v.address),
});

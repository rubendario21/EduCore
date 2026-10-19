import { DOCUMENT_TYPES } from '@educore/shared';
import { z } from 'zod';
import { isValidNit, nitCheckDigit } from '../common/validation/colombia';

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const code = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, 'Solo letras, números, guion y guion bajo');

/** Archivo de configuración inicial (ver apps/api/setup/institution.example.json). */
export const setupConfigSchema = z
  .object({
    institution: z.object({
      legalName: z.string().trim().min(3).max(200),
      tradeName: optionalText(200),
      taxId: z
        .string()
        .trim()
        .regex(/^\d{6,15}$/, 'NIT sin puntos ni dígito de verificación')
        .optional(),
      taxIdDv: z.string().trim().regex(/^\d$/, 'Un solo dígito').optional(),
      daneCode: z
        .string()
        .trim()
        .regex(/^\d{6,20}$/)
        .optional(),
      email: z.string().trim().email().optional(),
      phone: optionalText(40),
      website: z.string().trim().url().optional(),
      address: optionalText(300),
      city: optionalText(120),
      department: optionalText(120),
    }),
    settings: z
      .object({
        timezone: z.string().trim().min(3).max(64).default('America/Bogota'),
        locale: z.string().trim().min(2).max(16).default('es-CO'),
        currency: z.string().trim().length(3).default('COP'),
      })
      .default({ timezone: 'America/Bogota', locale: 'es-CO', currency: 'COP' }),
    campuses: z
      .array(
        z.object({
          code,
          name: z.string().trim().min(2).max(150),
          isMain: z.boolean().default(false),
          daneCode: z
            .string()
            .trim()
            .regex(/^\d{6,20}$/)
            .optional(),
          address: optionalText(300),
          city: optionalText(120),
          phone: optionalText(40),
        }),
      )
      .min(1, 'Define al menos una sede'),
    shifts: z
      .array(z.object({ code, name: z.string().trim().min(2).max(100) }))
      .min(1, 'Define al menos una jornada'),
    admin: z.object({
      email: z.string().trim().toLowerCase().email(),
      documentType: z.enum(DOCUMENT_TYPES),
      documentNumber: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9-]{3,30}$/),
      firstNames: z.string().trim().min(2).max(120),
      lastNames: z.string().trim().min(2).max(120),
    }),
  })
  .superRefine((config, ctx) => {
    // Misma regla que la API: el DV debe corresponder al NIT (algoritmo DIAN).
    const { taxId, taxIdDv } = config.institution;
    if (taxId && !taxIdDv) {
      ctx.addIssue({
        code: 'custom',
        path: ['institution', 'taxIdDv'],
        message: 'Indica el dígito de verificación del NIT',
      });
    } else if (taxId && taxIdDv && !isValidNit(taxId, taxIdDv)) {
      ctx.addIssue({
        code: 'custom',
        path: ['institution', 'taxIdDv'],
        message: `El dígito de verificación no corresponde al NIT (debería ser ${nitCheckDigit(taxId)})`,
      });
    }
    const mains = config.campuses.filter((c) => c.isMain).length;
    if (mains > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['campuses'],
        message: 'Solo puede haber una sede principal',
      });
    }
    for (const key of ['campuses', 'shifts'] as const) {
      const codes = config[key].map((item) => item.code.toUpperCase());
      if (new Set(codes).size !== codes.length) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Hay códigos repetidos' });
      }
    }
  });

export type SetupConfig = z.infer<typeof setupConfigSchema>;

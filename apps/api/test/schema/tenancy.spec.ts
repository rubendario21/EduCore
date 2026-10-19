import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Prueba de preparación multi-tenant (docs/00-diagnostico-y-plan.md §8).
 *
 * Toda tabla nueva debe declarar explícitamente su relación con la institución:
 * - o tiene `institutionId` (y entonces cada restricción única lo incluye),
 * - o figura abajo con la razón por la que no lo necesita.
 * Así ninguna tabla puede añadirse "olvidando" la pertenencia institucional.
 */
const NON_INSTITUTIONAL_MODELS: Record<string, string> = {
  User: 'Cuenta global: una persona puede pertenecer a varias instituciones',
  Permission: 'Catálogo global definido en código',
  InstitutionSettings: 'Su PK es institution_id (1:1 con Institution)',
  Institution: 'Es la propia entidad institucional',
  RolePermission: 'Hija de Role (institucional)',
  MembershipRole: 'Hija de UserInstitution (institucional)',
  UserSession: 'Hija de UserInstitution (institucional)',
  PasswordToken: 'Pertenece a la cuenta global (User)',
  AcademicPeriod: 'Hija de AcademicYear (institucional)',
  StudentGuardian: 'Tabla puente entre Student y Guardian (institucionales)',
};

/** Campos `@unique` permitidos en modelos institucionales (identificadores no reutilizables). */
const ALLOWED_FIELD_UNIQUES: Record<string, string[]> = {
  // person_id ya es institucional: un perfil por persona.
  UserInstitution: ['personId'],
  Student: ['personId'],
  Guardian: ['personId'],
  StaffMember: ['personId'],
};

interface ParsedModel {
  name: string;
  fields: Map<string, string>;
  compositeUniques: string[][];
}

function parseModels(schema: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match as unknown as [string, string, string];
    const fields = new Map<string, string>();
    const compositeUniques: string[][] = [];
    for (const raw of body.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      const unique = line.match(/^@@(?:unique|id)\(\[([^\]]+)\]/);
      if (unique) {
        compositeUniques.push(unique[1]!.split(',').map((f) => f.trim().replace(/\(.*\)$/, '')));
        continue;
      }
      if (line.startsWith('@@')) continue;
      const field = line.match(/^(\w+)\s+(.*)$/);
      if (field) fields.set(field[1]!, field[2]!);
    }
    models.push({ name: name, fields, compositeUniques });
  }
  return models;
}

// Vitest se ejecuta con apps/api como raíz.
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
const models = parseModels(schema);

describe('Esquema: preparación multi-tenant', () => {
  it('encuentra los modelos del esquema', () => {
    expect(models.length).toBeGreaterThan(10);
  });

  it('el analizador detecta institution_id, únicos compuestos y únicos globales', () => {
    const [sample] = parseModels(
      [
        'model Sample {',
        '  id            String @id',
        '  institutionId String @map("institution_id") @db.Uuid',
        '  email         String @unique',
        '  code          String',
        '  @@unique([academicYearId, code])',
        '}',
      ].join('\n'),
    );
    expect(sample?.fields.get('institutionId')).toBeDefined();
    expect(sample?.fields.get('email')).toMatch(/@unique/);
    expect(sample?.compositeUniques).toEqual([['academicYearId', 'code']]);
  });

  it.each(models.map((m) => [m.name, m] as const))(
    '%s declara su pertenencia institucional',
    (name, model) => {
      const institutionField = model.fields.get('institutionId');
      if (!institutionField) {
        expect(
          NON_INSTITUTIONAL_MODELS[name],
          `${name} no tiene institutionId: añádelo o justifícalo en NON_INSTITUTIONAL_MODELS`,
        ).toBeDefined();
        return;
      }

      // institution_id es obligatorio, salvo en la auditoría (eventos sin institución resoluble).
      if (name !== 'AuditLog') {
        expect(institutionField, `${name}.institutionId debe ser NOT NULL`).not.toMatch(/^\w+\?/);
      }

      for (const unique of model.compositeUniques) {
        expect(unique, `@@unique de ${name} debe incluir institutionId`).toContain('institutionId');
      }

      for (const [fieldName, definition] of model.fields) {
        if (!/@unique\b/.test(definition)) continue;
        expect(
          ALLOWED_FIELD_UNIQUES[name] ?? [],
          `${name}.${fieldName} es @unique global: debe ser compuesto con institutionId`,
        ).toContain(fieldName);
      }
    },
  );
});

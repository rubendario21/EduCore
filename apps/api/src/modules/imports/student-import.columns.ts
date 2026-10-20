import { DOCUMENT_TYPES } from '@educore/shared';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { normalizeSearch } from '../../common/search';
import { isCalendarDate } from '../../common/validation/colombia';
import { type GuardianRelationship, PersonInputDto } from '../people/dto/people.dto';

/** Columnas de la plantilla de estudiantes. El encabezado es el nombre visible. */
export const STUDENT_IMPORT_COLUMNS = [
  { key: 'documentType', header: 'tipo_documento', required: true, example: 'TI' },
  { key: 'documentNumber', header: 'numero_documento', required: true, example: '1012345678' },
  { key: 'firstNames', header: 'nombres', required: true, example: 'Sofía' },
  { key: 'lastNames', header: 'apellidos', required: true, example: 'Martínez López' },
  { key: 'birthDate', header: 'fecha_nacimiento', example: '09/03/2015' },
  { key: 'code', header: 'codigo', example: '2027-001' },
  { key: 'email', header: 'correo', example: '' },
  { key: 'phone', header: 'telefono', example: '' },
  { key: 'address', header: 'direccion', example: '' },
  { key: 'guardianDocumentType', header: 'acudiente_tipo_documento', example: 'CC' },
  { key: 'guardianDocumentNumber', header: 'acudiente_numero_documento', example: '52123456' },
  { key: 'guardianFirstNames', header: 'acudiente_nombres', example: 'Laura' },
  { key: 'guardianLastNames', header: 'acudiente_apellidos', example: 'López' },
  { key: 'guardianRelationship', header: 'acudiente_parentesco', example: 'Madre' },
  { key: 'guardianPhone', header: 'acudiente_telefono', example: '3001234567' },
  { key: 'guardianEmail', header: 'acudiente_correo', example: 'laura@correo.com' },
  { key: 'guardianLegalRepresentative', header: 'acudiente_representante_legal', example: 'SI' },
  { key: 'year', header: 'anio', example: '2027' },
  { key: 'grade', header: 'grado', example: '6' },
  { key: 'group', header: 'grupo', example: '601' },
  { key: 'campus', header: 'sede', example: '' },
  { key: 'enrolledOn', header: 'fecha_matricula', example: '' },
] as const;

export type ColumnKey = (typeof STUDENT_IMPORT_COLUMNS)[number]['key'];

const HEADER_ALIASES: Record<string, ColumnKey> = {
  ano: 'year',
  documento: 'documentNumber',
  tipo_de_documento: 'documentType',
  numero_de_documento: 'documentNumber',
  email: 'email',
  codigo_estudiante: 'code',
};

export function headerOf(key: ColumnKey): string {
  return STUDENT_IMPORT_COLUMNS.find((c) => c.key === key)!.header;
}

/** `Número de documento` → `numero_de_documento`. */
export function normalizeHeader(header: string): string {
  return normalizeSearch(header)
    .replace(/[\s.-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export interface ColumnMapping {
  /** Columna de la plantilla → posición en el archivo. */
  positions: Partial<Record<ColumnKey, number>>;
  missing: string[];
  unknown: string[];
  duplicated: string[];
}

export function mapColumns(headers: string[]): ColumnMapping {
  const positions: Partial<Record<ColumnKey, number>> = {};
  const unknown: string[] = [];
  const duplicated: string[] = [];
  headers.forEach((raw, index) => {
    if (!raw) return;
    const normalized = normalizeHeader(raw);
    const key =
      STUDENT_IMPORT_COLUMNS.find((c) => c.header === normalized)?.key ??
      HEADER_ALIASES[normalized];
    if (!key) unknown.push(raw);
    else if (positions[key] !== undefined) duplicated.push(raw);
    else positions[key] = index;
  });
  const missing = STUDENT_IMPORT_COLUMNS.filter(
    (c) => 'required' in c && c.required && positions[c.key] === undefined,
  ).map((c) => c.header);
  return { positions, missing, unknown, duplicated };
}

// --- Valores ------------------------------------------------------------------

const RELATIONSHIPS: Record<string, GuardianRelationship> = {
  madre: 'MOTHER',
  mama: 'MOTHER',
  mother: 'MOTHER',
  padre: 'FATHER',
  papa: 'FATHER',
  father: 'FATHER',
  abuelo: 'GRANDPARENT',
  abuela: 'GRANDPARENT',
  grandparent: 'GRANDPARENT',
  hermano: 'SIBLING',
  hermana: 'SIBLING',
  sibling: 'SIBLING',
  tio: 'UNCLE_AUNT',
  tia: 'UNCLE_AUNT',
  uncle_aunt: 'UNCLE_AUNT',
  tutor: 'LEGAL_GUARDIAN',
  tutor_legal: 'LEGAL_GUARDIAN',
  legal_guardian: 'LEGAL_GUARDIAN',
  otro: 'OTHER',
  other: 'OTHER',
};

export function parseRelationship(value: string): GuardianRelationship | null {
  return RELATIONSHIPS[normalizeHeader(value)] ?? null;
}

export function parseYesNo(value: string): boolean | null {
  const v = normalizeSearch(value);
  if (['si', 's', 'x', 'true', '1', 'yes'].includes(v)) return true;
  if (['', 'no', 'n', 'false', '0'].includes(v)) return false;
  return null;
}

/** `T.I.` → `TI`. */
export function parseDocumentType(value: string): string {
  return value.replace(/[\s.]/g, '').toUpperCase();
}

/** Acepta `AAAA-MM-DD` y `DD/MM/AAAA` (también con guiones). Devuelve `AAAA-MM-DD` o null. */
export function parseDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  const parts = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[2], local[1]] : null;
  if (!parts) return null;
  const [y, m, d] = parts as [string, string, string];
  const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isCalendarDate(date) ? date : null;
}

// --- Validación de personas ---------------------------------------------------

export interface CellError {
  column: string;
  message: string;
}

const PERSON_FIELDS: Record<string, ColumnKey> = {
  documentType: 'documentType',
  documentNumber: 'documentNumber',
  firstNames: 'firstNames',
  lastNames: 'lastNames',
  birthDate: 'birthDate',
  email: 'email',
  phone: 'phone',
  address: 'address',
};

const GUARDIAN_FIELDS: Record<string, ColumnKey> = {
  documentType: 'guardianDocumentType',
  documentNumber: 'guardianDocumentNumber',
  firstNames: 'guardianFirstNames',
  lastNames: 'guardianLastNames',
  email: 'guardianEmail',
  phone: 'guardianPhone',
};

/**
 * Valida los datos de una persona con las mismas reglas que el registro
 * manual (PersonInputDto) y traduce cada error a la columna del archivo.
 */
export function validatePerson(
  plain: Record<string, string | null>,
  role: 'student' | 'guardian',
): { person: PersonInputDto | null; errors: CellError[] } {
  const fields = role === 'student' ? PERSON_FIELDS : GUARDIAN_FIELDS;
  const instance = plainToInstance(PersonInputDto, plain);
  const failures: ValidationError[] = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  const errors = failures.flatMap((f) => {
    const column = headerOf(fields[f.property] ?? 'documentNumber');
    return Object.values(f.constraints ?? {}).map((message) => ({ column, message }));
  });
  if (!DOCUMENT_TYPES.includes(instance.documentType)) {
    // El mensaje del DTO no dice cuáles son válidos; en un archivo conviene decirlo.
    errors.splice(
      0,
      errors.length,
      ...errors.filter((e) => e.column !== headerOf(fields.documentType!)),
      {
        column: headerOf(fields.documentType!),
        message: `Tipo de documento no válido. Usa: ${DOCUMENT_TYPES.join(', ')}.`,
      },
    );
  }
  return { person: errors.length === 0 ? instance : null, errors };
}

/**
 * Enums de dominio compartidos. Deben coincidir con los enums del esquema
 * Prisma de la API; una prueba de la API verifica que no diverjan.
 */

/** Tipos de documento de identidad usados en Colombia. */
export const DOCUMENT_TYPES = ['RC', 'TI', 'CC', 'CE', 'NUIP', 'PPT', 'PEP', 'PA'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  RC: 'Registro civil',
  TI: 'Tarjeta de identidad',
  CC: 'Cédula de ciudadanía',
  CE: 'Cédula de extranjería',
  NUIP: 'NUIP',
  PPT: 'Permiso por protección temporal',
  PEP: 'Permiso especial de permanencia',
  PA: 'Pasaporte',
};

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ACADEMIC_YEAR_STATUSES = ['PLANNING', 'ACTIVE', 'CLOSED'] as const;
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number];

export const ACADEMIC_PERIOD_STATUSES = ['PLANNED', 'OPEN', 'CLOSED', 'PUBLISHED'] as const;
export type AcademicPeriodStatus = (typeof ACADEMIC_PERIOD_STATUSES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

import { type DocumentType, type RecordStatus } from '@educore/shared';
import { type PageMeta } from '@/components/page';
import { type BadgeTone } from '@/components/ui/badge';
import { apiClient, toQuery } from '@/lib/api-client';

export interface Person {
  id: string;
  documentType: DocumentType;
  documentNumber: string;
  firstNames: string;
  lastNames: string;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  hasAccess: boolean;
  accessStatus: string | null;
}

export type PersonInput = Pick<
  Person,
  | 'documentType'
  | 'documentNumber'
  | 'firstNames'
  | 'lastNames'
  | 'birthDate'
  | 'email'
  | 'phone'
  | 'address'
>;

export const STUDENT_STATUSES = ['ACTIVE', 'WITHDRAWN', 'GRADUATED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const GUARDIAN_RELATIONSHIPS = [
  'MOTHER',
  'FATHER',
  'GRANDPARENT',
  'SIBLING',
  'UNCLE_AUNT',
  'LEGAL_GUARDIAN',
  'OTHER',
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const STAFF_TYPES = ['TEACHER', 'DIRECTIVE', 'ADMINISTRATIVE', 'SUPPORT'] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export interface GuardianLink {
  guardianId: string;
  relationship: GuardianRelationship;
  isPrimary: boolean;
  isLegalRepresentative: boolean;
  livesWithStudent: boolean;
  person: Person;
}

export interface Student {
  id: string;
  code: string | null;
  status: StudentStatus;
  person: Person;
  guardians: GuardianLink[];
  createdAt: string;
}

export interface Guardian {
  id: string;
  occupation: string | null;
  workplace: string | null;
  person: Person;
  students: Array<{
    studentId: string;
    relationship: GuardianRelationship;
    isPrimary: boolean;
    isLegalRepresentative: boolean;
    status: StudentStatus;
    person: Person;
  }>;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  staffType: StaffType;
  title: string | null;
  hireDate: string | null;
  status: RecordStatus;
  person: Person;
  createdAt: string;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface LinkFlags {
  relationship: GuardianRelationship;
  isPrimary?: boolean;
  isLegalRepresentative?: boolean;
  livesWithStudent?: boolean;
}

type ListFilter = Record<string, string | number | undefined>;

export const peopleService = {
  students: (filter: ListFilter, signal?: AbortSignal) =>
    apiClient.get<Page<Student>>(`/students${toQuery(filter)}`, { signal }),
  student: (id: string, signal?: AbortSignal) =>
    apiClient.get<Student>(`/students/${id}`, { signal }),
  createStudent: (input: { person: PersonInput; code?: string }) =>
    apiClient.post<Student>('/students', input),
  updateStudent: (
    id: string,
    input: { person?: Partial<PersonInput>; code?: string | null; status?: StudentStatus },
  ) => apiClient.patch<Student>(`/students/${id}`, input),
  linkGuardian: (
    id: string,
    input: LinkFlags & { guardianId?: string; person?: PersonInput; occupation?: string | null },
  ) => apiClient.post<Student>(`/students/${id}/guardians`, input),
  updateLink: (id: string, guardianId: string, input: Partial<LinkFlags>) =>
    apiClient.patch<Student>(`/students/${id}/guardians/${guardianId}`, input),
  unlink: (id: string, guardianId: string) =>
    apiClient.delete<Student>(`/students/${id}/guardians/${guardianId}`),
  studentAccess: (id: string, email: string) =>
    apiClient.post<Student & AccessResult>(`/students/${id}/access`, { email }),

  guardians: (filter: ListFilter, signal?: AbortSignal) =>
    apiClient.get<Page<Guardian>>(`/guardians${toQuery(filter)}`, { signal }),
  guardian: (id: string, signal?: AbortSignal) =>
    apiClient.get<Guardian>(`/guardians/${id}`, { signal }),
  createGuardian: (input: {
    person: PersonInput;
    occupation?: string | null;
    workplace?: string | null;
  }) => apiClient.post<Guardian>('/guardians', input),
  updateGuardian: (
    id: string,
    input: { person?: Partial<PersonInput>; occupation?: string | null; workplace?: string | null },
  ) => apiClient.patch<Guardian>(`/guardians/${id}`, input),
  guardianAccess: (id: string, email: string) =>
    apiClient.post<Guardian>(`/guardians/${id}/access`, { email }),

  staff: (filter: ListFilter, signal?: AbortSignal) =>
    apiClient.get<Page<StaffMember>>(`/staff${toQuery(filter)}`, { signal }),
  createStaff: (input: {
    person: PersonInput;
    staffType: StaffType;
    title?: string | null;
    hireDate?: string | null;
  }) => apiClient.post<StaffMember>('/staff', input),
  updateStaff: (
    id: string,
    input: {
      person?: Partial<PersonInput>;
      staffType?: StaffType;
      title?: string | null;
      hireDate?: string | null;
      status?: RecordStatus;
    },
  ) => apiClient.patch<StaffMember>(`/staff/${id}`, input),
  staffAccess: (id: string, email: string, roleCodes: string[]) =>
    apiClient.post<StaffMember & AccessResult>(`/staff/${id}/access`, { email, roleCodes }),
};

/** Resultado de dar acceso: si el correo de activación salió (null si la cuenta ya existía). */
export interface AccessResult {
  activationEmail: 'SENT' | 'FAILED' | null;
}

/** Aviso tras dar acceso al portal, según si el correo de activación salió. */
export function accessGrantedMessage({ activationEmail }: AccessResult): {
  tone: 'success' | 'warning';
  text: string;
} {
  if (activationEmail === 'FAILED') {
    return {
      tone: 'warning',
      text: 'Acceso creado, pero no se pudo enviar el correo de activación. Revisa la configuración del correo y reenvíalo desde Usuarios.',
    };
  }
  return {
    tone: 'success',
    text:
      activationEmail === 'SENT'
        ? 'Acceso creado: enviamos el enlace de activación.'
        : 'Acceso creado: la persona ya tenía cuenta y puede ingresar con su contraseña.',
  };
}

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ACTIVE: 'Activo',
  WITHDRAWN: 'Retirado',
  GRADUATED: 'Egresado',
};
export const STUDENT_STATUS_TONES: Record<StudentStatus, BadgeTone> = {
  ACTIVE: 'success',
  WITHDRAWN: 'warning',
  GRADUATED: 'neutral',
};

export const RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  MOTHER: 'Madre',
  FATHER: 'Padre',
  GRANDPARENT: 'Abuelo(a)',
  SIBLING: 'Hermano(a)',
  UNCLE_AUNT: 'Tío(a)',
  LEGAL_GUARDIAN: 'Tutor(a) legal',
  OTHER: 'Otro',
};

export const STAFF_TYPE_LABELS: Record<StaffType, string> = {
  TEACHER: 'Docente',
  DIRECTIVE: 'Directivo',
  ADMINISTRATIVE: 'Administrativo',
  SUPPORT: 'Apoyo',
};

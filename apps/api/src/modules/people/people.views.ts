import { fromDateOnly } from '../../common/validation/colombia';
import {
  type GuardianRecord,
  type PersonRecord,
  type StaffRecord,
  type StudentRecord,
} from './people.repository';

export interface PersonView {
  id: string;
  documentType: string;
  documentNumber: string;
  firstNames: string;
  lastNames: string;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Tiene cuenta de acceso a EduCore. */
  hasAccess: boolean;
  accessStatus: string | null;
}

export function personView(p: PersonRecord): PersonView {
  return {
    id: p.id,
    documentType: p.documentType,
    documentNumber: p.documentNumber,
    firstNames: p.firstNames,
    lastNames: p.lastNames,
    birthDate: p.birthDate ? fromDateOnly(p.birthDate) : null,
    email: p.email,
    phone: p.phone,
    address: p.address,
    hasAccess: !!p.membership,
    accessStatus: p.membership?.status ?? null,
  };
}

export function studentView(s: StudentRecord) {
  return {
    id: s.id,
    code: s.code,
    status: s.status,
    person: personView(s.person),
    guardians: s.guardians.map((link) => ({
      guardianId: link.guardianId,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      isLegalRepresentative: link.isLegalRepresentative,
      livesWithStudent: link.livesWithStudent,
      person: personView(link.guardian.person),
    })),
    createdAt: s.createdAt.toISOString(),
  };
}

export function guardianView(g: GuardianRecord) {
  return {
    id: g.id,
    occupation: g.occupation,
    workplace: g.workplace,
    person: personView(g.person),
    students: g.students.map((link) => ({
      studentId: link.studentId,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      isLegalRepresentative: link.isLegalRepresentative,
      livesWithStudent: link.livesWithStudent,
      status: link.student.status,
      person: personView(link.student.person),
    })),
    createdAt: g.createdAt.toISOString(),
  };
}

export function staffView(m: StaffRecord) {
  return {
    id: m.id,
    staffType: m.staffType,
    title: m.title,
    hireDate: m.hireDate ? fromDateOnly(m.hireDate) : null,
    status: m.status,
    person: personView(m.person),
    createdAt: m.createdAt.toISOString(),
  };
}

export type StudentView = ReturnType<typeof studentView>;
export type GuardianView = ReturnType<typeof guardianView>;
export type StaffView = ReturnType<typeof staffView>;

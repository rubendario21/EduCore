import { type AcademicYearStatus, type DocumentType } from '@educore/shared';
import { type BadgeTone } from '@/components/ui/badge';
import { apiClient, toQuery } from '@/lib/api-client';
import { type GuardianRelationship, type Page } from '@/features/people/people.service';

export const ADMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'WAITLISTED',
  'APPROVED',
  'REJECTED',
  'ENROLLED',
  'WITHDRAWN',
] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const ADMISSION_DOCUMENT_TYPES = [
  'BIRTH_CERTIFICATE',
  'IDENTITY_DOCUMENT',
  'REPORT_CARD',
  'PHOTO',
  'GUARDIAN_IDENTITY',
  'OTHER',
] as const;
export type AdmissionDocumentType = (typeof ADMISSION_DOCUMENT_TYPES)[number];

export interface AdmissionApplicant {
  documentType: DocumentType;
  documentNumber: string;
  firstNames: string;
  lastNames: string;
  birthDate: string | null;
}

export interface AdmissionGuardian {
  documentType: DocumentType;
  documentNumber: string;
  firstNames: string;
  lastNames: string;
  relationship: GuardianRelationship;
  email: string | null;
  phone: string | null;
}

export interface Admission {
  id: string;
  code: string;
  status: AdmissionStatus;
  academicYear: { id: string; year: number; name: string; status: AcademicYearStatus };
  grade: { id: string; name: string };
  applicant: AdmissionApplicant;
  guardian: AdmissionGuardian | null;
  previousSchool: string | null;
  notes: string | null;
  decisionNote: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  studentId: string | null;
  enrollmentId: string | null;
  createdAt: string;
}

export interface AdmissionDetail extends Admission {
  documents: Array<{
    id: string;
    documentType: AdmissionDocumentType;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
  history: Array<{
    from: AdmissionStatus | null;
    to: AdmissionStatus;
    note: string | null;
    changedByUserId: string | null;
    changedAt: string;
  }>;
}

export interface AdmissionInput {
  academicYearId: string;
  gradeId: string;
  applicant: AdmissionApplicant;
  guardian?: AdmissionGuardian | null;
  previousSchool?: string | null;
  notes?: string | null;
}

export type AdmissionAction = 'submit' | 'review' | 'waitlist' | 'approve' | 'reject' | 'withdraw';

export const admissionsService = {
  list: (filter: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    apiClient.get<Page<Admission>>(`/admissions${toQuery(filter)}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiClient.get<AdmissionDetail>(`/admissions/${id}`, { signal }),
  create: (input: AdmissionInput) => apiClient.post<AdmissionDetail>('/admissions', input),
  update: (id: string, input: Partial<Omit<AdmissionInput, 'academicYearId'>>) =>
    apiClient.patch<AdmissionDetail>(`/admissions/${id}`, input),
  transition: (id: string, action: AdmissionAction, note?: string) =>
    apiClient.post<AdmissionDetail>(`/admissions/${id}/${action}`, note ? { note } : {}),
  enroll: (id: string, input: { schoolGroupId?: string; enrolledOn?: string }) =>
    apiClient.post<AdmissionDetail>(`/admissions/${id}/enroll`, input),
  addDocument: (id: string, documentType: AdmissionDocumentType, file: File) => {
    const body = new FormData();
    body.append('documentType', documentType);
    body.append('file', file);
    return apiClient.post<AdmissionDetail>(`/admissions/${id}/documents`, body);
  },
  removeDocument: (id: string, documentId: string) =>
    apiClient.delete<AdmissionDetail>(`/admissions/${id}/documents/${documentId}`),
};

export const ADMISSION_STATUS_LABELS: Record<AdmissionStatus, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviada',
  IN_REVIEW: 'En revisión',
  WAITLISTED: 'En espera',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  ENROLLED: 'Matriculada',
  WITHDRAWN: 'Desistida',
};
export const ADMISSION_STATUS_TONES: Record<AdmissionStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'primary',
  IN_REVIEW: 'primary',
  WAITLISTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  ENROLLED: 'success',
  WITHDRAWN: 'neutral',
};

export const ADMISSION_DOCUMENT_LABELS: Record<AdmissionDocumentType, string> = {
  BIRTH_CERTIFICATE: 'Registro civil de nacimiento',
  IDENTITY_DOCUMENT: 'Documento de identidad',
  REPORT_CARD: 'Boletín o certificado de notas',
  PHOTO: 'Fotografía',
  GUARDIAN_IDENTITY: 'Documento del acudiente',
  OTHER: 'Otro',
};

/** Estados en los que la solicitud se edita y recibe documentos (igual que la API). */
export const OPEN_ADMISSION_STATUSES: readonly AdmissionStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'WAITLISTED',
  'APPROVED',
];

export interface ActionDefinition {
  action: AdmissionAction | 'enroll';
  label: string;
  /** Quién puede ejecutarla: tramitar (manage) o decidir (decide). */
  kind: 'manage' | 'decide' | 'enroll';
  tone?: 'danger';
}

/**
 * Acciones disponibles según el estado (espejo del flujo de la API; la API
 * valida siempre la transición).
 */
export function availableActions(status: AdmissionStatus): ActionDefinition[] {
  const actions: ActionDefinition[] = [];
  if (status === 'DRAFT')
    actions.push({ action: 'submit', label: 'Enviar solicitud', kind: 'manage' });
  if (status === 'SUBMITTED')
    actions.push({ action: 'review', label: 'Iniciar revisión', kind: 'manage' });
  if (status === 'IN_REVIEW')
    actions.push({ action: 'waitlist', label: 'Dejar en espera', kind: 'decide' });
  if (status === 'IN_REVIEW' || status === 'WAITLISTED') {
    actions.push({ action: 'approve', label: 'Aprobar', kind: 'decide' });
    actions.push({ action: 'reject', label: 'Rechazar', kind: 'decide', tone: 'danger' });
  }
  if (status === 'APPROVED')
    actions.push({ action: 'enroll', label: 'Matricular', kind: 'enroll' });
  if (OPEN_ADMISSION_STATUSES.includes(status)) {
    actions.push({
      action: 'withdraw',
      label: 'Registrar desistimiento',
      kind: 'manage',
      tone: 'danger',
    });
  }
  return actions;
}

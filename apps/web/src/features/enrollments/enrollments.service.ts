import { type AcademicYearStatus, type DocumentType } from '@educore/shared';
import { type BadgeTone } from '@/components/ui/badge';
import { apiClient, toQuery } from '@/lib/api-client';
import { type Page, type StudentStatus } from '@/features/people/people.service';

export const ENROLLMENT_STATUSES = [
  'PRE_ENROLLED',
  'ACTIVE',
  'WITHDRAWN',
  'TRANSFERRED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const WITHDRAWAL_REASONS = [
  'VOLUNTARY',
  'ACADEMIC',
  'DISCIPLINARY',
  'HEALTH',
  'RELOCATION',
  'ECONOMIC',
  'OTHER',
] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

export interface GroupRef {
  id: string;
  code: string;
  name: string;
}

export interface Enrollment {
  id: string;
  status: EnrollmentStatus;
  enrolledOn: string;
  endedOn: string | null;
  withdrawalReason: WithdrawalReason | null;
  endDetail: string | null;
  student: {
    id: string;
    code: string | null;
    status: StudentStatus;
    firstNames: string;
    lastNames: string;
    documentType: DocumentType;
    documentNumber: string;
  };
  academicYear: { id: string; year: number; name: string; status: AcademicYearStatus };
  grade: { id: string; name: string };
  currentGroup: GroupRef | null;
  placements: Array<{
    id: string;
    group: GroupRef;
    fromDate: string;
    toDate: string | null;
    reason: string | null;
  }>;
  previousEnrollmentId: string | null;
  createdAt: string;
}

export interface EnrollmentFilters {
  page: number;
  pageSize: number;
  academicYearId?: string;
  gradeId?: string;
  schoolGroupId?: string;
  studentId?: string;
  status?: EnrollmentStatus | '';
  search?: string;
}

export interface RenewalReport {
  dryRun: boolean;
  created: Array<{ studentId: string; name: string; fromGrade: string; toGrade: string }>;
  skipped: Array<{
    studentId: string;
    name: string;
    reason: 'ALREADY_ENROLLED' | 'LAST_GRADE' | 'STUDENT_NOT_ACTIVE';
  }>;
}

export const enrollmentsService = {
  list: (filters: EnrollmentFilters, signal?: AbortSignal) =>
    apiClient.get<Page<Enrollment>>(`/enrollments${toQuery({ ...filters })}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiClient.get<Enrollment>(`/enrollments/${id}`, { signal }),
  create: (input: {
    studentId: string;
    academicYearId: string;
    gradeId: string;
    schoolGroupId?: string;
    status?: 'PRE_ENROLLED' | 'ACTIVE';
    enrolledOn?: string;
  }) => apiClient.post<Enrollment>('/enrollments', input),
  activate: (id: string) => apiClient.post<Enrollment>(`/enrollments/${id}/activate`),
  cancel: (id: string) => apiClient.post<Enrollment>(`/enrollments/${id}/cancel`),
  changePlacement: (
    id: string,
    input: { schoolGroupId: string; effectiveDate?: string; reason?: string },
  ) => apiClient.post<Enrollment>(`/enrollments/${id}/placement`, input),
  withdraw: (id: string, input: { date: string; reason: WithdrawalReason; detail?: string }) =>
    apiClient.post<Enrollment>(`/enrollments/${id}/withdraw`, input),
  transfer: (id: string, input: { date: string; destination: string; detail?: string }) =>
    apiClient.post<Enrollment>(`/enrollments/${id}/transfer`, input),
  renew: (input: {
    fromAcademicYearId: string;
    toAcademicYearId: string;
    gradeStrategy: 'NEXT' | 'SAME';
    dryRun: boolean;
  }) => apiClient.post<RenewalReport>('/enrollments/renewals', input),
};

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  PRE_ENROLLED: 'Prematrícula',
  ACTIVE: 'Matriculado',
  WITHDRAWN: 'Retirado',
  TRANSFERRED: 'Trasladado',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Anulado',
};
export const ENROLLMENT_STATUS_TONES: Record<EnrollmentStatus, BadgeTone> = {
  PRE_ENROLLED: 'warning',
  ACTIVE: 'success',
  WITHDRAWN: 'danger',
  TRANSFERRED: 'neutral',
  COMPLETED: 'primary',
  CANCELLED: 'neutral',
};

export const WITHDRAWAL_REASON_LABELS: Record<WithdrawalReason, string> = {
  VOLUNTARY: 'Voluntario',
  ACADEMIC: 'Académico',
  DISCIPLINARY: 'Disciplinario',
  HEALTH: 'Salud',
  RELOCATION: 'Cambio de ciudad',
  ECONOMIC: 'Económico',
  OTHER: 'Otro',
};

export const RENEWAL_SKIP_LABELS: Record<RenewalReport['skipped'][number]['reason'], string> = {
  ALREADY_ENROLLED: 'Ya tiene matrícula en el año de destino',
  LAST_GRADE: 'Cursa el último grado',
  STUDENT_NOT_ACTIVE: 'El estudiante no está activo',
};

/** Una matrícula vigente (prematrícula o matriculado) en un año abierto admite cambios. */
export function isEditableEnrollment(e: Pick<Enrollment, 'status' | 'academicYear'>): boolean {
  return (
    (e.status === 'PRE_ENROLLED' || e.status === 'ACTIVE') && e.academicYear.status !== 'CLOSED'
  );
}

import { type AcademicYearStatus, type DocumentType, type RecordStatus } from '@educore/shared';
import { apiClient, toQuery } from '@/lib/api-client';

export interface CurriculumEntry {
  id: string;
  academicYearId: string;
  grade: { id: string; code: string; name: string };
  subject: {
    id: string;
    code: string;
    name: string;
    status: RecordStatus;
    area: { id: string; name: string };
  };
  weeklyHours: number;
}

export interface Assignment {
  id: string;
  academicYear: { id: string; year: number; status: AcademicYearStatus };
  group: { id: string; code: string; name: string; gradeId: string; gradeName: string };
  subject: { id: string; code: string; name: string };
  teacher: {
    id: string;
    status: RecordStatus;
    firstNames: string;
    lastNames: string;
    documentType: DocumentType;
    documentNumber: string;
  };
  fromDate: string;
  toDate: string | null;
  current: boolean;
}

export interface Roster {
  assignment: Assignment;
  students: Array<{
    studentId: string;
    code: string | null;
    firstNames: string;
    lastNames: string;
    documentType: DocumentType;
    documentNumber: string;
    enrollmentId: string;
    enrollmentStatus: string;
    inGroupSince: string;
  }>;
}

export interface TemplateReport {
  dryRun: boolean;
  created: Record<
    'levels' | 'grades' | 'areas' | 'subjects',
    Array<{ code: string; name: string }>
  >;
  skipped: Record<
    'levels' | 'grades' | 'areas' | 'subjects',
    Array<{ code: string; name: string }>
  >;
}

export const teachingService = {
  curriculum: (filter: { academicYearId: string; gradeId?: string }, signal?: AbortSignal) =>
    apiClient.get<CurriculumEntry[]>(`/curriculum${toQuery(filter)}`, { signal }),
  addCurriculum: (input: {
    academicYearId: string;
    gradeId: string;
    subjectId: string;
    weeklyHours: number;
  }) => apiClient.post<CurriculumEntry>('/curriculum', input),
  updateCurriculum: (id: string, weeklyHours: number) =>
    apiClient.patch<CurriculumEntry>(`/curriculum/${id}`, { weeklyHours }),
  removeCurriculum: (id: string) => apiClient.delete<void>(`/curriculum/${id}`),
  copyCurriculum: (fromAcademicYearId: string, toAcademicYearId: string) =>
    apiClient.post<{ created: number; skipped: number }>('/curriculum/copy', {
      fromAcademicYearId,
      toAcademicYearId,
    }),

  assignments: (
    filter: {
      academicYearId?: string;
      schoolGroupId?: string;
      staffMemberId?: string;
      includeEnded?: 'true';
    },
    signal?: AbortSignal,
  ) => apiClient.get<Assignment[]>(`/teaching-assignments${toQuery(filter)}`, { signal }),
  roster: (id: string, signal?: AbortSignal) =>
    apiClient.get<Roster>(`/teaching-assignments/${id}/students`, { signal }),
  assign: (input: {
    schoolGroupId: string;
    subjectId: string;
    staffMemberId: string;
    fromDate?: string;
  }) => apiClient.post<Assignment>('/teaching-assignments', input),
  replace: (id: string, input: { staffMemberId: string; effectiveDate?: string }) =>
    apiClient.post<Assignment>(`/teaching-assignments/${id}/replace`, input),
  end: (id: string, input: { date?: string }) =>
    apiClient.post<Assignment>(`/teaching-assignments/${id}/end`, input),

  applyColombianTemplate: (dryRun: boolean) =>
    apiClient.post<TemplateReport>('/academic-templates/colombia', { dryRun }),
};

import { type DocumentType, type RoundingMode } from '@educore/shared';
import { apiClient, toQuery } from '@/lib/api-client';

export interface Gradebook {
  group: { id: string; code: string; name: string };
  subject: { id: string; code: string; name: string };
  period: { id: string; number: number; name: string; status: string };
  scheme: {
    minScore: number;
    maxScore: number;
    decimals: number;
    passingScore: number;
    rounding: RoundingMode;
    levels: Array<{ code: string; name: string; minScore: number; maxScore: number }>;
    components: Array<{ id: string; code: string; name: string; weightPercent: number }>;
  };
  assessments: Array<{
    id: string;
    componentId: string;
    title: string;
    description: string | null;
    dueOn: string | null;
    gradedCount: number;
  }>;
  students: Array<{
    enrollmentId: string;
    studentId: string;
    code: string | null;
    firstNames: string;
    lastNames: string;
    documentType: DocumentType;
    documentNumber: string;
    inGroup: boolean;
    grades: Record<string, number | null>;
    comments: Record<string, string | null>;
    componentAverages: Record<string, number | null>;
    periodScore: number | null;
    level: { code: string; name: string } | null;
    passing: boolean | null;
  }>;
  canEdit: boolean;
}

export interface GradebookKey {
  schoolGroupId: string;
  subjectId: string;
  periodId: string;
}

export const gradebookService = {
  get: (key: GradebookKey, signal?: AbortSignal) =>
    apiClient.get<Gradebook>(`/gradebook${toQuery({ ...key })}`, { signal }),
  createAssessment: (
    input: GradebookKey & { componentId: string; title: string; dueOn?: string | null },
  ) => apiClient.post<{ id: string }>('/assessments', input),
  deleteAssessment: (id: string) => apiClient.delete<void>(`/assessments/${id}`),
  saveGrades: (
    assessmentId: string,
    grades: Array<{ enrollmentId: string; score: number | null }>,
    reason?: string,
  ) =>
    apiClient.put<{ changed: number }>(`/assessments/${assessmentId}/grades`, {
      grades,
      ...(reason && { reason }),
    }),
  history: (assessmentId: string, enrollmentId: string) =>
    apiClient.get<
      Array<{
        previousScore: number | null;
        newScore: number | null;
        reason: string | null;
        changedAt: string;
      }>
    >(`/assessments/${assessmentId}/grades/${enrollmentId}/history`),
};

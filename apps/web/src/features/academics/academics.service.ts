import {
  type AcademicPeriodStatus,
  type AcademicYearStatus,
  type RecordStatus,
} from '@educore/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, toQuery } from '@/lib/api-client';

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  status: RecordStatus;
}
export interface EducationLevel extends CatalogItem {
  sortOrder: number;
}
export interface Grade extends CatalogItem {
  sortOrder: number;
  educationLevelId: string;
  educationLevelName: string;
}
export interface Subject extends CatalogItem {
  subjectAreaId: string;
  subjectAreaName: string;
}
export interface AcademicPeriod {
  id: string;
  academicYearId: string;
  number: number;
  name: string;
  startsOn: string;
  endsOn: string;
  weightPercent: number;
  status: AcademicPeriodStatus;
}
export interface AcademicYear {
  id: string;
  year: number;
  name: string;
  startsOn: string;
  endsOn: string;
  status: AcademicYearStatus;
  totalWeightPercent: number;
  periods: AcademicPeriod[];
}
export interface SchoolGroup {
  id: string;
  code: string;
  name: string;
  capacity: number | null;
  status: RecordStatus;
  academicYearId: string;
  academicYear: number;
  gradeId: string;
  gradeName: string;
  campusId: string;
  campusName: string;
  shiftId: string;
  shiftName: string;
}

export interface PeriodInput {
  number: number;
  name: string;
  startsOn: string;
  endsOn: string;
  weightPercent: number;
}

export const academicsService = {
  levels: (signal?: AbortSignal) =>
    apiClient.get<EducationLevel[]>('/education-levels', { signal }),
  createLevel: (input: Partial<EducationLevel>) =>
    apiClient.post<EducationLevel>('/education-levels', input),
  updateLevel: (id: string, input: Partial<EducationLevel>) =>
    apiClient.patch<EducationLevel>(`/education-levels/${id}`, input),

  grades: (signal?: AbortSignal) => apiClient.get<Grade[]>('/grades', { signal }),
  createGrade: (input: Partial<Grade>) => apiClient.post<Grade>('/grades', input),
  updateGrade: (id: string, input: Partial<Grade>) =>
    apiClient.patch<Grade>(`/grades/${id}`, input),

  areas: (signal?: AbortSignal) => apiClient.get<CatalogItem[]>('/subject-areas', { signal }),
  createArea: (input: Partial<CatalogItem>) => apiClient.post<CatalogItem>('/subject-areas', input),
  updateArea: (id: string, input: Partial<CatalogItem>) =>
    apiClient.patch<CatalogItem>(`/subject-areas/${id}`, input),

  subjects: (signal?: AbortSignal) => apiClient.get<Subject[]>('/subjects', { signal }),
  createSubject: (input: Partial<Subject>) => apiClient.post<Subject>('/subjects', input),
  updateSubject: (id: string, input: Partial<Subject>) =>
    apiClient.patch<Subject>(`/subjects/${id}`, input),

  years: (signal?: AbortSignal) => apiClient.get<AcademicYear[]>('/academic-years', { signal }),
  year: (id: string, signal?: AbortSignal) =>
    apiClient.get<AcademicYear>(`/academic-years/${id}`, { signal }),
  createYear: (input: { year: number; name: string; startsOn: string; endsOn: string }) =>
    apiClient.post<AcademicYear>('/academic-years', input),
  updateYear: (id: string, input: { name?: string; startsOn?: string; endsOn?: string }) =>
    apiClient.patch<AcademicYear>(`/academic-years/${id}`, input),
  activateYear: (id: string) => apiClient.post<AcademicYear>(`/academic-years/${id}/activate`),
  closeYear: (id: string) => apiClient.post<AcademicYear>(`/academic-years/${id}/close`),
  createPeriod: (yearId: string, input: PeriodInput) =>
    apiClient.post<AcademicYear>(`/academic-years/${yearId}/periods`, input),
  updatePeriod: (id: string, input: Partial<PeriodInput>) =>
    apiClient.patch<AcademicYear>(`/academic-periods/${id}`, input),
  deletePeriod: (id: string) => apiClient.delete<AcademicYear>(`/academic-periods/${id}`),

  groups: (filter: { academicYearId?: string }, signal?: AbortSignal) =>
    apiClient.get<SchoolGroup[]>(`/school-groups${toQuery(filter)}`, { signal }),
  createGroup: (input: Record<string, unknown>) =>
    apiClient.post<SchoolGroup>('/school-groups', input),
  updateGroup: (id: string, input: Record<string, unknown>) =>
    apiClient.patch<SchoolGroup>(`/school-groups/${id}`, input),
};

export function useAcademicYears() {
  return useQuery({
    queryKey: ['academic-years'],
    queryFn: ({ signal }) => academicsService.years(signal),
  });
}

export const YEAR_STATUS_LABELS: Record<AcademicYearStatus, string> = {
  PLANNING: 'En planeación',
  ACTIVE: 'Activo',
  CLOSED: 'Cerrado',
};

export const YEAR_STATUS_TONES = {
  PLANNING: 'warning',
  ACTIVE: 'success',
  CLOSED: 'neutral',
} as const satisfies Record<AcademicYearStatus, 'warning' | 'success' | 'neutral'>;

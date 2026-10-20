import { type PromotionUnit, type RoundingMode } from '@educore/shared';
import { apiClient } from '@/lib/api-client';

export interface PerformanceLevel {
  id?: string;
  code: string;
  name: string;
  minScore: number;
  maxScore: number;
}

export interface GradingScheme {
  id: string;
  academicYear: { id: string; year: number; name: string; status: string };
  minScore: number;
  maxScore: number;
  decimals: number;
  passingScore: number;
  rounding: RoundingMode;
  promotionUnit: PromotionUnit;
  maxFailedForPromotion: number | null;
  minAttendancePercent: number | null;
  notes: string | null;
  levels: PerformanceLevel[];
  components: EvaluationComponent[];
  updatedAt: string;
}

export interface EvaluationComponent {
  id?: string;
  code: string;
  name: string;
  weightPercent: number;
}

export type GradingSchemeInput = Omit<GradingScheme, 'id' | 'academicYear' | 'updatedAt'>;

export const gradingService = {
  get: (yearId: string, signal?: AbortSignal) =>
    apiClient.get<GradingScheme>(`/academic-years/${yearId}/grading-scheme`, { signal }),
  save: (yearId: string, input: GradingSchemeInput) =>
    apiClient.put<GradingScheme>(`/academic-years/${yearId}/grading-scheme`, input),
  copy: (yearId: string, fromAcademicYearId: string) =>
    apiClient.post<GradingScheme>(`/academic-years/${yearId}/grading-scheme/copy`, {
      fromAcademicYearId,
    }),
};

export const ROUNDING_LABELS: Record<RoundingMode, string> = {
  HALF_UP: 'Al más cercano (0,5 hacia arriba)',
  TRUNCATE: 'Descartar decimales sobrantes',
};

export const PROMOTION_UNIT_LABELS: Record<PromotionUnit, string> = {
  AREA: 'Áreas',
  SUBJECT: 'Asignaturas',
};

/** Nota con coma decimal y los decimales de la escala (p. ej. 3,5). */
export function formatScore(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

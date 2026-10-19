import { type RecordStatus } from '@educore/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface InstitutionSettings {
  timezone: string;
  locale: string;
  currency: string;
  branding: { primaryColor: string | null; accentColor: string | null };
  preferences: { guardianAbsenceExcusesEnabled: boolean };
  logoUrl: string | null;
}

export interface Institution {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  taxIdDv: string | null;
  daneCode: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  country: string;
  settings: InstitutionSettings;
}

export interface Campus {
  id: string;
  code: string;
  name: string;
  isMain: boolean;
  daneCode: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  status: RecordStatus;
}

export interface Shift {
  id: string;
  code: string;
  name: string;
  status: RecordStatus;
}

export type InstitutionInput = Partial<Omit<Institution, 'id' | 'country' | 'settings'>>;

export interface SettingsInput {
  timezone?: string;
  locale?: string;
  currency?: string;
  branding?: { primaryColor?: string | null; accentColor?: string | null };
  preferences?: { guardianAbsenceExcusesEnabled?: boolean };
}

export const institutionService = {
  get: (signal?: AbortSignal) => apiClient.get<Institution>('/institution', { signal }),
  update: (input: InstitutionInput) => apiClient.patch<Institution>('/institution', input),
  updateSettings: (input: SettingsInput) =>
    apiClient.patch<Institution>('/institution/settings', input),
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<Institution>('/institution/logo', form);
  },
  removeLogo: () => apiClient.delete<Institution>('/institution/logo'),
  campuses: (signal?: AbortSignal) => apiClient.get<Campus[]>('/campuses', { signal }),
  createCampus: (input: Partial<Campus>) => apiClient.post<Campus>('/campuses', input),
  updateCampus: (id: string, input: Partial<Campus>) =>
    apiClient.patch<Campus>(`/campuses/${id}`, input),
  shifts: (signal?: AbortSignal) => apiClient.get<Shift[]>('/shifts', { signal }),
  createShift: (input: Partial<Shift>) => apiClient.post<Shift>('/shifts', input),
  updateShift: (id: string, input: Partial<Shift>) =>
    apiClient.patch<Shift>(`/shifts/${id}`, input),
};

export function useCampuses() {
  return useQuery({
    queryKey: ['campuses'],
    queryFn: ({ signal }) => institutionService.campuses(signal),
  });
}

export function useShifts() {
  return useQuery({
    queryKey: ['shifts'],
    queryFn: ({ signal }) => institutionService.shifts(signal),
  });
}

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
};

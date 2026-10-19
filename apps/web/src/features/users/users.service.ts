import { type DocumentType, type MembershipStatus } from '@educore/shared';
import { type PageMeta } from '@/components/page';
import { apiClient, toQuery } from '@/lib/api-client';

export interface User {
  id: string;
  membershipId: string;
  email: string;
  status: MembershipStatus;
  firstNames: string;
  lastNames: string;
  documentType: DocumentType;
  documentNumber: string;
  birthDate: string | null;
  phone: string | null;
  address: string | null;
  roles: Array<{ id: string; code: string; name: string }>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserPage {
  data: User[];
  meta: PageMeta;
}

export interface UserFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: MembershipStatus | '';
  roleCode?: string;
}

export interface UserInput {
  email: string;
  documentType: DocumentType;
  documentNumber: string;
  firstNames: string;
  lastNames: string;
  birthDate: string | null;
  phone: string | null;
  address: string | null;
}

export const usersService = {
  list: (filters: UserFilters, signal?: AbortSignal) =>
    apiClient.get<UserPage>(`/users${toQuery({ ...filters })}`, { signal }),
  get: (id: string, signal?: AbortSignal) => apiClient.get<User>(`/users/${id}`, { signal }),
  create: (input: UserInput & { roleCodes: string[] }) => apiClient.post<User>('/users', input),
  update: (id: string, input: Partial<UserInput>) => apiClient.patch<User>(`/users/${id}`, input),
  setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') =>
    apiClient.patch<User>(`/users/${id}/status`, { status }),
  setRoles: (id: string, roleCodes: string[]) =>
    apiClient.put<User>(`/users/${id}/roles`, { roleCodes }),
  sendAccessEmail: (id: string) =>
    apiClient.post<{ sent: 'ACTIVATION' | 'RESET' }>(`/users/${id}/access-email`),
  getProfile: (signal?: AbortSignal) => apiClient.get<User>('/me/profile', { signal }),
  updateProfile: (input: { phone: string | null; address: string | null }) =>
    apiClient.patch<User>('/me/profile', input),
};

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  ACTIVE: 'Activo',
  INVITED: 'Invitado',
  SUSPENDED: 'Suspendido',
};

export const MEMBERSHIP_STATUS_TONES = {
  ACTIVE: 'success',
  INVITED: 'warning',
  SUSPENDED: 'danger',
} as const satisfies Record<MembershipStatus, 'success' | 'warning' | 'danger'>;

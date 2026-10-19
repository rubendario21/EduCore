import { type PermissionScope } from '@educore/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissions: Array<{ code: string; scope: PermissionScope }>;
}

export interface PermissionInfo {
  code: string;
  module: string;
  description: string;
  allowedScopes: PermissionScope[];
}

export interface RoleInput {
  code?: string;
  name: string;
  description?: string;
  permissions: Array<{ code: string; scope: PermissionScope }>;
}

export const rolesService = {
  list: (signal?: AbortSignal) => apiClient.get<Role[]>('/roles', { signal }),
  get: (id: string, signal?: AbortSignal) => apiClient.get<Role>(`/roles/${id}`, { signal }),
  permissions: (signal?: AbortSignal) =>
    apiClient.get<PermissionInfo[]>('/permissions', { signal }),
  create: (input: RoleInput & { code: string }) => apiClient.post<Role>('/roles', input),
  update: (id: string, input: Partial<RoleInput>) => apiClient.patch<Role>(`/roles/${id}`, input),
  remove: (id: string) => apiClient.delete<void>(`/roles/${id}`),
};

export const rolesQueryKey = ['roles'] as const;

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: rolesQueryKey,
    queryFn: ({ signal }) => rolesService.list(signal),
    enabled,
  });
}

export const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Tablero',
  institution: 'Institución',
  users: 'Usuarios',
  access: 'Roles y permisos',
  audit: 'Auditoría',
  academics: 'Estructura académica',
};

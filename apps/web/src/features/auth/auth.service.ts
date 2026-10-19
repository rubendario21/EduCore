import { apiClient, CSRF_HEADERS } from '@/lib/api-client';
import { type AuthSession, type AuthUser } from './types';

/** Endpoints de autenticación. Los anónimos no adjuntan token ni reintentan. */
export const authService = {
  login: (email: string, password: string) =>
    apiClient.post<AuthSession>('/auth/login', { email, password }, { anonymous: true }),

  refresh: () =>
    apiClient.post<AuthSession>('/auth/refresh', undefined, {
      anonymous: true,
      headers: CSRF_HEADERS,
    }),

  logout: () =>
    apiClient.post<void>('/auth/logout', undefined, { anonymous: true, headers: CSRF_HEADERS }),

  me: () => apiClient.get<AuthUser>('/auth/me'),

  forgotPassword: (email: string) =>
    apiClient.post<{ message: string }>('/auth/password/forgot', { email }, { anonymous: true }),

  resetPassword: (token: string, newPassword: string) =>
    apiClient.post<void>('/auth/password/reset', { token, newPassword }, { anonymous: true }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<void>('/auth/password/change', { currentPassword, newPassword }),
};

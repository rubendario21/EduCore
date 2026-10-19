import { apiClient } from '@/lib/api-client';
import { type HealthResponse } from '../types';

export const healthService = {
  check: (signal?: AbortSignal) => apiClient.get<HealthResponse>('/health', { signal }),
};

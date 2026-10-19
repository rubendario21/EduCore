import { useQuery } from '@tanstack/react-query';
import { healthService } from '../services/health.service';

export const healthQueryKey = ['system', 'health'] as const;

export function useHealth() {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => healthService.check(signal),
    refetchInterval: 30_000,
    retry: false,
  });
}

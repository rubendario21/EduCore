export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs?: number;
}

export interface HealthResponse {
  status: 'ok';
  checks: { database: DependencyStatus };
  timestamp: string;
}

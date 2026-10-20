import { type DocumentType } from '@educore/shared';
import { type PageMeta } from '@/components/page';
import { apiClient, toQuery } from '@/lib/api-client';
import { type Page } from '@/features/people/people.service';

export const CONSENT_METHODS = [
  'WRITTEN',
  'ELECTRONIC',
  'EMAIL',
  'RECORDED_CALL',
  'OTHER',
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export interface PolicyPurpose {
  id: string;
  code: string;
  name: string;
  description: string | null;
  required: boolean;
}

export interface Policy {
  id: string;
  version: string;
  title: string;
  content: string;
  effectiveFrom: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  purposes: PolicyPurpose[];
}

export interface PolicyInput {
  version: string;
  title: string;
  content: string;
  effectiveFrom: string;
  purposes: Array<{ code: string; name: string; description: string | null; required: boolean }>;
}

interface PersonRef {
  id: string;
  firstNames: string;
  lastNames: string;
  documentType: DocumentType;
  documentNumber: string;
}

export interface Consent {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  policy: { id: string; version: string; title: string };
  student: PersonRef & { code: string | null };
  authorizer: PersonRef;
  authorizerRole: 'LEGAL_REPRESENTATIVE' | 'TITULAR';
  method: ConsentMethod;
  consentedOn: string;
  notes: string | null;
  decisions: Array<{
    purposeId: string;
    code: string;
    name: string;
    required: boolean;
    granted: boolean;
  }>;
  evidence: { fileName: string; mimeType: string; sizeBytes: number } | null;
  createdAt: string;
  revocation: { date: string; reason: string; recordedAt: string } | null;
}

export interface Coverage {
  policy: { id: string; version: string; title: string };
  totals: {
    activeStudents: number;
    withConsent: number;
    withoutConsent: number;
    requiredDenied: number;
  };
  pending: Array<PersonRef & { code: string | null }>;
  meta: PageMeta;
}

export const privacyService = {
  policies: (signal?: AbortSignal) => apiClient.get<Policy[]>('/data-policies', { signal }),
  currentPolicy: (signal?: AbortSignal) =>
    apiClient.get<Policy>('/data-policies/current', { signal }),
  createPolicy: (input: PolicyInput) => apiClient.post<Policy>('/data-policies', input),
  updatePolicy: (id: string, input: Partial<PolicyInput>) =>
    apiClient.patch<Policy>(`/data-policies/${id}`, input),
  publishPolicy: (id: string) => apiClient.post<Policy>(`/data-policies/${id}/publish`),

  consents: (filter: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    apiClient.get<Page<Consent>>(`/data-consents${toQuery(filter)}`, { signal }),
  coverage: (filter: { page: number; pageSize: number; policyId?: string }, signal?: AbortSignal) =>
    apiClient.get<Coverage>(`/data-consents/coverage${toQuery(filter)}`, { signal }),
  recordConsent: (input: {
    studentId: string;
    policyId: string;
    authorizerPersonId: string;
    method: ConsentMethod;
    consentedOn: string;
    decisions: Array<{ purposeId: string; granted: boolean }>;
    notes?: string | null;
  }) => apiClient.post<Consent>('/data-consents', input),
  revoke: (id: string, input: { reason: string; date?: string }) =>
    apiClient.post<Consent>(`/data-consents/${id}/revoke`, input),
  attachEvidence: (id: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return apiClient.post<Consent>(`/data-consents/${id}/evidence`, body);
  },
};

export const CONSENT_METHOD_LABELS: Record<ConsentMethod, string> = {
  WRITTEN: 'Documento escrito firmado',
  ELECTRONIC: 'Formulario electrónico',
  EMAIL: 'Correo electrónico',
  RECORDED_CALL: 'Llamada grabada',
  OTHER: 'Otro',
};

export const AUTHORIZER_ROLE_LABELS: Record<Consent['authorizerRole'], string> = {
  LEGAL_REPRESENTATIVE: 'Representante legal',
  TITULAR: 'Titular (mayor de edad)',
};

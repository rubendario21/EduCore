import { describe, expect, it } from 'vitest';
import { type AdmissionStatus, availableActions } from './admissions.service';

describe('availableActions (flujo de admisión)', () => {
  const actionsOf = (status: AdmissionStatus) => availableActions(status).map((a) => a.action);

  it('ofrece solo las transiciones válidas de cada estado', () => {
    expect(actionsOf('DRAFT')).toEqual(['submit', 'withdraw']);
    expect(actionsOf('SUBMITTED')).toEqual(['review', 'withdraw']);
    expect(actionsOf('IN_REVIEW')).toEqual(['waitlist', 'approve', 'reject', 'withdraw']);
    expect(actionsOf('WAITLISTED')).toEqual(['approve', 'reject', 'withdraw']);
    expect(actionsOf('APPROVED')).toEqual(['enroll', 'withdraw']);
  });

  it('los estados finales no tienen acciones', () => {
    for (const status of ['REJECTED', 'ENROLLED', 'WITHDRAWN'] as const) {
      expect(actionsOf(status)).toEqual([]);
    }
  });

  it('las decisiones corresponden a quien decide, y matricular exige sus propios permisos', () => {
    const kinds = Object.fromEntries(availableActions('IN_REVIEW').map((a) => [a.action, a.kind]));
    expect(kinds).toMatchObject({
      approve: 'decide',
      reject: 'decide',
      waitlist: 'decide',
      withdraw: 'manage',
    });
    expect(availableActions('APPROVED')[0]).toMatchObject({ action: 'enroll', kind: 'enroll' });
  });
});

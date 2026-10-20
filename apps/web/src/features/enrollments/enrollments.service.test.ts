import { describe, expect, it } from 'vitest';
import { isEditableEnrollment } from './enrollments.service';

describe('isEditableEnrollment', () => {
  const year = (status: 'PLANNING' | 'ACTIVE' | 'CLOSED') => ({
    id: 'y',
    year: 2027,
    name: '2027',
    status,
  });

  it('solo las matrículas vigentes de años abiertos admiten cambios', () => {
    expect(isEditableEnrollment({ status: 'ACTIVE', academicYear: year('ACTIVE') })).toBe(true);
    expect(isEditableEnrollment({ status: 'PRE_ENROLLED', academicYear: year('PLANNING') })).toBe(
      true,
    );
    expect(isEditableEnrollment({ status: 'ACTIVE', academicYear: year('CLOSED') })).toBe(false);
    for (const status of ['WITHDRAWN', 'TRANSFERRED', 'COMPLETED', 'CANCELLED'] as const) {
      expect(isEditableEnrollment({ status, academicYear: year('ACTIVE') })).toBe(false);
    }
  });
});

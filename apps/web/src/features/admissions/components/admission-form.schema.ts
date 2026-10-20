import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  emptyPerson,
  personSchema,
  type PersonValues,
} from '@/features/people/components/person-form';
import { GUARDIAN_RELATIONSHIPS } from '@/features/people/people.service';
import { nullIfEmpty, optionalText } from '@/lib/forms';
import { type Admission, type AdmissionInput } from '../admissions.service';

export const admissionSchema = z.object({
  academicYearId: z.string().min(1, 'Selecciona el año lectivo.'),
  gradeId: z.string().min(1, 'Selecciona el grado.'),
  applicant: personSchema,
  hasGuardian: z.boolean(),
  guardian: personSchema,
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
  previousSchool: optionalText(200),
  notes: optionalText(1000),
});
export type AdmissionValues = z.infer<typeof admissionSchema>;

const fromPerson = (p: {
  documentType: PersonValues['documentType'];
  documentNumber: string;
  firstNames: string;
  lastNames: string;
}): PersonValues => ({ ...emptyPerson(p.documentType), ...p });

export function admissionDefaults(admission?: Admission): AdmissionValues {
  if (!admission) {
    return {
      academicYearId: '',
      gradeId: '',
      applicant: emptyPerson('TI'),
      hasGuardian: true,
      guardian: emptyPerson('CC'),
      relationship: 'MOTHER',
      previousSchool: '',
      notes: '',
    };
  }
  const g = admission.guardian;
  return {
    academicYearId: admission.academicYear.id,
    gradeId: admission.grade.id,
    applicant: {
      ...fromPerson(admission.applicant),
      birthDate: admission.applicant.birthDate ?? '',
    },
    hasGuardian: g !== null,
    guardian: g
      ? { ...fromPerson(g), email: g.email ?? '', phone: g.phone ?? '' }
      : emptyPerson('CC'),
    relationship: g?.relationship ?? 'MOTHER',
    previousSchool: admission.previousSchool ?? '',
    notes: admission.notes ?? '',
  };
}

/** Datos para la API: solo los campos que admite cada parte de la solicitud. */
export function toAdmissionInput(v: AdmissionValues): AdmissionInput {
  return {
    academicYearId: v.academicYearId,
    gradeId: v.gradeId,
    applicant: {
      documentType: v.applicant.documentType,
      documentNumber: v.applicant.documentNumber.trim(),
      firstNames: v.applicant.firstNames.trim(),
      lastNames: v.applicant.lastNames.trim(),
      birthDate: nullIfEmpty(v.applicant.birthDate),
    },
    guardian: v.hasGuardian
      ? {
          documentType: v.guardian.documentType,
          documentNumber: v.guardian.documentNumber.trim(),
          firstNames: v.guardian.firstNames.trim(),
          lastNames: v.guardian.lastNames.trim(),
          relationship: v.relationship,
          email: nullIfEmpty(v.guardian.email),
          phone: nullIfEmpty(v.guardian.phone),
        }
      : null,
    previousSchool: nullIfEmpty(v.previousSchool),
    notes: nullIfEmpty(v.notes),
  };
}

export function useAdmissionForm(admission?: Admission) {
  return useForm<AdmissionValues>({
    // Sin acudiente, sus campos no se validan.
    resolver: (values, context, options) =>
      zodResolver(
        values.hasGuardian ? admissionSchema : admissionSchema.extend({ guardian: z.any() }),
      )(values, context, options),
    values: admissionDefaults(admission),
  });
}

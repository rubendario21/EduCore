import { useQuery } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { academicsService, useAcademicYears } from '@/features/academics/academics.service';
import { PersonFields } from '@/features/people/components/person-fields';
import { GUARDIAN_RELATIONSHIPS, RELATIONSHIP_LABELS } from '@/features/people/people.service';
import { type useAdmissionForm } from './admission-form.schema';

/** Campos de la solicitud: año y grado, aspirante, acudiente y procedencia. */
export function AdmissionFields({
  form,
  yearLocked = false,
}: {
  form: ReturnType<typeof useAdmissionForm>;
  yearLocked?: boolean;
}) {
  const { data: years = [] } = useAcademicYears();
  const { data: grades = [] } = useQuery({
    queryKey: ['grades'],
    queryFn: ({ signal }) => academicsService.grades(signal),
  });
  const hasGuardian = useWatch({ control: form.control, name: 'hasGuardian' });
  const { errors } = form.formState;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Año lectivo" required error={errors.academicYearId?.message}>
          {(c) => (
            <Select {...c} disabled={yearLocked} {...form.register('academicYearId')}>
              <option value="">Selecciona…</option>
              {years
                .filter((y) => y.status !== 'CLOSED')
                .map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Grado al que aspira" required error={errors.gradeId?.message}>
          {(c) => (
            <Select {...c} {...form.register('gradeId')}>
              <option value="">Selecciona…</option>
              {grades
                .filter((g) => g.status === 'ACTIVE')
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Aspirante</legend>
        <PersonFields form={form} prefix="applicant" compact withContact={false} />
        <Field label="Institución de procedencia" error={errors.previousSchool?.message}>
          {(c) => <Input {...c} {...form.register('previousSchool')} />}
        </Field>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Acudiente</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox {...form.register('hasGuardian')} /> Registrar el acudiente que presenta la
          solicitud
        </label>
        {hasGuardian && (
          <>
            <PersonFields form={form} prefix="guardian" compact withBirthDate={false} />
            <Field label="Parentesco" required className="sm:w-60">
              {(c) => (
                <Select {...c} {...form.register('relationship')}>
                  {GUARDIAN_RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {RELATIONSHIP_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}
      </fieldset>
      <Field label="Observaciones" error={errors.notes?.message}>
        {(c) => <Textarea {...c} maxLength={1000} {...form.register('notes')} />}
      </Field>
    </div>
  );
}

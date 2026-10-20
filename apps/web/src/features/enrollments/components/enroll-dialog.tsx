import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { academicsService, useAcademicYears } from '@/features/academics/academics.service';
import { type PickedStudent, StudentPicker } from '@/features/people/components/student-picker';
import { getErrorMessage } from '@/lib/api-client';
import { enrollmentsService } from '../enrollments.service';

/** Matricular (o prematricular) a un estudiante en un año, grado y, opcionalmente, grupo. */
export function EnrollDialog({
  open,
  onOpenChange,
  student: fixedStudent,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: PickedStudent;
  onEnrolled?: (enrollmentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [student, setStudent] = useState<PickedStudent | null>(fixedStudent ?? null);
  const [yearId, setYearId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'PRE_ENROLLED'>('ACTIVE');
  const [enrolledOn, setEnrolledOn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: years = [] } = useAcademicYears();
  const { data: grades = [] } = useQuery({
    queryKey: ['grades'],
    queryFn: ({ signal }) => academicsService.grades(signal),
    enabled: open,
  });
  const { data: groups = [] } = useQuery({
    queryKey: ['school-groups', { academicYearId: yearId }],
    queryFn: ({ signal }) => academicsService.groups({ academicYearId: yearId }, signal),
    enabled: open && !!yearId,
  });
  const openYears = years.filter((y) => y.status !== 'CLOSED');
  const gradeGroups = groups.filter((g) => g.gradeId === gradeId && g.status === 'ACTIVE');

  const reset = () => {
    setStudent(fixedStudent ?? null);
    setGradeId('');
    setGroupId('');
    setStatus('ACTIVE');
    setEnrolledOn('');
    setError(null);
  };

  const mutation = useMutation({
    mutationFn: () =>
      enrollmentsService.create({
        studentId: student!.id,
        academicYearId: yearId,
        gradeId,
        schoolGroupId: groupId || undefined,
        status,
        enrolledOn: enrolledOn || undefined,
      }),
    onSuccess: async (enrollment) => {
      await queryClient.invalidateQueries({ queryKey: ['enrollments'] });
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(
        `${enrollment.student.firstNames} quedó ${status === 'ACTIVE' ? 'matriculado(a)' : 'prematriculado(a)'} en ${enrollment.grade.name}.`,
      );
      reset();
      onOpenChange(false);
      onEnrolled?.(enrollment.id);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const missing = !student
    ? 'Selecciona el estudiante.'
    : !yearId
      ? 'Selecciona el año lectivo.'
      : !gradeId
        ? 'Selecciona el grado.'
        : null;

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Matricular"
      description="Una matrícula vigente por estudiante y año. Si el grupo no tiene cupo, la matrícula se rechaza."
      submitLabel={status === 'ACTIVE' ? 'Matricular' : 'Prematricular'}
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (missing) return setError(missing);
        setError(null);
        mutation.mutate();
      }}
    >
      {!fixedStudent && (
        <Field label="Estudiante" required>
          {() => <StudentPicker value={student} onChange={setStudent} />}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Año lectivo" required>
          {(c) => (
            <Select
              {...c}
              value={yearId}
              onChange={(e) => {
                setYearId(e.target.value);
                setGroupId('');
              }}
            >
              <option value="">Selecciona…</option>
              {openYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Grado" required>
          {(c) => (
            <Select
              {...c}
              value={gradeId}
              onChange={(e) => {
                setGradeId(e.target.value);
                setGroupId('');
              }}
            >
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
        <Field label="Grupo" hint="Opcional: se puede ubicar después.">
          {(c) => (
            <Select
              {...c}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={!yearId || !gradeId}
            >
              <option value="">Sin grupo por ahora</option>
              {gradeGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.campusName} · {g.shiftName}
                  {g.capacity ? ` (cupo ${g.capacity})` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tipo">
          {(c) => (
            <Select
              {...c}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="ACTIVE">Matrícula</option>
              <option value="PRE_ENROLLED">Prematrícula</option>
            </Select>
          )}
        </Field>
        <Field label="Fecha de matrícula" hint="Por defecto, hoy.">
          {(c) => (
            <Input
              {...c}
              type="date"
              value={enrolledOn}
              onChange={(e) => setEnrolledOn(e.target.value)}
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

import { PERMISSIONS } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { academicsService, useAcademicYears } from '@/features/academics/academics.service';
import { useAuth } from '@/features/auth/auth-context';
import { peopleService } from '@/features/people/people.service';
import { getErrorMessage } from '@/lib/api-client';
import { formatDate, fullName } from '@/lib/format';
import { type Assignment, type CurriculumEntry, teachingService } from '../teaching.service';

type Dialog =
  | { kind: 'assign'; entry: CurriculumEntry }
  | { kind: 'replace'; assignment: Assignment }
  | { kind: 'end'; assignment: Assignment }
  | null;

function AssignmentDialog({
  dialog,
  groupId,
  onClose,
}: {
  dialog: Dialog;
  groupId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: teachers } = useQuery({
    queryKey: ['staff', { staffType: 'TEACHER', pageSize: 100 }],
    queryFn: ({ signal }) =>
      peopleService.staff({ staffType: 'TEACHER', pageSize: 100, page: 1 }, signal),
    enabled: dialog !== null && dialog.kind !== 'end',
  });
  const [teacherId, setTeacherId] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      if (dialog!.kind === 'assign')
        return teachingService.assign({
          schoolGroupId: groupId,
          subjectId: dialog!.entry.subject.id,
          staffMemberId: teacherId,
          fromDate: date || undefined,
        });
      if (dialog!.kind === 'replace')
        return teachingService.replace(dialog!.assignment.id, {
          staffMemberId: teacherId,
          effectiveDate: date || undefined,
        });
      return teachingService.end(dialog!.assignment.id, { date: date || undefined });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['teaching-assignments'] });
      toast.success(dialog!.kind === 'end' ? 'Asignación finalizada.' : 'Asignación guardada.');
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  if (!dialog) return null;
  const subject =
    dialog.kind === 'assign' ? dialog.entry.subject.name : dialog.assignment.subject.name;
  const activeTeachers = (teachers?.data ?? []).filter((t) => t.status === 'ACTIVE');
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        dialog.kind === 'assign'
          ? `Asignar ${subject}`
          : dialog.kind === 'replace'
            ? `Reemplazar docente de ${subject}`
            : `Finalizar ${subject}`
      }
      description={
        dialog.kind === 'replace'
          ? 'La asignación actual se cierra en la fecha indicada y queda en el historial.'
          : dialog.kind === 'end'
            ? `${fullName(dialog.assignment.teacher)} deja de dictar la asignatura en este grupo.`
            : 'Solo se asignan docentes activos.'
      }
      submitLabel={dialog.kind === 'end' ? 'Finalizar' : 'Guardar'}
      danger={dialog.kind === 'end'}
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (dialog.kind !== 'end' && !teacherId) return setError('Selecciona el docente.');
        setError(null);
        mutation.mutate();
      }}
    >
      {dialog.kind !== 'end' && (
        <Field label="Docente" required>
          {(c) => (
            <Select {...c} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              <option value="">Selecciona…</option>
              {activeTeachers
                .filter((t) => dialog.kind !== 'replace' || t.id !== dialog.assignment.teacher.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {fullName(t.person)}
                    {t.title ? ` · ${t.title}` : ''}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      )}
      <Field
        label={dialog.kind === 'assign' ? 'Desde' : 'Fecha'}
        hint="Por defecto, hoy (o el inicio del año si aún no empieza)."
      >
        {(c) => <Input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

/** Asignación académica: docente por asignatura en cada grupo. */
export function TeachingPage() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.TEACHING_MANAGE);
  const { data: years = [] } = useAcademicYears();
  const [yearId, setYearId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [history, setHistory] = useState(false);
  const year =
    years.find((y) => y.id === yearId) ?? years.find((y) => y.status === 'ACTIVE') ?? years[0];
  const { data: groups = [] } = useQuery({
    queryKey: ['school-groups', { academicYearId: year?.id }],
    queryFn: ({ signal }) => academicsService.groups({ academicYearId: year!.id }, signal),
    enabled: !!year,
  });
  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  const curriculum = useQuery({
    queryKey: ['curriculum', { academicYearId: year?.id, gradeId: group?.gradeId }],
    queryFn: ({ signal }) =>
      teachingService.curriculum({ academicYearId: year!.id, gradeId: group!.gradeId }, signal),
    enabled: !!year && !!group,
  });
  const assignments = useQuery({
    queryKey: ['teaching-assignments', { schoolGroupId: group?.id, includeEnded: 'true' }],
    queryFn: ({ signal }) =>
      teachingService.assignments({ schoolGroupId: group!.id, includeEnded: 'true' }, signal),
    enabled: !!group,
  });
  const editable = canManage && year?.status !== 'CLOSED';
  const currentBySubject = new Map(
    (assignments.data ?? []).filter((a) => a.current).map((a) => [a.subject.id, a]),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Asignación académica"
        description="Qué docente dicta cada asignatura del plan de estudios en cada grupo."
      />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Año lectivo" className="w-48">
          {(c) => (
            <Select
              {...c}
              value={year?.id ?? ''}
              onChange={(e) => (setYearId(e.target.value), setGroupId(''))}
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Grupo" className="w-72">
          {(c) => (
            <Select {...c} value={group?.id ?? ''} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.gradeName} · {g.campusName}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {!group ? (
        <EmptyState
          title="No hay grupos en este año"
          description="Crea los grupos en Estructura académica."
        />
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>
              {group.name} · {group.gradeName}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setHistory((h) => !h)}>
              {history ? 'Ocultar historial' : 'Ver historial'}
            </Button>
          </CardHeader>
          {curriculum.isPending || assignments.isPending ? (
            <LoadingState />
          ) : curriculum.error || assignments.error ? (
            <ErrorState error={curriculum.error ?? assignments.error} />
          ) : curriculum.data.length === 0 ? (
            <EmptyState
              title={`${group.gradeName} no tiene plan de estudios en ${year?.name}`}
              description="Defínelo en Estructura académica → Plan de estudios."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Asignatura</Th>
                  <Th>Horas</Th>
                  <Th>Docente</Th>
                  <Th>Desde</Th>
                  {editable && <Th className="w-56" />}
                </tr>
              </THead>
              <TBody>
                {curriculum.data.map((entry) => {
                  const current = currentBySubject.get(entry.subject.id);
                  return (
                    <tr key={entry.id}>
                      <Td className="font-medium">{entry.subject.name}</Td>
                      <Td>{entry.weeklyHours}</Td>
                      <Td>
                        {current ? (
                          fullName(current.teacher)
                        ) : (
                          <Badge tone="warning">Sin docente</Badge>
                        )}
                      </Td>
                      <Td>{current ? formatDate(current.fromDate) : '—'}</Td>
                      {editable && (
                        <Td className="whitespace-nowrap text-right">
                          {current ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDialog({ kind: 'replace', assignment: current })}
                              >
                                Reemplazar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-danger"
                                onClick={() => setDialog({ kind: 'end', assignment: current })}
                              >
                                Finalizar
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" onClick={() => setDialog({ kind: 'assign', entry })}>
                              Asignar
                            </Button>
                          )}
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </TBody>
            </Table>
          )}
          {history && assignments.data && (
            <div className="border-t p-4 text-sm">
              <p className="mb-2 font-medium">Historial del grupo</p>
              {assignments.data.length === 0 ? (
                <p className="text-muted-foreground">Sin asignaciones.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {assignments.data.map((a) => (
                    <li key={a.id}>
                      {a.subject.name}: {fullName(a.teacher)} · {formatDate(a.fromDate)} –{' '}
                      {a.toDate ? formatDate(a.toDate) : 'actual'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}
      {group && (
        <AssignmentDialog
          key={
            dialog
              ? `${dialog.kind}-${dialog.kind === 'assign' ? dialog.entry.id : dialog.assignment.id}`
              : 'none'
          }
          dialog={dialog}
          groupId={group.id}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

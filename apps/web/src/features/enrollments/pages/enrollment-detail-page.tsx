import { PERMISSIONS } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { DetailList, FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { academicsService } from '@/features/academics/academics.service';
import { useAuth } from '@/features/auth/auth-context';
import { getErrorMessage } from '@/lib/api-client';
import { formatDate, fullName } from '@/lib/format';
import {
  type Enrollment,
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUS_TONES,
  enrollmentsService,
  isEditableEnrollment,
  WITHDRAWAL_REASON_LABELS,
  WITHDRAWAL_REASONS,
  type WithdrawalReason,
} from '../enrollments.service';

type Action = 'placement' | 'withdraw' | 'transfer' | null;
const todayLocal = () => new Date().toLocaleDateString('en-CA');

function useEnrollmentMutation<T>(fn: (input: T) => Promise<Enrollment>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (enrollment) => {
      queryClient.setQueryData(['enrollments', 'detail', enrollment.id], enrollment);
      await queryClient.invalidateQueries({ queryKey: ['enrollments'] });
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(success);
    },
  });
}

function PlacementDialog({
  enrollment,
  open,
  onClose,
}: {
  enrollment: Enrollment;
  open: boolean;
  onClose: () => void;
}) {
  const { data: groups = [] } = useQuery({
    queryKey: ['school-groups', { academicYearId: enrollment.academicYear.id }],
    queryFn: ({ signal }) =>
      academicsService.groups({ academicYearId: enrollment.academicYear.id }, signal),
    enabled: open,
  });
  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useEnrollmentMutation(
    () =>
      enrollmentsService.changePlacement(enrollment.id, {
        schoolGroupId: groupId,
        effectiveDate: date,
        reason: reason.trim() || undefined,
      }),
    enrollment.currentGroup ? 'Cambio de grupo registrado.' : 'Estudiante ubicado en el grupo.',
  );
  const options = groups.filter(
    (g) =>
      g.gradeId === enrollment.grade.id &&
      g.status === 'ACTIVE' &&
      g.id !== enrollment.currentGroup?.id,
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={enrollment.currentGroup ? 'Cambiar de grupo' : 'Ubicar en un grupo'}
      description="El historial conserva el grupo anterior con sus fechas. Un cambio el mismo día en que empezó la ubicación actual se toma como corrección."
      submitLabel="Guardar"
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (!groupId) return setError('Selecciona el grupo.');
        mutation.mutate(undefined, {
          onSuccess: onClose,
          onError: (e) => setError(getErrorMessage(e)),
        });
      }}
    >
      <Field label="Grupo" required>
        {(c) => (
          <Select {...c} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Selecciona…</option>
            {options.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.campusName} · {g.shiftName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Desde">
        {(c) => <Input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <Field label="Motivo">
        {(c) => (
          <Input
            {...c}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

function EndDialog({
  enrollment,
  kind,
  onClose,
}: {
  enrollment: Enrollment;
  kind: 'withdraw' | 'transfer' | null;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayLocal());
  const [reason, setReason] = useState<WithdrawalReason>('VOLUNTARY');
  const [destination, setDestination] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useEnrollmentMutation(
    () =>
      kind === 'withdraw'
        ? enrollmentsService.withdraw(enrollment.id, {
            date,
            reason,
            detail: detail.trim() || undefined,
          })
        : enrollmentsService.transfer(enrollment.id, {
            date,
            destination: destination.trim(),
            detail: detail.trim() || undefined,
          }),
    kind === 'withdraw' ? 'Retiro registrado.' : 'Traslado registrado.',
  );
  return (
    <FormDialog
      open={kind !== null}
      onOpenChange={(o) => !o && onClose()}
      title={kind === 'withdraw' ? 'Registrar retiro' : 'Registrar traslado'}
      description="Se cierra la ubicación en el grupo, se libera el cupo y el estudiante queda como retirado. La matrícula se conserva."
      submitLabel={kind === 'withdraw' ? 'Retirar' : 'Trasladar'}
      danger
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (kind === 'transfer' && destination.trim().length < 3)
          return setError('Indica la institución de destino.');
        mutation.mutate(undefined, {
          onSuccess: onClose,
          onError: (e) => setError(getErrorMessage(e)),
        });
      }}
    >
      <Field label="Fecha" required>
        {(c) => <Input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      {kind === 'withdraw' ? (
        <Field label="Motivo" required>
          {(c) => (
            <Select
              {...c}
              value={reason}
              onChange={(e) => setReason(e.target.value as WithdrawalReason)}
            >
              {WITHDRAWAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {WITHDRAWAL_REASON_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="Institución de destino" required>
          {(c) => (
            <Input
              {...c}
              maxLength={200}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          )}
        </Field>
      )}
      <Field label="Detalle">
        {(c) => (
          <Textarea
            {...c}
            maxLength={400}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

export function EnrollmentDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [action, setAction] = useState<Action>(null);
  const {
    data: enrollment,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['enrollments', 'detail', id],
    queryFn: ({ signal }) => enrollmentsService.get(id, signal),
  });
  const activate = useEnrollmentMutation(
    () => enrollmentsService.activate(id),
    'Matrícula formalizada.',
  );
  const cancel = useEnrollmentMutation(
    () => enrollmentsService.cancel(id),
    'Prematrícula anulada (se conserva el registro).',
  );
  const onError = { onError: (e: unknown) => toast.error(getErrorMessage(e)) };

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const editable = can(PERMISSIONS.ENROLLMENTS_MANAGE) && isEditableEnrollment(enrollment);
  const { student } = enrollment;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        to="/matriculas"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Matrículas
      </Link>
      <PageHeader
        title={fullName(student)}
        description={`${enrollment.academicYear.name} · ${enrollment.grade.name}${enrollment.currentGroup ? ` · ${enrollment.currentGroup.name}` : ''}`}
        actions={
          <>
            <Badge tone={ENROLLMENT_STATUS_TONES[enrollment.status]}>
              {ENROLLMENT_STATUS_LABELS[enrollment.status]}
            </Badge>
            {editable && enrollment.status === 'PRE_ENROLLED' && (
              <>
                <Button
                  onClick={() => activate.mutate(undefined, onError)}
                  disabled={activate.isPending}
                >
                  Formalizar matrícula
                </Button>
                <Button
                  variant="outline"
                  onClick={() => cancel.mutate(undefined, onError)}
                  disabled={cancel.isPending}
                >
                  Anular
                </Button>
              </>
            )}
            {editable && (
              <Button variant="outline" onClick={() => setAction('placement')}>
                {enrollment.currentGroup ? 'Cambiar de grupo' : 'Ubicar en grupo'}
              </Button>
            )}
            {editable && enrollment.status === 'ACTIVE' && (
              <>
                <Button variant="outline" onClick={() => setAction('withdraw')}>
                  Retirar
                </Button>
                <Button variant="outline" onClick={() => setAction('transfer')}>
                  Trasladar
                </Button>
              </>
            )}
          </>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Matrícula</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              [
                'Estudiante',
                can(PERMISSIONS.STUDENTS_READ) ? (
                  <Link to={`/estudiantes/${student.id}`} className="text-primary hover:underline">
                    {fullName(student)} ({student.documentType} {student.documentNumber})
                  </Link>
                ) : (
                  fullName(student)
                ),
              ],
              ['Fecha de matrícula', formatDate(enrollment.enrolledOn)],
              ['Fecha de finalización', formatDate(enrollment.endedOn)],
              [
                'Motivo del retiro',
                enrollment.withdrawalReason
                  ? WITHDRAWAL_REASON_LABELS[enrollment.withdrawalReason]
                  : null,
              ],
              ['Detalle', enrollment.endDetail],
              ['Renovada de otra matrícula', enrollment.previousEnrollmentId ? 'Sí' : 'No'],
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Historial de grupos</CardTitle>
        </CardHeader>
        {enrollment.placements.length === 0 ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">Aún no está ubicado en un grupo.</p>
          </CardContent>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Grupo</Th>
                <Th>Desde</Th>
                <Th>Hasta</Th>
                <Th>Motivo</Th>
              </tr>
            </THead>
            <TBody>
              {enrollment.placements.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.group.name}</Td>
                  <Td>{formatDate(p.fromDate)}</Td>
                  <Td>{p.toDate ? formatDate(p.toDate) : <Badge tone="success">Actual</Badge>}</Td>
                  <Td className="text-muted-foreground">{p.reason ?? '—'}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {editable && (
        <>
          <PlacementDialog
            key={`p-${action}`}
            enrollment={enrollment}
            open={action === 'placement'}
            onClose={() => setAction(null)}
          />
          <EndDialog
            key={`e-${action}`}
            enrollment={enrollment}
            kind={action === 'withdraw' || action === 'transfer' ? action : null}
            onClose={() => setAction(null)}
          />
        </>
      )}
    </div>
  );
}

import { PERMISSIONS } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Pencil, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { DetailList, FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { academicsService } from '@/features/academics/academics.service';
import { useAuth } from '@/features/auth/auth-context';
import { RELATIONSHIP_LABELS } from '@/features/people/people.service';
import { downloadFile, getErrorMessage } from '@/lib/api-client';
import { applyServerErrors } from '@/lib/forms';
import { formatDate, formatDateTime, fullName } from '@/lib/format';
import {
  type ActionDefinition,
  ADMISSION_DOCUMENT_LABELS,
  ADMISSION_DOCUMENT_TYPES,
  ADMISSION_STATUS_LABELS,
  ADMISSION_STATUS_TONES,
  type AdmissionDetail,
  type AdmissionDocumentType,
  admissionsService,
  availableActions,
  OPEN_ADMISSION_STATUSES,
} from '../admissions.service';
import { AdmissionFields } from '../components/admission-form';
import { toAdmissionInput, useAdmissionForm } from '../components/admission-form.schema';

function useAdmissionMutation<T>(
  id: string,
  fn: (input: T) => Promise<AdmissionDetail>,
  success: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (admission) => {
      queryClient.setQueryData(['admissions', 'detail', id], admission);
      await queryClient.invalidateQueries({ queryKey: ['admissions'] });
      toast.success(success);
    },
  });
}

function TransitionDialog({
  admission,
  action,
  onClose,
}: {
  admission: AdmissionDetail;
  action: ActionDefinition | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useAdmissionMutation(
    admission.id,
    () =>
      admissionsService.transition(
        admission.id,
        action!.action as Exclude<ActionDefinition['action'], 'enroll'>,
        note.trim() || undefined,
      ),
    'Solicitud actualizada.',
  );
  const required = action?.action === 'reject';
  return (
    <FormDialog
      open={action !== null}
      onOpenChange={(o) => !o && onClose()}
      title={action?.label ?? ''}
      description={`Solicitud ${admission.code}: ${fullName(admission.applicant)}. El cambio queda en el historial.`}
      submitLabel={action?.label ?? ''}
      danger={action?.tone === 'danger'}
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (required && note.trim().length < 5)
          return setError('Indica el motivo del rechazo (al menos 5 caracteres).');
        mutation.mutate(undefined, {
          onSuccess: onClose,
          onError: (e) => setError(getErrorMessage(e)),
        });
      }}
    >
      <Field label={required ? 'Motivo' : 'Nota'} required={required}>
        {(c) => (
          <Textarea
            {...c}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

function EnrollAdmittedDialog({
  admission,
  open,
  onClose,
}: {
  admission: AdmissionDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { data: groups = [] } = useQuery({
    queryKey: ['school-groups', { academicYearId: admission.academicYear.id }],
    queryFn: ({ signal }) =>
      academicsService.groups({ academicYearId: admission.academicYear.id }, signal),
    enabled: open,
  });
  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const mutation = useAdmissionMutation(
    admission.id,
    () =>
      admissionsService.enroll(admission.id, {
        schoolGroupId: groupId || undefined,
        enrolledOn: date || undefined,
      }),
    'Aspirante matriculado.',
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Matricular al admitido"
      description="Se registra el estudiante (o se reutiliza si ya existía), se vincula su acudiente y se crea la matrícula. Si algo falla, no se guarda nada."
      submitLabel="Matricular"
      pending={mutation.isPending}
      error={error}
      onSubmit={() =>
        mutation.mutate(undefined, {
          onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['students'] });
            await queryClient.invalidateQueries({ queryKey: ['enrollments'] });
            onClose();
          },
          onError: (e) => setError(getErrorMessage(e)),
        })
      }
    >
      <Field label="Grupo" hint="Opcional: se puede ubicar después.">
        {(c) => (
          <Select {...c} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Sin grupo por ahora</option>
            {groups
              .filter((g) => g.gradeId === admission.grade.id && g.status === 'ACTIVE')
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.campusName} · {g.shiftName}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Fecha de matrícula" hint="Por defecto, hoy.">
        {(c) => <Input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function EditDialog({
  admission,
  open,
  onClose,
}: {
  admission: AdmissionDetail;
  open: boolean;
  onClose: () => void;
}) {
  const form = useAdmissionForm(admission);
  const [error, setError] = useState<string | null>(null);
  const mutation = useAdmissionMutation(
    admission.id,
    () => {
      const { academicYearId: _year, ...input } = toAdmissionInput(form.getValues());
      return admissionsService.update(admission.id, input);
    },
    'Solicitud actualizada.',
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Editar ${admission.code}`}
      className="max-w-3xl"
      submitLabel="Guardar"
      pending={mutation.isPending}
      error={error}
      onSubmit={form.handleSubmit(() =>
        mutation.mutate(undefined, {
          onSuccess: onClose,
          onError: (e) =>
            setError(
              applyServerErrors(e, form.setError, [
                'gradeId',
                'applicant',
                'guardian',
                'previousSchool',
                'notes',
              ]),
            ),
        }),
      )}
    >
      <AdmissionFields form={form} yearLocked />
    </FormDialog>
  );
}

function DocumentsCard({
  admission,
  canManage,
}: {
  admission: AdmissionDetail;
  canManage: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<AdmissionDocumentType>('BIRTH_CERTIFICATE');
  const upload = useAdmissionMutation(
    admission.id,
    (file: File) => admissionsService.addDocument(admission.id, type, file),
    'Documento adjuntado.',
  );
  const remove = useAdmissionMutation(
    admission.id,
    (documentId: string) => admissionsService.removeDocument(admission.id, documentId),
    'Documento retirado.',
  );
  const editable = canManage && OPEN_ADMISSION_STATUSES.includes(admission.status);
  const onError = { onError: (e: unknown) => toast.error(getErrorMessage(e)) };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos</CardTitle>
        <CardDescription>
          PDF, PNG o JPEG de hasta 5 MB. Se guardan como datos personales.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editable && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              aria-label="Tipo de documento"
              className="sm:w-72"
              value={type}
              onChange={(e) => setType(e.target.value as AdmissionDocumentType)}
            >
              {ADMISSION_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ADMISSION_DOCUMENT_LABELS[t]}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <Upload aria-hidden /> Adjuntar
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) upload.mutate(file, onError);
              }}
            />
          </div>
        )}
        {admission.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin documentos.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {admission.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{ADMISSION_DOCUMENT_LABELS[d.documentType]}</p>
                  <p className="text-muted-foreground">
                    {d.fileName} · {Math.ceil(d.sizeBytes / 1024)} KB ·{' '}
                    {formatDateTime(d.uploadedAt)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Descargar ${d.fileName}`}
                    onClick={() =>
                      void downloadFile(
                        `/admissions/${admission.id}/documents/${d.id}/file`,
                        d.fileName,
                      ).catch((e: unknown) => toast.error(getErrorMessage(e)))
                    }
                  >
                    <Download aria-hidden />
                  </Button>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Retirar ${d.fileName}`}
                      onClick={() => remove.mutate(d.id, onError)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AdmissionDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [action, setAction] = useState<ActionDefinition | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [editing, setEditing] = useState(false);
  const {
    data: admission,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admissions', 'detail', id],
    queryFn: ({ signal }) => admissionsService.get(id, signal),
  });
  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const canManage = can(PERMISSIONS.ADMISSIONS_MANAGE);
  const allowed: Record<ActionDefinition['kind'], boolean> = {
    manage: canManage,
    decide: can(PERMISSIONS.ADMISSIONS_DECIDE),
    enroll:
      canManage &&
      can(PERMISSIONS.STUDENTS_MANAGE) &&
      can(PERMISSIONS.GUARDIANS_MANAGE) &&
      can(PERMISSIONS.ENROLLMENTS_MANAGE),
  };
  const actions = availableActions(admission.status).filter((a) => allowed[a.kind]);
  const { applicant, guardian } = admission;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        to="/admisiones"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Admisiones
      </Link>
      <PageHeader
        title={`${admission.code} · ${fullName(applicant)}`}
        description={`${admission.grade.name} · ${admission.academicYear.name}`}
        actions={
          <>
            <Badge tone={ADMISSION_STATUS_TONES[admission.status]}>
              {ADMISSION_STATUS_LABELS[admission.status]}
            </Badge>
            {canManage && OPEN_ADMISSION_STATUSES.includes(admission.status) && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Editar
              </Button>
            )}
            {actions.map((a) => (
              <Button
                key={a.action}
                variant={a.tone === 'danger' ? 'outline' : 'default'}
                className={a.tone === 'danger' ? 'text-danger' : undefined}
                onClick={() => (a.action === 'enroll' ? setEnrolling(true) : setAction(a))}
              >
                {a.label}
              </Button>
            ))}
          </>
        }
      />
      {admission.status === 'ENROLLED' && admission.studentId && (
        <Card>
          <CardContent className="flex flex-wrap gap-3 pt-5 text-sm">
            <span>El aspirante fue matriculado.</span>
            <Link
              to={`/estudiantes/${admission.studentId}`}
              className="text-primary hover:underline"
            >
              Ver estudiante
            </Link>
            {admission.enrollmentId && (
              <Link
                to={`/matriculas/${admission.enrollmentId}`}
                className="text-primary hover:underline"
              >
                Ver matrícula
              </Link>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Datos de la solicitud</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <DetailList
            items={[
              [
                'Aspirante',
                `${fullName(applicant)} (${applicant.documentType} ${applicant.documentNumber})`,
              ],
              ['Fecha de nacimiento', formatDate(applicant.birthDate)],
              ['Institución de procedencia', admission.previousSchool],
              [
                'Acudiente',
                guardian
                  ? `${fullName(guardian)} (${RELATIONSHIP_LABELS[guardian.relationship]}) · ${guardian.documentType} ${guardian.documentNumber}`
                  : null,
              ],
              [
                'Contacto del acudiente',
                guardian
                  ? [guardian.phone, guardian.email].filter(Boolean).join(' · ') || null
                  : null,
              ],
              ['Enviada', formatDateTime(admission.submittedAt)],
              [
                'Decisión',
                admission.decidedAt
                  ? `${formatDateTime(admission.decidedAt)}${admission.decisionNote ? ` — ${admission.decisionNote}` : ''}`
                  : null,
              ],
              ['Observaciones', admission.notes],
            ]}
          />
        </CardContent>
      </Card>
      <DocumentsCard admission={admission} canManage={canManage} />
      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3 border-l pl-4 text-sm">
            {admission.history.map((h, i) => (
              <li key={i}>
                <p className="font-medium">
                  {h.from ? `${ADMISSION_STATUS_LABELS[h.from]} → ` : ''}
                  {ADMISSION_STATUS_LABELS[h.to]}
                </p>
                <p className="text-muted-foreground">{formatDateTime(h.changedAt)}</p>
                {h.note && <p>{h.note}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <TransitionDialog
        key={action?.action ?? 'none'}
        admission={admission}
        action={action}
        onClose={() => setAction(null)}
      />
      {allowed.enroll && (
        <EnrollAdmittedDialog
          admission={admission}
          open={enrolling}
          onClose={() => setEnrolling(false)}
        />
      )}
      {editing && <EditDialog admission={admission} open onClose={() => setEditing(false)} />}
    </div>
  );
}

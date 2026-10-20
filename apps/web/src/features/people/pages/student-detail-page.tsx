import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Pencil, Plus, Star, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { DetailList, FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-context';
import { EnrollDialog } from '@/features/enrollments/components/enroll-dialog';
import {
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUS_TONES,
  enrollmentsService,
} from '@/features/enrollments/enrollments.service';
import { ConsentList } from '@/features/privacy/components/consent-list';
import { RecordConsentDialog } from '@/features/privacy/components/record-consent-dialog';
import { privacyService } from '@/features/privacy/privacy.service';
import { getErrorMessage } from '@/lib/api-client';
import { applyServerErrors, emailField } from '@/lib/forms';
import { formatDate, fullName } from '@/lib/format';
import { PersonFields } from '../components/person-fields';
import {
  emptyPerson,
  personSchema,
  personToValues,
  valuesToPerson,
} from '../components/person-form';
import {
  accessGrantedMessage,
  GUARDIAN_RELATIONSHIPS,
  type GuardianLink,
  peopleService,
  RELATIONSHIP_LABELS,
  STUDENT_STATUS_LABELS,
  STUDENT_STATUS_TONES,
  STUDENT_STATUSES,
  type Student,
} from '../people.service';

function useStudentMutation<T>(fn: (input: T) => Promise<Student>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (student) => {
      queryClient.setQueryData(['students', 'detail', student.id], student);
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(success);
    },
  });
}

// --- Datos -------------------------------------------------------------------

const editSchema = z.object({
  person: personSchema,
  code: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[A-Za-z0-9-]{1,30}$/.test(v),
      'Hasta 30 letras, números o guiones.',
    ),
  status: z.enum(STUDENT_STATUSES),
});
type EditValues = z.infer<typeof editSchema>;

function EditStudentDialog({
  student,
  open,
  onOpenChange,
}: {
  student: Student;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: {
      person: personToValues(student.person),
      code: student.code ?? '',
      status: student.status,
    },
  });
  const mutation = useStudentMutation(
    (v: EditValues) =>
      peopleService.updateStudent(student.id, {
        person: valuesToPerson(v.person),
        code: v.code || null,
        status: v.status,
      }),
    'Datos actualizados.',
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
      title="Editar estudiante"
      className="max-w-2xl"
      submitLabel="Guardar"
      pending={mutation.isPending}
      error={error}
      onSubmit={form.handleSubmit((v) =>
        mutation.mutate(v, {
          onSuccess: () => onOpenChange(false),
          onError: (e) =>
            setError(applyServerErrors(e, form.setError, ['person', 'code', 'status'])),
        }),
      )}
    >
      <PersonFields form={form} prefix="person" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código institucional" error={form.formState.errors.code?.message}>
          {(c) => <Input {...c} {...form.register('code')} />}
        </Field>
        <Field label="Estado" hint="Retirar o trasladar se hace desde la matrícula.">
          {(c) => (
            <Select {...c} {...form.register('status')}>
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STUDENT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

// --- Acudientes --------------------------------------------------------------

const linkSchema = z.object({
  guardian: personSchema,
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
  isLegalRepresentative: z.boolean(),
  livesWithStudent: z.boolean(),
  isPrimary: z.boolean(),
});
type LinkValues = z.infer<typeof linkSchema>;

function LinkGuardianDialog({
  student,
  open,
  onOpenChange,
}: {
  student: Student;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const defaults: LinkValues = {
    guardian: emptyPerson('CC'),
    relationship: 'MOTHER',
    isLegalRepresentative: true,
    livesWithStudent: true,
    isPrimary: student.guardians.length === 0,
  };
  const form = useForm<LinkValues>({ resolver: zodResolver(linkSchema), defaultValues: defaults });
  const mutation = useStudentMutation(
    (v: LinkValues) =>
      peopleService.linkGuardian(student.id, {
        person: valuesToPerson(v.guardian),
        relationship: v.relationship,
        isLegalRepresentative: v.isLegalRepresentative,
        livesWithStudent: v.livesWithStudent,
        isPrimary: v.isPrimary,
      }),
    'Acudiente vinculado.',
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          form.reset(defaults);
        }
        onOpenChange(o);
      }}
      title="Vincular acudiente"
      description="Si la persona ya existe en la institución (por ejemplo, es docente), se reutiliza."
      className="max-w-2xl"
      submitLabel="Vincular"
      pending={mutation.isPending}
      error={error}
      onSubmit={form.handleSubmit((v) =>
        mutation.mutate(v, {
          onSuccess: () => {
            form.reset(defaults);
            onOpenChange(false);
          },
          onError: (e) => setError(applyServerErrors(e, form.setError, ['relationship'])),
        }),
      )}
    >
      <PersonFields form={form} prefix="guardian" compact withBirthDate={false} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parentesco" required>
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
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox {...form.register('isLegalRepresentative')} /> Es representante legal (autoriza
          el tratamiento de datos)
        </label>
        <label className="flex items-center gap-2">
          <Checkbox {...form.register('livesWithStudent')} /> Vive con el estudiante
        </label>
        <label className="flex items-center gap-2">
          <Checkbox {...form.register('isPrimary')} disabled={student.guardians.length === 0} />{' '}
          Acudiente principal
        </label>
      </div>
    </FormDialog>
  );
}

function GuardiansCard({ student, canManage }: { student: Student; canManage: boolean }) {
  const [linking, setLinking] = useState(false);
  const update = useStudentMutation(
    ({
      guardianId,
      ...flags
    }: { guardianId: string } & Partial<
      Pick<GuardianLink, 'isPrimary' | 'isLegalRepresentative'>
    >) => peopleService.updateLink(student.id, guardianId, flags),
    'Acudiente actualizado.',
  );
  const unlink = useStudentMutation(
    (guardianId: string) => peopleService.unlink(student.id, guardianId),
    'Acudiente desvinculado.',
  );
  const onError = { onError: (e: unknown) => toast.error(getErrorMessage(e)) };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Acudientes</CardTitle>
          <CardDescription>
            El representante legal autoriza el tratamiento de los datos del menor.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setLinking(true)}>
            <Plus aria-hidden /> Vincular
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {student.guardians.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin acudientes vinculados.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {student.guardians.map((g) => (
              <li
                key={g.guardianId}
                className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {fullName(g.person)}{' '}
                    <span className="font-normal text-muted-foreground">
                      · {RELATIONSHIP_LABELS[g.relationship]}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {g.person.documentType} {g.person.documentNumber}
                    {g.person.phone && ` · ${g.person.phone}`}
                    {g.person.email && ` · ${g.person.email}`}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.isPrimary && <Badge tone="primary">Principal</Badge>}
                    {g.isLegalRepresentative && <Badge tone="success">Representante legal</Badge>}
                    {g.livesWithStudent && <Badge>Vive con el estudiante</Badge>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-1">
                    {!g.isPrimary && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          update.mutate({ guardianId: g.guardianId, isPrimary: true }, onError)
                        }
                      >
                        <Star aria-hidden /> Hacer principal
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update.mutate(
                          {
                            guardianId: g.guardianId,
                            isLegalRepresentative: !g.isLegalRepresentative,
                          },
                          onError,
                        )
                      }
                    >
                      {g.isLegalRepresentative
                        ? 'Quitar representante legal'
                        : 'Marcar representante legal'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => unlink.mutate(g.guardianId, onError)}
                    >
                      <UserMinus aria-hidden /> Desvincular
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {canManage && (
        <LinkGuardianDialog student={student} open={linking} onOpenChange={setLinking} />
      )}
    </Card>
  );
}

// --- Matrículas y autorizaciones -----------------------------------------------

function EnrollmentsCard({ student, canManage }: { student: Student; canManage: boolean }) {
  const [enrolling, setEnrolling] = useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: ['enrollments', { studentId: student.id }],
    queryFn: ({ signal }) =>
      enrollmentsService.list({ studentId: student.id, page: 1, pageSize: 50 }, signal),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Matrículas</CardTitle>
          <CardDescription>Historial por año lectivo.</CardDescription>
        </div>
        {canManage && student.status !== 'GRADUATED' && (
          <Button size="sm" onClick={() => setEnrolling(true)}>
            <Plus aria-hidden /> Matricular
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <p className="text-sm text-danger">{getErrorMessage(error)}</p>
        ) : data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin matrículas.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {data.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link
                  to={`/matriculas/${e.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {e.academicYear.name} · {e.grade.name}
                  {e.currentGroup && ` · ${e.currentGroup.name}`}
                </Link>
                <Badge tone={ENROLLMENT_STATUS_TONES[e.status]}>
                  {ENROLLMENT_STATUS_LABELS[e.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {canManage && (
        <EnrollDialog
          open={enrolling}
          onOpenChange={setEnrolling}
          student={{ id: student.id, name: fullName(student.person) }}
        />
      )}
    </Card>
  );
}

function ConsentsCard({ student, canManage }: { student: Student; canManage: boolean }) {
  const [recording, setRecording] = useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: ['data-consents', { studentId: student.id }],
    queryFn: ({ signal }) =>
      privacyService.consents({ studentId: student.id, pageSize: 50, page: 1 }, signal),
  });
  const hasActive = data?.data.some((c) => c.status === 'ACTIVE');
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Autorización de tratamiento de datos</CardTitle>
          <CardDescription>Ley 1581 de 2012.</CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setRecording(true)}>
            <Plus aria-hidden /> Registrar
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <p className="text-sm text-danger">{getErrorMessage(error)}</p>
        ) : data.data.length === 0 ? (
          <p className="text-sm text-warning">Sin autorizaciones registradas.</p>
        ) : (
          <>
            {!hasActive && (
              <p className="mb-2 text-sm text-warning">No tiene una autorización vigente.</p>
            )}
            <ConsentList consents={data.data} canManage={canManage} />
          </>
        )}
      </CardContent>
      {canManage && (
        <RecordConsentDialog open={recording} onOpenChange={setRecording} student={student} />
      )}
    </Card>
  );
}

function AccessDialog({
  student,
  open,
  onOpenChange,
}: {
  student: Student;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [email, setEmail] = useState(student.person.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (value: string) => peopleService.studentAccess(student.id, value),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      const { tone, text } = accessGrantedMessage(result);
      toast[tone](text, { duration: tone === 'warning' ? 10_000 : undefined });
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Dar acceso al portal"
      description="Se crea una cuenta con el rol Estudiante y se envía un correo para activarla."
      submitLabel="Dar acceso"
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        const parsed = emailField.safeParse(email);
        if (!parsed.success) return setError('Ingresa un correo electrónico válido.');
        mutation.mutate(parsed.data, {
          onSuccess: () => onOpenChange(false),
          onError: (e) => setError(getErrorMessage(e)),
        });
      }}
    >
      <Field label="Correo de acceso" required>
        {(c) => (
          <Input {...c} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </Field>
    </FormDialog>
  );
}

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [granting, setGranting] = useState(false);
  const {
    data: student,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['students', 'detail', id],
    queryFn: ({ signal }) => peopleService.student(id, signal),
  });
  const canManage = can(PERMISSIONS.STUDENTS_MANAGE);
  const canGrant =
    canManage && can(PERMISSIONS.USERS_CREATE) && can(PERMISSIONS.USERS_ROLES_ASSIGN);

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!student) return <EmptyState title="El estudiante no existe" />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        to="/estudiantes"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Estudiantes
      </Link>
      <PageHeader
        title={fullName(student.person)}
        description={`${student.person.documentType} ${student.person.documentNumber}${student.code ? ` · Código ${student.code}` : ''}`}
        actions={
          <>
            <Badge tone={STUDENT_STATUS_TONES[student.status]}>
              {STUDENT_STATUS_LABELS[student.status]}
            </Badge>
            {canGrant && !student.person.hasAccess && (
              <Button variant="outline" onClick={() => setGranting(true)}>
                <KeyRound aria-hidden /> Dar acceso
              </Button>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Editar
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              ['Fecha de nacimiento', formatDate(student.person.birthDate)],
              ['Teléfono', student.person.phone],
              ['Correo de contacto', student.person.email],
              ['Dirección', student.person.address],
              ['Acceso al portal', student.person.hasAccess ? 'Sí' : 'No'],
              ['Registrado', formatDate(student.createdAt)],
            ]}
          />
        </CardContent>
      </Card>
      <GuardiansCard student={student} canManage={canManage && can(PERMISSIONS.GUARDIANS_MANAGE)} />
      {can(PERMISSIONS.ENROLLMENTS_READ) && (
        <EnrollmentsCard student={student} canManage={can(PERMISSIONS.ENROLLMENTS_MANAGE)} />
      )}
      {can(PERMISSIONS.PRIVACY_CONSENTS_READ) && (
        <ConsentsCard student={student} canManage={can(PERMISSIONS.PRIVACY_CONSENTS_MANAGE)} />
      )}
      {canManage && (
        <EditStudentDialog student={student} open={editing} onOpenChange={setEditing} />
      )}
      {canGrant && <AccessDialog student={student} open={granting} onOpenChange={setGranting} />}
    </div>
  );
}

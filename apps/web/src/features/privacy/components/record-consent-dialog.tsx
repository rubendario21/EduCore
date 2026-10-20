import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Alert } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { RELATIONSHIP_LABELS, type Student } from '@/features/people/people.service';
import { ApiError, getErrorMessage } from '@/lib/api-client';
import { fullName } from '@/lib/format';
import {
  CONSENT_METHOD_LABELS,
  CONSENT_METHODS,
  type ConsentMethod,
  privacyService,
} from '../privacy.service';

const todayLocal = () => new Date().toLocaleDateString('en-CA');

/**
 * Registra la autorización de tratamiento de datos de un estudiante sobre la
 * versión vigente de la política. Puede autorizar un acudiente marcado como
 * representante legal, o el propio estudiante si es mayor de edad (la API lo
 * verifica con la fecha de nacimiento).
 */
export function RecordConsentDialog({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
}) {
  const queryClient = useQueryClient();
  const {
    data: policy,
    error: policyError,
    isPending,
  } = useQuery({
    queryKey: ['data-policies', 'current'],
    queryFn: ({ signal }) => privacyService.currentPolicy(signal),
    enabled: open,
    retry: false,
  });
  const representatives = student.guardians.filter((g) => g.isLegalRepresentative);
  const [authorizer, setAuthorizer] = useState('');
  const [method, setMethod] = useState<ConsentMethod>('WRITTEN');
  const [consentedOn, setConsentedOn] = useState(todayLocal());
  const [decisions, setDecisions] = useState<Record<string, boolean | undefined>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAuthorizer('');
    setMethod('WRITTEN');
    setConsentedOn(todayLocal());
    setDecisions({});
    setNotes('');
    setError(null);
  };

  const mutation = useMutation({
    mutationFn: () =>
      privacyService.recordConsent({
        studentId: student.id,
        policyId: policy!.id,
        authorizerPersonId: authorizer,
        method,
        consentedOn,
        decisions: policy!.purposes.map((p) => ({ purposeId: p.id, granted: decisions[p.id]! })),
        notes: notes.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['data-consents'] });
      toast.success('Autorización registrada.');
      reset();
      onOpenChange(false);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const noPolicy = policyError instanceof ApiError && policyError.code === 'NO_CURRENT_POLICY';
  const validate = () => {
    if (!authorizer) return 'Selecciona quién autoriza.';
    if (policy && policy.purposes.some((p) => decisions[p.id] === undefined))
      return 'Indica la decisión sobre cada finalidad.';
    return null;
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Registrar autorización de datos"
      description={`Estudiante: ${fullName(student.person)}`}
      className="max-w-2xl"
      submitLabel="Registrar autorización"
      pending={mutation.isPending}
      submitDisabled={!policy}
      error={error}
      onSubmit={() => {
        const problem = validate();
        if (problem) return setError(problem);
        setError(null);
        mutation.mutate();
      }}
    >
      {isPending ? null : noPolicy ? (
        <Alert tone="warning">
          No hay una política de tratamiento de datos publicada y vigente. Publícala primero en
          Protección de datos.
        </Alert>
      ) : policyError ? (
        <Alert>{getErrorMessage(policyError)}</Alert>
      ) : policy ? (
        <>
          <p className="text-sm text-muted-foreground">
            Política vigente: <span className="font-medium text-foreground">{policy.title}</span>{' '}
            (versión {policy.version}).
          </p>
          {representatives.length === 0 && (
            <Alert tone="warning">
              El estudiante no tiene un acudiente marcado como representante legal. Márcalo en la
              sección de acudientes, salvo que el estudiante sea mayor de edad.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quién autoriza" required>
              {(c) => (
                <Select {...c} value={authorizer} onChange={(e) => setAuthorizer(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {representatives.map((g) => (
                    <option key={g.guardianId} value={g.person.id}>
                      {fullName(g.person)} ({RELATIONSHIP_LABELS[g.relationship]}, representante
                      legal)
                    </option>
                  ))}
                  <option value={student.person.id}>El propio estudiante (mayor de edad)</option>
                </Select>
              )}
            </Field>
            <Field label="Medio" required>
              {(c) => (
                <Select
                  {...c}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as ConsentMethod)}
                >
                  {CONSENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {CONSENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Fecha en que se otorgó" required>
              {(c) => (
                <Input
                  {...c}
                  type="date"
                  max={todayLocal()}
                  value={consentedOn}
                  onChange={(e) => setConsentedOn(e.target.value)}
                />
              )}
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              Decisión por finalidad <span className="text-danger">*</span>
            </legend>
            {policy.purposes.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <p className="font-medium">
                    {p.name}
                    {p.required && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (necesaria para el servicio)
                      </span>
                    )}
                  </p>
                  {p.description && (
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  )}
                </div>
                <Select
                  aria-label={`Decisión: ${p.name}`}
                  className="sm:w-40"
                  value={decisions[p.id] === undefined ? '' : decisions[p.id] ? 'yes' : 'no'}
                  onChange={(e) =>
                    setDecisions((d) => ({
                      ...d,
                      [p.id]: e.target.value === '' ? undefined : e.target.value === 'yes',
                    }))
                  }
                >
                  <option value="">Selecciona…</option>
                  <option value="yes">Autoriza</option>
                  <option value="no">No autoriza</option>
                </Select>
              </div>
            ))}
          </fieldset>
          <Field label="Observaciones">
            {(c) => (
              <Textarea
                {...c}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </>
      ) : null}
    </FormDialog>
  );
}

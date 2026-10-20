import { isOnScale } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { academicsService, PERIOD_STATUS_LABELS } from '@/features/academics/academics.service';
import { formatScore } from '@/features/grading/grading.service';
import { ApiError, getErrorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type Gradebook, type GradebookKey, gradebookService } from '../gradebook.service';

/** Clave de una celda editada: actividad + matrícula. */
const cellKey = (assessmentId: string, enrollmentId: string) => `${assessmentId}|${enrollmentId}`;

function NewAssessmentDialog({
  book,
  open,
  onClose,
}: {
  book: Gradebook;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [componentId, setComponentId] = useState(book.scheme.components[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      gradebookService.createAssessment({
        schoolGroupId: book.group.id,
        subjectId: book.subject.id,
        periodId: book.period.id,
        componentId,
        title: title.trim(),
        dueOn: dueOn || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      toast.success('Actividad creada.');
      setTitle('');
      setDueOn('');
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Nueva actividad evaluativa"
      submitLabel="Crear"
      pending={mutation.isPending}
      error={error}
      onSubmit={() => {
        if (title.trim().length < 2) return setError('Escribe el título de la actividad.');
        setError(null);
        mutation.mutate();
      }}
    >
      <Field label="Componente" required>
        {(c) => (
          <Select {...c} value={componentId} onChange={(e) => setComponentId(e.target.value)}>
            {book.scheme.components.map((comp) => (
              <option key={comp.id} value={comp.id}>
                {comp.name} ({comp.weightPercent} %)
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Título" required>
        {(c) => (
          <Input {...c} maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />
        )}
      </Field>
      <Field label="Fecha">
        {(c) => (
          <Input {...c} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        )}
      </Field>
    </FormDialog>
  );
}

function HistoryDialog({
  target,
  decimals,
  onClose,
}: {
  target: { assessmentId: string; enrollmentId: string; label: string } | null;
  decimals: number;
  onClose: () => void;
}) {
  const { data, isPending } = useQuery({
    queryKey: ['gradebook', 'history', target?.assessmentId, target?.enrollmentId],
    queryFn: () => gradebookService.history(target!.assessmentId, target!.enrollmentId),
    enabled: target !== null,
  });
  const show = (v: number | null) => (v === null ? '—' : formatScore(v, decimals));
  return (
    <FormDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Historial de la nota"
      description={target?.label}
      submitLabel="Cerrar"
      pending={false}
      onSubmit={onClose}
    >
      {isPending ? (
        <LoadingState />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin cambios registrados.</p>
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {data.map((h, i) => (
            <li key={i}>
              <span className="font-medium">
                {show(h.previousScore)} → {show(h.newScore)}
              </span>{' '}
              <span className="text-muted-foreground">{formatDateTime(h.changedAt)}</span>
              {h.reason && <p className="text-muted-foreground">{h.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </FormDialog>
  );
}

/**
 * Planilla de notas de una asignatura en un grupo: actividades por componente,
 * notas editables (si el período está abierto y la persona puede registrar),
 * promedios por componente, nota parcial y nivel de desempeño.
 */
export function GradebookView({
  schoolGroupId,
  subjectId,
  academicYearId,
}: {
  schoolGroupId: string;
  subjectId: string;
  academicYearId: string;
}) {
  const queryClient = useQueryClient();
  const { data: year } = useQuery({
    queryKey: ['academic-years', academicYearId],
    queryFn: ({ signal }) => academicsService.year(academicYearId, signal),
  });
  const periods = year?.periods ?? [];
  const [periodId, setPeriodId] = useState('');
  const selected =
    periods.find((p) => p.id === periodId) ??
    periods.find((p) => p.status === 'OPEN') ??
    periods[periods.length - 1];
  const key: GradebookKey | null = selected
    ? { schoolGroupId, subjectId, periodId: selected.id }
    : null;
  const {
    data: book,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['gradebook', key],
    queryFn: ({ signal }) => gradebookService.get(key!, signal),
    enabled: key !== null,
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(false);
  const [historyOf, setHistoryOf] = useState<{
    assessmentId: string;
    enrollmentId: string;
    label: string;
  } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      // Una petición por actividad con sus notas cambiadas (cada una es todo o nada).
      const byAssessment = new Map<string, Array<{ enrollmentId: string; score: number | null }>>();
      for (const [k, value] of Object.entries(draft)) {
        const [assessmentId, enrollmentId] = k.split('|') as [string, string];
        const score = value.trim() === '' ? null : Number(value.replace(',', '.'));
        byAssessment.set(assessmentId, [
          ...(byAssessment.get(assessmentId) ?? []),
          { enrollmentId, score },
        ]);
      }
      let changed = 0;
      for (const [assessmentId, grades] of byAssessment) {
        changed += (
          await gradebookService.saveGrades(assessmentId, grades, reason.trim() || undefined)
        ).changed;
      }
      return changed;
    },
    onSuccess: async (changed) => {
      setDraft({});
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      toast.success(changed === 1 ? 'Se guardó 1 nota.' : `Se guardaron ${changed} notas.`);
    },
    onError: async (e) => {
      await queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      toast.error(
        e instanceof ApiError && e.fieldErrors.length > 0
          ? e.fieldErrors.flatMap((f) => f.messages).join(' ')
          : getErrorMessage(e),
      );
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => gradebookService.deleteAssessment(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['gradebook'] });
      toast.success('Actividad eliminada.');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (!year) return <LoadingState />;
  if (periods.length === 0) return <EmptyState title="El año lectivo no tiene períodos" />;

  const periodPicker = (
    <Select
      aria-label="Período"
      className="w-56"
      value={selected?.id ?? ''}
      onChange={(e) => {
        setPeriodId(e.target.value);
        setDraft({});
      }}
    >
      {periods.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {PERIOD_STATUS_LABELS[p.status]}
        </option>
      ))}
    </Select>
  );

  if (isPending) return <LoadingState />;
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        {periodPicker}
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  const { scheme } = book;
  const decimals = scheme.decimals;
  const show = (v: number | null) => (v === null ? '—' : formatScore(v, decimals));
  const invalidCells = Object.entries(draft).filter(([, v]) => {
    if (v.trim() === '') return false;
    return !isOnScale(Number(v.replace(',', '.')), scheme);
  });
  const dirty = Object.keys(draft).length;
  const columnsByComponent = scheme.components.map((c) => ({
    component: c,
    assessments: book.assessments.filter((a) => a.componentId === c.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {periodPicker}
        <span className="text-sm text-muted-foreground">
          Escala {formatScore(scheme.minScore, decimals)}–{formatScore(scheme.maxScore, decimals)} ·
          aprueba con {formatScore(scheme.passingScore, decimals)}
        </span>
        {book.canEdit && (
          <Button className="ml-auto" variant="outline" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Nueva actividad
          </Button>
        )}
      </div>
      {book.period.status !== 'OPEN' && (
        <Alert tone="info">El período no está abierto: la planilla es de solo lectura.</Alert>
      )}
      {book.students.length === 0 ? (
        <EmptyState title="El grupo no tiene estudiantes ubicados" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-surface-muted/40 text-xs">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium"
                >
                  Estudiante
                </th>
                {columnsByComponent.map(({ component, assessments }) => (
                  <th
                    key={component.id}
                    colSpan={assessments.length + 1}
                    className="border-l px-2 py-1 text-center font-medium"
                  >
                    {component.name} · {component.weightPercent} %
                  </th>
                ))}
                <th rowSpan={2} className="border-l px-2 py-2 font-medium">
                  Nota parcial
                </th>
              </tr>
              <tr className="border-b text-xs">
                {columnsByComponent.flatMap(({ component, assessments }) => [
                  ...assessments.map((a) => (
                    <th
                      key={a.id}
                      className="border-l px-2 py-1 text-left font-normal"
                      title={a.description ?? undefined}
                    >
                      <span className="flex items-center gap-1">
                        <span className="max-w-32 truncate">{a.title}</span>
                        {book.canEdit && a.gradedCount === 0 && (
                          <button
                            type="button"
                            aria-label={`Eliminar ${a.title}`}
                            className="text-muted-foreground hover:text-danger"
                            onClick={() => remove.mutate(a.id)}
                          >
                            <Trash2 className="size-3" aria-hidden />
                          </button>
                        )}
                      </span>
                    </th>
                  )),
                  <th
                    key={`${component.id}-avg`}
                    className="border-l bg-surface-muted/40 px-2 py-1 font-medium"
                  >
                    Prom.
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {book.students.map((st) => (
                <tr
                  key={st.enrollmentId}
                  className={cn('border-b', !st.inGroup && 'text-muted-foreground')}
                >
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 whitespace-nowrap">
                    {st.lastNames}, {st.firstNames}
                    {!st.inGroup && <span className="ml-1 text-xs">(ya no está en el grupo)</span>}
                  </td>
                  {columnsByComponent.flatMap(({ component, assessments }) => [
                    ...assessments.map((a) => {
                      const k = cellKey(a.id, st.enrollmentId);
                      const saved = st.grades[a.id] ?? null;
                      const value =
                        draft[k] ?? (saved === null ? '' : formatScore(saved, decimals));
                      const invalid = invalidCells.some(([key]) => key === k);
                      return (
                        <td key={a.id} className="border-l px-1 py-1">
                          {book.canEdit && st.inGroup ? (
                            <div className="flex items-center gap-0.5">
                              <Input
                                aria-label={`Nota de ${st.firstNames} en ${a.title}`}
                                inputMode="decimal"
                                aria-invalid={invalid || undefined}
                                className={cn(
                                  'h-8 w-16 px-2 text-center',
                                  k in draft && 'border-primary',
                                )}
                                value={value}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setDraft((d) => {
                                    const original =
                                      saved === null ? '' : formatScore(saved, decimals);
                                    const copy = { ...d };
                                    if (next === original) delete copy[k];
                                    else copy[k] = next;
                                    return copy;
                                  });
                                }}
                              />
                              {saved !== null && (
                                <button
                                  type="button"
                                  aria-label={`Historial de ${st.firstNames} en ${a.title}`}
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    setHistoryOf({
                                      assessmentId: a.id,
                                      enrollmentId: st.enrollmentId,
                                      label: `${st.firstNames} ${st.lastNames} · ${a.title}`,
                                    })
                                  }
                                >
                                  <History className="size-3" aria-hidden />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="block px-2 text-center">{show(saved)}</span>
                          )}
                        </td>
                      );
                    }),
                    <td
                      key={`${component.id}-avg`}
                      className="border-l bg-surface-muted/40 px-2 text-center tabular-nums"
                    >
                      {show(st.componentAverages[component.id] ?? null)}
                    </td>,
                  ])}
                  <td className="border-l px-2 text-center whitespace-nowrap">
                    <span className="font-semibold tabular-nums">{show(st.periodScore)}</span>{' '}
                    {st.level && (
                      <Badge tone={st.passing ? 'success' : 'danger'}>{st.level.name}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {book.canEdit && dirty > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-surface p-3">
          {invalidCells.length > 0 ? (
            <span className="text-sm text-danger">
              Hay {invalidCells.length} nota(s) fuera de la escala o con más de {decimals}{' '}
              decimal(es).
            </span>
          ) : (
            <span className="text-sm">{dirty} cambio(s) sin guardar.</span>
          )}
          <Input
            aria-label="Motivo del cambio"
            placeholder="Motivo (opcional, queda en el historial)"
            className="h-8 min-w-48 flex-1"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => setDraft({})}>
            Descartar
          </Button>
          <Button
            size="sm"
            disabled={invalidCells.length > 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            Guardar notas
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Nota parcial: promedio de las actividades de cada componente, ponderado por su peso. Si un
        componente aún no tiene notas, su peso se reparte entre los demás. Se redondea al final.
      </p>
      {book.canEdit && (
        <NewAssessmentDialog book={book} open={creating} onClose={() => setCreating(false)} />
      )}
      <HistoryDialog target={historyOf} decimals={decimals} onClose={() => setHistoryOf(null)} />
    </div>
  );
}

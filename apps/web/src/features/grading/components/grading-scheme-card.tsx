import {
  DECREE_1290_EXAMPLE,
  PROMOTION_UNITS,
  type PromotionUnit,
  ROUNDING_MODES,
  type RoundingMode,
  validateComponents,
  validateGradingScheme,
} from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DetailList } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { useAcademicYears } from '@/features/academics/academics.service';
import { ApiError, getErrorMessage } from '@/lib/api-client';
import {
  formatScore,
  type GradingScheme,
  type GradingSchemeInput,
  gradingService,
  PROMOTION_UNIT_LABELS,
  ROUNDING_LABELS,
} from '../grading.service';

/** Valores del formulario: todo como texto, para editar con libertad y validar al vuelo. */
interface Draft {
  minScore: string;
  maxScore: string;
  decimals: string;
  passingScore: string;
  rounding: RoundingMode;
  promotionUnit: PromotionUnit;
  maxFailedForPromotion: string;
  minAttendancePercent: string;
  notes: string;
  levels: Array<{ code: string; name: string; minScore: string; maxScore: string }>;
  components: Array<{ code: string; name: string; weightPercent: string }>;
}

const text = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);
const number = (value: string) => Number(value.trim().replace(',', '.'));

function toDraft(source: GradingSchemeInput): Draft {
  return {
    minScore: text(source.minScore),
    maxScore: text(source.maxScore),
    decimals: text(source.decimals),
    passingScore: text(source.passingScore),
    rounding: source.rounding,
    promotionUnit: source.promotionUnit,
    maxFailedForPromotion: text(source.maxFailedForPromotion),
    minAttendancePercent: text(source.minAttendancePercent),
    notes: source.notes ?? '',
    levels: source.levels.map((l) => ({
      code: l.code,
      name: l.name,
      minScore: text(l.minScore),
      maxScore: text(l.maxScore),
    })),
    components: source.components.map((c) => ({
      code: c.code,
      name: c.name,
      weightPercent: text(c.weightPercent),
    })),
  };
}

function fromDraft(d: Draft): GradingSchemeInput {
  return {
    minScore: number(d.minScore),
    maxScore: number(d.maxScore),
    decimals: number(d.decimals),
    passingScore: number(d.passingScore),
    rounding: d.rounding,
    promotionUnit: d.promotionUnit,
    maxFailedForPromotion:
      d.maxFailedForPromotion.trim() === '' ? null : number(d.maxFailedForPromotion),
    minAttendancePercent:
      d.minAttendancePercent.trim() === '' ? null : number(d.minAttendancePercent),
    notes: d.notes.trim() || null,
    levels: d.levels.map((l) => ({
      code: l.code.trim().toUpperCase(),
      name: l.name.trim(),
      minScore: number(l.minScore),
      maxScore: number(l.maxScore),
    })),
    components: d.components.map((c) => ({
      code: c.code.trim().toUpperCase(),
      name: c.name.trim(),
      weightPercent: number(c.weightPercent),
    })),
  };
}

const EXAMPLE: GradingSchemeInput = {
  ...DECREE_1290_EXAMPLE.scale,
  promotionUnit: 'AREA',
  maxFailedForPromotion: null,
  minAttendancePercent: null,
  notes: null,
  levels: DECREE_1290_EXAMPLE.levels,
  components: [{ code: 'GENERAL', name: 'General', weightPercent: 100 }],
};

function SchemeEditor({
  yearId,
  initial,
  onDone,
}: {
  yearId: string;
  initial: GradingSchemeInput | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(toDraft(initial ?? EXAMPLE));
  const [serverError, setServerError] = useState<string | null>(null);
  const input = fromDraft(draft);
  const problems = [
    ...validateGradingScheme(input, input.levels),
    ...validateComponents(input.components),
  ];
  const setComponent = (index: number, patch: Partial<Draft['components'][number]>) =>
    setDraft((d) => ({
      ...d,
      components: d.components.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  const totalWeight = input.components.reduce(
    (sum, c) => sum + (Number.isFinite(c.weightPercent) ? c.weightPercent : 0),
    0,
  );
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setLevel = (index: number, patch: Partial<Draft['levels'][number]>) =>
    setDraft((d) => ({
      ...d,
      levels: d.levels.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));

  const save = useMutation({
    mutationFn: () => gradingService.save(yearId, input),
    onSuccess: async (scheme) => {
      queryClient.setQueryData(['grading-scheme', yearId], scheme);
      toast.success('SIEE guardado.');
      onDone();
    },
    onError: (e) =>
      setServerError(
        e instanceof ApiError && e.fieldErrors.length > 0
          ? e.fieldErrors.flatMap((f) => f.messages).join(' ')
          : getErrorMessage(e),
      ),
  });

  return (
    <div className="flex flex-col gap-5">
      {!initial && (
        <Alert tone="info">
          Precargamos como ejemplo la escala 1,0–5,0 con los niveles del Decreto 1290. Ajústala a lo
          que define el SIEE de tu institución.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nota mínima" required>
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              value={draft.minScore}
              onChange={(e) => set({ minScore: e.target.value })}
            />
          )}
        </Field>
        <Field label="Nota máxima" required>
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              value={draft.maxScore}
              onChange={(e) => set({ maxScore: e.target.value })}
            />
          )}
        </Field>
        <Field label="Decimales" required>
          {(c) => (
            <Select
              {...c}
              value={draft.decimals}
              onChange={(e) => set({ decimals: e.target.value })}
            >
              <option value="0">Sin decimales</option>
              <option value="1">1 decimal</option>
              <option value="2">2 decimales</option>
            </Select>
          )}
        </Field>
        <Field label="Nota mínima para aprobar" required>
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              value={draft.passingScore}
              onChange={(e) => set({ passingScore: e.target.value })}
            />
          )}
        </Field>
        <Field label="Redondeo de promedios" className="sm:col-span-2">
          {(c) => (
            <Select
              {...c}
              value={draft.rounding}
              onChange={(e) => set({ rounding: e.target.value as RoundingMode })}
            >
              {ROUNDING_MODES.map((m) => (
                <option key={m} value={m}>
                  {ROUNDING_LABELS[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Niveles de desempeño</legend>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <THead>
              <tr>
                <Th>Código</Th>
                <Th>Nombre</Th>
                <Th>Desde</Th>
                <Th>Hasta</Th>
                <Th className="w-10" />
              </tr>
            </THead>
            <TBody>
              {draft.levels.map((level, index) => (
                <tr key={index}>
                  <Td>
                    <Input
                      aria-label="Código del nivel"
                      className="h-8 w-28"
                      value={level.code}
                      onChange={(e) => setLevel(index, { code: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      aria-label="Nombre del nivel"
                      className="h-8 min-w-40"
                      value={level.name}
                      onChange={(e) => setLevel(index, { name: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      aria-label="Desde"
                      inputMode="decimal"
                      className="h-8 w-20"
                      value={level.minScore}
                      onChange={(e) => setLevel(index, { minScore: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      aria-label="Hasta"
                      inputMode="decimal"
                      className="h-8 w-20"
                      value={level.maxScore}
                      onChange={(e) => setLevel(index, { maxScore: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar ${level.name || 'nivel'}`}
                      onClick={() =>
                        setDraft((d) => ({ ...d, levels: d.levels.filter((_, i) => i !== index) }))
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              levels: [...d.levels, { code: '', name: '', minScore: '', maxScore: '' }],
            }))
          }
        >
          <Plus aria-hidden /> Agregar nivel
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Componentes de la nota del período</legend>
        <p className="text-xs text-muted-foreground">
          Cada actividad evaluativa pertenece a un componente. La nota del período es el promedio de
          los componentes ponderado por su peso. Deben sumar 100 %.
        </p>
        <div className="flex flex-col gap-2">
          {draft.components.map((component, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Código del componente"
                className="h-8 w-32"
                value={component.code}
                onChange={(e) => setComponent(index, { code: e.target.value })}
              />
              <Input
                aria-label="Nombre del componente"
                className="h-8 min-w-40 flex-1"
                value={component.name}
                onChange={(e) => setComponent(index, { name: e.target.value })}
              />
              <Input
                aria-label="Peso (%)"
                inputMode="decimal"
                className="h-8 w-20"
                value={component.weightPercent}
                onChange={(e) => setComponent(index, { weightPercent: e.target.value })}
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${component.name || 'componente'}`}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    components: d.components.filter((_, i) => i !== index),
                  }))
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                components: [...d.components, { code: '', name: '', weightPercent: '' }],
              }))
            }
          >
            <Plus aria-hidden /> Agregar componente
          </Button>
          <span
            className={
              Math.abs(totalWeight - 100) < 0.001 ? 'text-sm text-success' : 'text-sm text-warning'
            }
          >
            Total: {String(Math.round(totalWeight * 100) / 100).replace('.', ',')} %
          </span>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold sm:col-span-3">Promoción</legend>
        <Field label="Se cuentan">
          {(c) => (
            <Select
              {...c}
              value={draft.promotionUnit}
              onChange={(e) => set({ promotionUnit: e.target.value as PromotionUnit })}
            >
              {PROMOTION_UNITS.map((u) => (
                <option key={u} value={u}>
                  {PROMOTION_UNIT_LABELS[u]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Máximo reprobadas para promover" hint="Vacío: sin esta regla.">
          {(c) => (
            <Input
              {...c}
              inputMode="numeric"
              value={draft.maxFailedForPromotion}
              onChange={(e) => set({ maxFailedForPromotion: e.target.value })}
            />
          )}
        </Field>
        <Field label="Asistencia mínima (%)" hint="Vacío: sin esta regla.">
          {(c) => (
            <Input
              {...c}
              inputMode="decimal"
              value={draft.minAttendancePercent}
              onChange={(e) => set({ minAttendancePercent: e.target.value })}
            />
          )}
        </Field>
        <Field label="Otros criterios del SIEE" className="sm:col-span-3">
          {(c) => (
            <Textarea
              {...c}
              maxLength={4000}
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          )}
        </Field>
      </fieldset>

      {problems.length > 0 && (
        <Alert tone="warning">
          <ul className="list-inside list-disc">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      {serverError && <Alert>{serverError}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setDraft(toDraft(EXAMPLE))}>
          Usar ejemplo del Decreto 1290
        </Button>
        {initial && (
          <Button variant="outline" onClick={onDone}>
            Cancelar
          </Button>
        )}
        <Button disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          Guardar SIEE
        </Button>
      </div>
    </div>
  );
}

function SchemeSummary({ scheme }: { scheme: GradingScheme }) {
  const d = scheme.decimals;
  return (
    <div className="flex flex-col gap-4">
      <DetailList
        items={[
          ['Escala', `${formatScore(scheme.minScore, d)} a ${formatScore(scheme.maxScore, d)}`],
          ['Nota mínima para aprobar', formatScore(scheme.passingScore, d)],
          ['Redondeo', ROUNDING_LABELS[scheme.rounding]],
          [
            'Promoción',
            scheme.maxFailedForPromotion === null
              ? 'Sin límite de reprobadas'
              : `Hasta ${scheme.maxFailedForPromotion} ${PROMOTION_UNIT_LABELS[scheme.promotionUnit].toLowerCase()} reprobada(s)`,
          ],
          [
            'Asistencia mínima',
            scheme.minAttendancePercent === null
              ? 'Sin esta regla'
              : `${scheme.minAttendancePercent} %`,
          ],
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {scheme.levels.map((l) => (
          <Badge key={l.code} tone={l.minScore >= scheme.passingScore ? 'success' : 'danger'}>
            {l.name}: {formatScore(l.minScore, d)} – {formatScore(l.maxScore, d)}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="text-muted-foreground">Componentes:</span>
        {scheme.components.map((c) => (
          <Badge key={c.code} tone="primary">
            {c.name} {String(c.weightPercent).replace('.', ',')} %
          </Badge>
        ))}
      </div>
      {scheme.notes && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{scheme.notes}</p>
      )}
    </div>
  );
}

/** SIEE del año: resumen, edición y copia desde otro año. */
export function GradingSchemeCard({ yearId, editable }: { yearId: string; editable: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState('');
  const { data: years = [] } = useAcademicYears();
  const {
    data: scheme,
    isPending,
    error,
  } = useQuery({
    queryKey: ['grading-scheme', yearId],
    queryFn: ({ signal }) => gradingService.get(yearId, signal),
    retry: false,
  });
  const notDefined = error instanceof ApiError && error.code === 'GRADING_SCHEME_NOT_DEFINED';
  const copy = useMutation({
    mutationFn: () => gradingService.copy(yearId, source),
    onSuccess: (copied) => {
      queryClient.setQueryData(['grading-scheme', yearId], copied);
      toast.success('SIEE copiado.');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>SIEE del año</CardTitle>
          <CardDescription>
            Escala de valoración, niveles de desempeño y reglas de promoción (Decreto 1290 de 2009).
            Los define la institución.
          </CardDescription>
        </div>
        {editable && scheme && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> Editar
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingState />
        ) : scheme && !editing ? (
          <SchemeSummary scheme={scheme} />
        ) : scheme && editing ? (
          <SchemeEditor yearId={yearId} initial={scheme} onDone={() => setEditing(false)} />
        ) : notDefined ? (
          editable ? (
            <div className="flex flex-col gap-4">
              {years.length > 1 && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Copiar de otro año" className="w-56">
                    {(c) => (
                      <Select {...c} value={source} onChange={(e) => setSource(e.target.value)}>
                        <option value="">Selecciona…</option>
                        {years
                          .filter((y) => y.id !== yearId)
                          .map((y) => (
                            <option key={y.id} value={y.id}>
                              {y.name}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                  <Button
                    variant="outline"
                    disabled={!source || copy.isPending}
                    onClick={() => copy.mutate()}
                  >
                    <Copy aria-hidden /> Copiar
                  </Button>
                </div>
              )}
              <SchemeEditor yearId={yearId} initial={null} onDone={() => undefined} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Este año aún no tiene SIEE configurado.</p>
          )
        ) : (
          <Alert>{getErrorMessage(error)}</Alert>
        )}
      </CardContent>
    </Card>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { type CurriculumEntry, teachingService } from '@/features/teaching/teaching.service';
import { getErrorMessage } from '@/lib/api-client';
import { academicsService, useAcademicYears } from '../academics.service';

function HoursCell({ entry, editable }: { entry: CurriculumEntry; editable: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(entry.weeklyHours));
  const mutation = useMutation({
    mutationFn: (hours: number) => teachingService.updateCurriculum(entry.id, hours),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] });
      toast.success('Intensidad horaria actualizada.');
    },
    onError: (e) => {
      setValue(String(entry.weeklyHours));
      toast.error(getErrorMessage(e));
    },
  });
  if (!editable) return <>{entry.weeklyHours}</>;
  const save = () => {
    const hours = Number(value);
    if (hours === entry.weeklyHours) return;
    if (!Number.isInteger(hours) || hours < 1 || hours > 40) {
      setValue(String(entry.weeklyHours));
      return toast.error('La intensidad debe ser un número entero de 1 a 40.');
    }
    mutation.mutate(hours);
  };
  return (
    <Input
      aria-label={`Horas semanales de ${entry.subject.name}`}
      type="number"
      min={1}
      max={40}
      className="h-8 w-20"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && save()}
    />
  );
}

/** Plan de estudios por año y grado: asignaturas e intensidad horaria semanal. */
export function CurriculumTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: years = [] } = useAcademicYears();
  const [yearId, setYearId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const year =
    years.find((y) => y.id === yearId) ?? years.find((y) => y.status === 'ACTIVE') ?? years[0];
  const { data: grades = [] } = useQuery({
    queryKey: ['grades'],
    queryFn: ({ signal }) => academicsService.grades(signal),
  });
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: ({ signal }) => academicsService.subjects(signal),
  });
  const grade = grades.find((g) => g.id === gradeId) ?? grades.find((g) => g.status === 'ACTIVE');
  const {
    data: entries,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['curriculum', { academicYearId: year?.id, gradeId: grade?.id }],
    queryFn: ({ signal }) =>
      teachingService.curriculum({ academicYearId: year!.id, gradeId: grade!.id }, signal),
    enabled: !!year && !!grade,
  });
  const editable = canManage && year?.status !== 'CLOSED';
  const remove = useMutation({
    mutationFn: (id: string) => teachingService.removeCurriculum(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] });
      toast.success('Asignatura retirada del plan.');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  // Agregar asignatura
  const [subjectId, setSubjectId] = useState('');
  const [hours, setHours] = useState('4');
  const [addError, setAddError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      teachingService.addCurriculum({
        academicYearId: year!.id,
        gradeId: grade!.id,
        subjectId,
        weeklyHours: Number(hours),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] });
      setSubjectId('');
      setAdding(false);
      toast.success('Asignatura agregada al plan.');
    },
    onError: (e) => setAddError(getErrorMessage(e)),
  });

  // Copiar de otro año
  const [sourceId, setSourceId] = useState('');
  const [copyError, setCopyError] = useState<string | null>(null);
  const copy = useMutation({
    mutationFn: () => teachingService.copyCurriculum(sourceId, year!.id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] });
      setCopying(false);
      toast.success(
        `Se copiaron ${result.created} asignatura(s); ${result.skipped} ya existían o están inactivas.`,
      );
    },
    onError: (e) => setCopyError(getErrorMessage(e)),
  });

  if (years.length === 0 || grades.length === 0) {
    return (
      <EmptyState
        title="Primero crea años lectivos y grados"
        description="El plan de estudios se define por año y grado."
      />
    );
  }
  const used = new Set(entries?.map((e) => e.subject.id));
  const available = subjects.filter((s) => s.status === 'ACTIVE' && !used.has(s.id));
  const total = entries?.reduce((sum, e) => sum + e.weeklyHours, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Año lectivo" className="w-48">
          {(c) => (
            <Select {...c} value={year?.id ?? ''} onChange={(e) => setYearId(e.target.value)}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Grado" className="w-48">
          {(c) => (
            <Select {...c} value={grade?.id ?? ''} onChange={(e) => setGradeId(e.target.value)}>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {editable && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setCopying(true)}>
              <Copy aria-hidden /> Copiar de otro año
            </Button>
            <Button onClick={() => setAdding(true)} disabled={available.length === 0}>
              <Plus aria-hidden /> Agregar asignatura
            </Button>
          </div>
        )}
      </div>
      <Card>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            title={`${grade?.name} no tiene asignaturas en ${year?.name}`}
            description="Agrégalas o copia el plan de otro año."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Área</Th>
                <Th>Asignatura</Th>
                <Th>Horas semanales</Th>
                {editable && <Th className="w-10" />}
              </tr>
            </THead>
            <TBody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="text-muted-foreground">{e.subject.area.name}</Td>
                  <Td className="font-medium">{e.subject.name}</Td>
                  <Td>
                    <HoursCell entry={e} editable={editable} />
                  </Td>
                  {editable && (
                    <Td>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Quitar ${e.subject.name}`}
                        onClick={() => remove.mutate(e.id)}
                        disabled={remove.isPending}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
              <tr className="bg-surface-muted/40 font-medium">
                <Td colSpan={2}>Total</Td>
                <Td colSpan={editable ? 2 : 1}>{total} horas</Td>
              </tr>
            </TBody>
          </Table>
        )}
      </Card>

      <FormDialog
        open={adding}
        onOpenChange={(o) => (setAdding(o), setAddError(null))}
        title={`Agregar asignatura a ${grade?.name ?? ''}`}
        submitLabel="Agregar"
        pending={add.isPending}
        error={addError}
        onSubmit={() => {
          if (!subjectId) return setAddError('Selecciona la asignatura.');
          add.mutate();
        }}
      >
        <Field label="Asignatura" required>
          {(c) => (
            <Select {...c} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Selecciona…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subjectAreaName} · {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Horas semanales" required>
          {(c) => (
            <Input
              {...c}
              type="number"
              min={1}
              max={40}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-28"
            />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={copying}
        onOpenChange={(o) => (setCopying(o), setCopyError(null))}
        title={`Copiar plan a ${year?.name ?? ''}`}
        description="Solo agrega lo que falta: no modifica ni duplica lo que ya existe."
        submitLabel="Copiar"
        pending={copy.isPending}
        error={copyError}
        onSubmit={() => {
          if (!sourceId) return setCopyError('Selecciona el año de origen.');
          copy.mutate();
        }}
      >
        <Field label="Copiar desde" required>
          {(c) => (
            <Select {...c} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Selecciona…</option>
              {years
                .filter((y) => y.id !== year?.id)
                .map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </FormDialog>
    </div>
  );
}

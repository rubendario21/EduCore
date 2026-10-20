import { PERMISSIONS } from '@educore/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck, Lock, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { CatalogManager } from '@/components/catalog-manager';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ErrorState, LoadingState } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/auth-context';
import { PeriodStatusCard } from '../components/period-status-card';
import { GradingSchemeCard } from '@/features/grading/components/grading-scheme-card';
import { ApiError, getErrorMessage } from '@/lib/api-client';
import { dateField, requiredText } from '@/lib/forms';
import { formatDate } from '@/lib/format';
import {
  type AcademicPeriod,
  type AcademicYear,
  academicsService,
  YEAR_STATUS_LABELS,
  YEAR_STATUS_TONES,
} from '../academics.service';

const periodSchema = z
  .object({
    number: z
      .string()
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 12, 'Número entre 1 y 12.'),
    name: requiredText('El nombre', 3, 100),
    startsOn: dateField('Inicio'),
    endsOn: dateField('Fin'),
    weightPercent: z
      .string()
      .refine(
        (v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 100,
        'Entre 0,01 y 100, hasta 2 decimales.',
      ),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    path: ['endsOn'],
    message: 'No puede ser anterior al inicio.',
  });
type PeriodForm = z.infer<typeof periodSchema>;

const toPeriodInput = (v: PeriodForm) => ({
  number: Number(v.number),
  name: v.name,
  startsOn: v.startsOn,
  endsOn: v.endsOn,
  weightPercent: Number(v.weightPercent),
});

function StatusActions({ year }: { year: AcademicYear }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<'activate' | 'close' | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: (action: 'activate' | 'close') =>
      action === 'activate'
        ? academicsService.activateYear(year.id)
        : academicsService.closeYear(year.id),
    onSuccess: async (_, action) => {
      await queryClient.invalidateQueries({ queryKey: ['academic-years'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setProblems([]);
      toast.success(action === 'activate' ? 'Año lectivo activado.' : 'Año lectivo cerrado.');
    },
    onError: (e) => {
      const details =
        e instanceof ApiError ? (e.details as { problems?: string[] } | undefined) : undefined;
      setProblems(details?.problems ?? [getErrorMessage(e)]);
    },
    onSettled: () => setConfirm(null),
  });

  return (
    <>
      {year.status === 'PLANNING' && (
        <Button onClick={() => setConfirm('activate')}>
          <Play aria-hidden /> Activar año
        </Button>
      )}
      {year.status === 'ACTIVE' && (
        <Button variant="outline" onClick={() => setConfirm('close')}>
          <Lock aria-hidden /> Cerrar año
        </Button>
      )}
      {problems.length > 0 && (
        <div className="w-full">
          <Alert>
            <ul className="list-inside list-disc">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'activate' ? '¿Activar este año lectivo?' : '¿Cerrar este año lectivo?'}
        description={
          confirm === 'activate'
            ? 'Una vez activo no se podrán agregar ni quitar períodos, ni cambiar sus fechas o pesos. Solo puede haber un año activo.'
            : 'Un año cerrado queda de solo lectura: no admite cambios en el año, sus períodos ni sus grupos.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={() => confirm && mutation.mutate(confirm)}
            >
              {confirm === 'activate' ? 'Activar' : 'Cerrar año'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">La acción queda registrada en la auditoría.</p>
      </Dialog>
    </>
  );
}

export function AcademicYearPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.ACADEMIC_YEARS_MANAGE);
  const {
    data: year,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['academic-years', id],
    queryFn: ({ signal }) => academicsService.year(id, signal),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        to="/academico"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Estructura académica
      </Link>
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <PageHeader
            title={year.name}
            description={`${formatDate(year.startsOn)} – ${formatDate(year.endsOn)}`}
            actions={
              <>
                <Badge tone={YEAR_STATUS_TONES[year.status]}>
                  {YEAR_STATUS_LABELS[year.status]}
                </Badge>
                {canManage && <StatusActions year={year} />}
              </>
            }
          />
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-5">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Suma de los pesos de los períodos</p>
                <div className="mt-2 h-2 rounded-full bg-surface-muted" aria-hidden>
                  <div
                    className={
                      year.totalWeightPercent === 100
                        ? 'h-full rounded-full bg-success'
                        : 'h-full rounded-full bg-warning'
                    }
                    style={{ width: `${Math.min(year.totalWeightPercent, 100)}%` }}
                  />
                </div>
              </div>
              <p className="flex items-center gap-1 text-2xl font-semibold tabular-nums">
                {year.totalWeightPercent} %
                {year.totalWeightPercent === 100 && (
                  <CircleCheck className="size-5 text-success" aria-label="Completo" />
                )}
              </p>
            </CardContent>
          </Card>
          {year.status === 'ACTIVE' && (
            <Alert tone="info">
              Con el año activo solo se puede cambiar el nombre de los períodos.
            </Alert>
          )}
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Períodos</h2>
            <CatalogManager<AcademicPeriod, PeriodForm>
              queryKey={['academic-years', id, 'periods']}
              invalidates={[['academic-years']]}
              list={async (signal) => (await academicsService.year(id, signal)).periods}
              entityName="período"
              emptyDescription="Agrega los períodos del año. Deben sumar 100 % para poder activarlo."
              canManage={canManage && year.status !== 'CLOSED'}
              remove={
                year.status === 'PLANNING' ? (p) => academicsService.deletePeriod(p.id) : undefined
              }
              schema={periodSchema}
              columns={[
                { header: 'N.º', cell: (p) => p.number, className: 'tabular-nums' },
                { header: 'Período', cell: (p) => <span className="font-medium">{p.name}</span> },
                {
                  header: 'Fechas',
                  cell: (p) => `${formatDate(p.startsOn)} – ${formatDate(p.endsOn)}`,
                  className: 'whitespace-nowrap',
                },
                { header: 'Peso', cell: (p) => `${p.weightPercent} %`, className: 'tabular-nums' },
              ]}
              fields={[
                { name: 'number', label: 'Número', type: 'number', required: true },
                { name: 'weightPercent', label: 'Peso (%)', type: 'number', required: true },
                { name: 'name', label: 'Nombre', required: true, wide: true },
                { name: 'startsOn', label: 'Inicio', type: 'date', required: true },
                { name: 'endsOn', label: 'Fin', type: 'date', required: true },
              ]}
              toForm={(p) => ({
                number: String(p?.number ?? year.periods.length + 1),
                name: p?.name ?? '',
                startsOn: p?.startsOn ?? '',
                endsOn: p?.endsOn ?? '',
                weightPercent: String(
                  p?.weightPercent ?? Math.max(0, 100 - year.totalWeightPercent),
                ),
              })}
              create={(v) => academicsService.createPeriod(id, toPeriodInput(v))}
              update={(p, v) => academicsService.updatePeriod(p.id, toPeriodInput(v))}
            />
          </section>
          <PeriodStatusCard year={year} canManage={canManage} />
          <GradingSchemeCard
            yearId={id}
            editable={can(PERMISSIONS.GRADING_MANAGE) && year.status !== 'CLOSED'}
          />
        </>
      )}
    </div>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getErrorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import {
  type AcademicYear,
  academicsService,
  PERIOD_STATUS_LABELS,
  PERIOD_STATUS_TONES,
} from '../academics.service';

/** Estado de los períodos y apertura para registrar notas (año activo y con SIEE). */
export function PeriodStatusCard({ year, canManage }: { year: AcademicYear; canManage: boolean }) {
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: (periodId: string) => academicsService.openPeriod(periodId),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['academic-years', year.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['academic-years'] });
      toast.success('Período abierto: los docentes ya pueden registrar notas.');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  if (year.periods.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Registro de notas por período</CardTitle>
        <CardDescription>
          Los docentes registran actividades y notas solo en los períodos abiertos. Para abrir uno,
          el año debe estar activo y tener su SIEE configurado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y text-sm">
          {year.periods.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{p.name}</span>{' '}
                <span className="text-muted-foreground">
                  {formatDate(p.startsOn)} – {formatDate(p.endsOn)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={PERIOD_STATUS_TONES[p.status]}>{PERIOD_STATUS_LABELS[p.status]}</Badge>
                {canManage && year.status === 'ACTIVE' && p.status === 'PLANNED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={open.isPending}
                    onClick={() => open.mutate(p.id)}
                  >
                    <Unlock aria-hidden /> Abrir
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

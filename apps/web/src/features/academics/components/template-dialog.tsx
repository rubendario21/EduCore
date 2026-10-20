import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { teachingService } from '@/features/teaching/teaching.service';
import { getErrorMessage } from '@/lib/api-client';

const SECTIONS = [
  ['levels', 'Niveles'],
  ['grades', 'Grados'],
  ['areas', 'Áreas obligatorias'],
  ['subjects', 'Asignaturas'],
] as const;

/**
 * Plantilla académica colombiana (opcional): primero muestra qué se crearía y
 * qué ya existe; solo al confirmar se crea lo que falta.
 */
export function TemplateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // La simulación no guarda nada: se consulta cada vez que se abre el diálogo.
  const simulation = useQuery({
    queryKey: ['academic-templates', 'colombia', 'preview'],
    queryFn: () => teachingService.applyColombianTemplate(true),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const preview = simulation.data ?? null;
  const apply = useMutation({
    mutationFn: () => teachingService.applyColombianTemplate(false),
    onSuccess: async (report) => {
      await Promise.all(
        ['education-levels', 'grades', 'subject-areas', 'subjects'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      const count = Object.values(report.created).flat().length;
      toast.success(`Plantilla aplicada: se crearon ${count} elemento(s).`);
      onOpenChange(false);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const toCreate = preview ? Object.values(preview.created).flat().length : 0;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
      title="Plantilla académica colombiana"
      description="Niveles, grados de Prejardín a Undécimo y áreas obligatorias de la Ley 115 (arts. 23 y 31). Todo se puede editar o desactivar después. No fija intensidades horarias ni escalas de valoración."
      className="max-w-2xl"
      submitLabel={toCreate > 0 ? `Crear ${toCreate} elemento(s)` : 'Nada por crear'}
      submitDisabled={!preview || toCreate === 0}
      pending={apply.isPending}
      error={error ?? (simulation.error ? getErrorMessage(simulation.error) : null)}
      onSubmit={() => apply.mutate()}
    >
      {!preview ? (
        simulation.isPending && <LoadingState label="Revisando la estructura actual…" />
      ) : (
        <>
          {toCreate === 0 && (
            <Alert tone="info">La institución ya tiene todo lo que trae la plantilla.</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {SECTIONS.map(([key, label]) => (
              <div key={key} className="text-sm">
                <p className="font-medium">{label}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {preview.created[key].map((item) => (
                    <li key={item.code} className="text-success">
                      + {item.name}
                    </li>
                  ))}
                  {preview.skipped[key].map((item) => (
                    <li key={item.code} className="text-muted-foreground">
                      Ya existe: {item.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </FormDialog>
  );
}

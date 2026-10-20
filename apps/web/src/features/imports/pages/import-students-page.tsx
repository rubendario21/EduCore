import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { ApiError, getErrorMessage } from '@/lib/api-client';
import { type ImportReport, importsService } from '../imports.service';

function ReportView({ report, onlyErrors }: { report: ImportReport; onlyErrors: boolean }) {
  const rows = onlyErrors ? report.rows.filter((r) => r.status === 'INVALID') : report.rows;
  const t = report.totals;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge>{t.rows} fila(s)</Badge>
        <Badge tone="success">{t.valid} válida(s)</Badge>
        <Badge tone={t.invalid > 0 ? 'danger' : 'neutral'}>{t.invalid} con errores</Badge>
        <Badge tone="primary">{t.newPersons} estudiante(s) nuevo(s)</Badge>
        {t.reusedPersons > 0 && <Badge>{t.reusedPersons} persona(s) existente(s)</Badge>}
        <Badge>{t.guardians} acudiente(s)</Badge>
        <Badge>{t.enrollments} matrícula(s)</Badge>
      </div>
      {report.ignoredColumns.length > 0 && (
        <Alert tone="warning">
          Columnas que no se reconocen y se ignoran: {report.ignoredColumns.join(', ')}.
        </Alert>
      )}
      <div className="max-h-[32rem] overflow-y-auto rounded-md border">
        <Table>
          <THead>
            <tr>
              <Th className="w-16">Fila</Th>
              <Th>Estudiante</Th>
              <Th>Resultado</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <tr key={r.row} className={r.status === 'INVALID' ? 'bg-danger/5' : undefined}>
                <Td className="align-top text-muted-foreground">{r.row}</Td>
                <Td className="align-top">{r.student}</Td>
                <Td>
                  {r.status === 'INVALID' ? (
                    <ul className="flex flex-col gap-0.5 text-danger">
                      {r.errors.map((e, i) => (
                        <li key={i}>
                          <span className="font-mono text-xs">{e.column}</span>: {e.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="flex flex-col gap-0.5 text-muted-foreground">
                      {r.actions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  )}
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Importación masiva: primero se valida todo el archivo (nada se guarda) y,
 * si no hay errores, se importa todo en una sola transacción.
 */
export function ImportStudentsPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [imported, setImported] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);

  const validate = useMutation({
    mutationFn: (f: File) => importsService.validate(f),
    onSuccess: (r) => {
      setReport(r);
      setOnlyErrors(r.totals.invalid > 0);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (f: File) => importsService.import(f),
    onSuccess: async (result) => {
      await Promise.all(
        ['students', 'guardians', 'enrollments'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      setImported(result.report);
      setReport(null);
      setFile(null);
      toast.success(`Se importaron ${result.report.totals.valid} estudiante(s).`);
    },
    onError: (e) => {
      // Si el archivo cambió de validez (p. ej. otro usuario registró a alguien), la API devuelve el informe.
      if (e instanceof ApiError && e.code === 'IMPORT_HAS_ERRORS') {
        setReport((e.details as { report: ImportReport }).report);
        setOnlyErrors(true);
      }
      setError(getErrorMessage(e));
    },
  });

  const choose = (f: File | null) => {
    setFile(f);
    setReport(null);
    setImported(null);
    setError(null);
    if (f) validate.mutate(f);
  };
  const canImport = !!file && !!report && report.totals.invalid === 0 && report.totals.valid > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Importar estudiantes"
        description="Carga estudiantes con su acudiente principal y, si quieres, su matrícula, desde un archivo CSV o Excel."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              void importsService.template().catch((e: unknown) => toast.error(getErrorMessage(e)))
            }
          >
            <Download aria-hidden /> Descargar plantilla
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>1. Elige el archivo</CardTitle>
          <CardDescription>
            CSV (separado por punto y coma o coma) o Excel (.xlsx), hasta 2 MB y 1000 filas. El
            archivo se revisa completo y no se guarda nada hasta que confirmes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            type="file"
            aria-label="Archivo de estudiantes"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="h-auto py-1.5"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
          {validate.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Revisando el archivo…
            </p>
          )}
          {error && <Alert>{error}</Alert>}
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>2. Revisa el informe</CardTitle>
              <CardDescription>{report.fileName}</CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />{' '}
              Solo filas con errores
            </label>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {report.totals.invalid > 0 ? (
              <Alert>
                Corrige las {report.totals.invalid} fila(s) con errores en tu archivo y vuelve a
                cargarlo. No se importará nada mientras haya errores.
              </Alert>
            ) : (
              <Alert tone="success">El archivo no tiene errores. Puedes importarlo.</Alert>
            )}
            <ReportView report={report} onlyErrors={onlyErrors} />
            <div className="flex justify-end">
              <Button
                disabled={!canImport || run.isPending}
                onClick={() => file && run.mutate(file)}
              >
                {run.isPending ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <FileUp aria-hidden />
                )}
                Importar {report.totals.valid} estudiante(s)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {imported && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5 text-sm">
            <p className="flex items-center gap-2 font-medium text-success">
              <CheckCircle2 className="size-5" aria-hidden /> Importación completada
            </p>
            <p>
              {imported.totals.valid} estudiante(s), {imported.totals.guardians} vínculo(s) con
              acudientes y {imported.totals.enrollments} matrícula(s) desde {imported.fileName}.
            </p>
            <Link to="/estudiantes" className="text-primary hover:underline">
              Ver estudiantes
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

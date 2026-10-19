import { zodResolver } from '@hookform/resolvers/zod';
import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type FieldValues, type Path, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { type z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { getErrorMessage } from '@/lib/api-client';
import { applyServerErrors } from '@/lib/forms';

export interface CatalogField<F> {
  name: Path<F> & string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  hint?: string;
  /** Solo al crear (p. ej. el año de un grupo no cambia). */
  createOnly?: boolean;
  /** Solo al editar (p. ej. el estado). */
  editOnly?: boolean;
  wide?: boolean;
}

export interface CatalogColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface CatalogManagerProps<T extends { id: string }, F extends FieldValues> {
  queryKey: QueryKey;
  /** Otras consultas que dependen de este catálogo y deben refrescarse. */
  invalidates?: QueryKey[];
  list: (signal?: AbortSignal) => Promise<T[]>;
  columns: CatalogColumn<T>[];
  fields: CatalogField<F>[];
  /** Esquema Zod del formulario (entrada y salida del mismo tipo: textos normalizados). */
  schema: z.ZodType<F, F>;
  toForm: (row: T | null) => F;
  create: (values: F) => Promise<unknown>;
  update: (row: T, values: F) => Promise<unknown>;
  /** Eliminación (opcional), siempre con confirmación. */
  remove?: (row: T) => Promise<unknown>;
  /** Si es false para una fila, no se muestran sus acciones (p. ej. registros de solo lectura). */
  rowEditable?: (row: T) => boolean;
  canManage: boolean;
  entityName: string;
  /** Plural para los mensajes (por defecto, entityName + "s"). */
  entityPlural?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
}

/**
 * Tabla + diálogo de alta/edición para catálogos simples (sedes, jornadas,
 * niveles, grados, áreas, asignaturas, grupos). Las reglas de negocio las
 * aplica la API; sus errores se muestran en el campo correspondiente.
 */
export function CatalogManager<T extends { id: string }, F extends FieldValues>(
  props: CatalogManagerProps<T, F>,
) {
  const {
    queryKey,
    list,
    columns,
    canManage,
    entityName,
    emptyDescription,
    toolbar,
    remove,
    rowEditable,
  } = props;
  const [editing, setEditing] = useState<T | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<T | null>(null);
  const queryClient = useQueryClient();
  const removal = useMutation({
    mutationFn: (row: T) => remove!(row),
    onSuccess: async () => {
      await Promise.all(
        [queryKey, ...(props.invalidates ?? [])].map((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        ),
      );
      toast.success(`${entityName.charAt(0).toUpperCase()}${entityName.slice(1)} eliminado(a).`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
    onSettled: () => setDeleting(null),
  });
  const { data, isPending, error, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => list(signal),
  });

  return (
    <Card>
      {(canManage || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="flex flex-wrap gap-2">{toolbar}</div>
          {canManage && (
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus aria-hidden /> Agregar {entityName}
            </Button>
          )}
        </div>
      )}
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          title={`No hay ${props.entityPlural ?? `${entityName}s`} todavía`}
          description={emptyDescription}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              {columns.map((c) => (
                <Th key={c.header} className={c.className}>
                  {c.header}
                </Th>
              ))}
              {canManage && (
                <Th className="w-20">
                  <span className="sr-only">Acciones</span>
                </Th>
              )}
            </tr>
          </THead>
          <TBody>
            {data.map((row) => (
              <tr key={row.id} className="hover:bg-surface-muted/50">
                {columns.map((c) => (
                  <Td key={c.header} className={c.className}>
                    {c.cell(row)}
                  </Td>
                ))}
                {canManage && (
                  <Td className="whitespace-nowrap">
                    {(rowEditable?.(row) ?? true) && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing(row)}
                          aria-label={`Editar ${entityName}`}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        {remove && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleting(row)}
                            aria-label={`Eliminar ${entityName}`}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing !== undefined && (
        <CatalogDialog {...props} row={editing} onClose={() => setEditing(undefined)} />
      )}
      {remove && (
        <Dialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`¿Eliminar ${entityName}?`}
          description="Esta acción no se puede deshacer y queda registrada en la auditoría."
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                disabled={removal.isPending}
                onClick={() => deleting && removal.mutate(deleting)}
              >
                Eliminar
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            Confirma que quieres eliminar este registro.
          </p>
        </Dialog>
      )}
    </Card>
  );
}

function CatalogDialog<T extends { id: string }, F extends FieldValues>({
  row,
  onClose,
  fields,
  schema,
  toForm,
  create,
  update,
  queryKey,
  invalidates = [],
  entityName,
}: CatalogManagerProps<T, F> & { row: T | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: toForm(row) as never });
  const visible = fields.filter((f) => (row ? !f.createOnly : !f.editOnly));

  const mutation = useMutation({
    mutationFn: (values: F) => (row ? update(row, values) : create(values)),
    onSuccess: async () => {
      await Promise.all(
        [queryKey, ...invalidates].map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
      toast.success(
        row
          ? 'Cambios guardados.'
          : `${entityName.charAt(0).toUpperCase()}${entityName.slice(1)} agregado(a).`,
      );
      onClose();
    },
    onError: (e) =>
      setError(
        applyServerErrors(
          e,
          form.setError,
          fields.map((f) => f.name),
        ),
      ),
  });

  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={row ? `Editar ${entityName}` : `Agregar ${entityName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="catalog-form" disabled={mutation.isPending}>
            {mutation.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            Guardar
          </Button>
        </>
      }
    >
      <form
        id="catalog-form"
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit((values) => {
          setError(null);
          mutation.mutate(values);
        })}
      >
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        {visible.map((field) =>
          field.type === 'checkbox' ? (
            <div key={field.name} className="flex flex-col gap-1 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  {...form.register(field.name)}
                  aria-invalid={errors[field.name] ? true : undefined}
                />
                {field.label}
              </label>
              {errors[field.name]?.message && (
                <p className="text-xs text-danger">{errors[field.name]?.message}</p>
              )}
            </div>
          ) : (
            <Field
              key={field.name}
              label={field.label}
              required={field.required}
              hint={field.hint}
              error={errors[field.name]?.message}
              className={field.wide ? 'sm:col-span-2' : undefined}
            >
              {(c) =>
                field.type === 'select' ? (
                  <Select {...c} {...form.register(field.name)}>
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input {...c} type={field.type ?? 'text'} {...form.register(field.name)} />
                )
              }
            </Field>
          ),
        )}
      </form>
    </Dialog>
  );
}

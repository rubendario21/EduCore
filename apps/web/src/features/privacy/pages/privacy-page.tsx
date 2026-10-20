import { zodResolver } from '@hookform/resolvers/zod';
import { PERMISSIONS } from '@educore/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader, Pagination } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError, getErrorMessage } from '@/lib/api-client';
import { applyServerErrors, codeField, dateField, requiredText } from '@/lib/forms';
import { formatDate, formatDateTime, fullName } from '@/lib/format';
import { ConsentList } from '../components/consent-list';
import { type Policy, privacyService } from '../privacy.service';

// --- Cobertura -----------------------------------------------------------------

function CoverageTab() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['data-consents', 'coverage', page],
    queryFn: ({ signal }) => privacyService.coverage({ page, pageSize: 20 }, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  if (isPending) return <LoadingState />;
  if (error instanceof ApiError && error.code === 'NO_CURRENT_POLICY') {
    return (
      <EmptyState
        title="No hay una política vigente"
        description="Redacta y publica la política de tratamiento de datos en la pestaña Políticas."
      />
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const { totals } = data;
  const stats: Array<[string, number, string?]> = [
    ['Estudiantes activos', totals.activeStudents],
    ['Con autorización vigente', totals.withConsent, 'text-success'],
    [
      'Sin autorización',
      totals.withoutConsent,
      totals.withoutConsent > 0 ? 'text-warning' : undefined,
    ],
    [
      'Negaron una finalidad necesaria',
      totals.requiredDenied,
      totals.requiredDenied > 0 ? 'text-danger' : undefined,
    ],
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Política vigente: <span className="font-medium text-foreground">{data.policy.title}</span>{' '}
        (versión {data.policy.version}).
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, tone]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-semibold ${tone ?? ''}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Estudiantes sin autorización vigente</CardTitle>
          <CardDescription>
            Registra la autorización desde la ficha de cada estudiante.
          </CardDescription>
        </CardHeader>
        {data.pending.length === 0 ? (
          <EmptyState title="Todos los estudiantes activos tienen autorización vigente" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Estudiante</Th>
                  <Th>Documento</Th>
                </tr>
              </THead>
              <TBody>
                {data.pending.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      {can(PERMISSIONS.STUDENTS_READ) ? (
                        <Link
                          to={`/estudiantes/${s.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {fullName(s)}
                        </Link>
                      ) : (
                        fullName(s)
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {s.documentType} {s.documentNumber}
                    </Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// --- Autorizaciones --------------------------------------------------------------

function ConsentsTab({ canManage }: { canManage: boolean }) {
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 20,
    status: '' as '' | 'ACTIVE' | 'REVOKED',
  });
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['data-consents', filters],
    queryFn: ({ signal }) => privacyService.consents(filters, signal),
    placeholderData: keepPreviousData,
  });
  return (
    <Card>
      <div className="border-b p-3">
        <Select
          aria-label="Estado"
          className="sm:w-48"
          value={filters.status}
          onChange={(e) =>
            setFilters({ ...filters, page: 1, status: e.target.value as typeof filters.status })
          }
        >
          <option value="">Todas</option>
          <option value="ACTIVE">Vigentes</option>
          <option value="REVOKED">Revocadas</option>
        </Select>
      </div>
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState title="No hay autorizaciones registradas" />
      ) : (
        <>
          <div className="px-4">
            <ConsentList consents={data.data} canManage={canManage} showStudent />
          </div>
          <Pagination
            meta={data.meta}
            onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
          />
        </>
      )}
    </Card>
  );
}

// --- Políticas ---------------------------------------------------------------------

const policySchema = z.object({
  version: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,20}$/, 'Hasta 20 letras, números, puntos o guiones.'),
  title: requiredText('El título', 5, 200),
  effectiveFrom: dateField('Vigente desde'),
  content: z.string().trim().min(50, 'El texto debe tener al menos 50 caracteres.').max(100_000),
  purposes: z
    .array(
      z.object({
        code: codeField,
        name: requiredText('La finalidad', 3, 150),
        description: z.string().trim().max(1000),
        required: z.boolean(),
      }),
    )
    .min(1, 'Agrega al menos una finalidad.'),
});
type PolicyValues = z.infer<typeof policySchema>;

const SUGGESTED_PURPOSES: PolicyValues['purposes'] = [
  {
    code: 'ACADEMICA',
    name: 'Gestión académica y administrativa del servicio educativo',
    description: '',
    required: true,
  },
  {
    code: 'COMUNICACIONES',
    name: 'Envío de comunicaciones institucionales',
    description: '',
    required: false,
  },
  {
    code: 'IMAGEN',
    name: 'Uso de imagen en publicaciones y redes institucionales',
    description: '',
    required: false,
  },
];

function PolicyDialog({
  policy,
  open,
  onClose,
}: {
  policy: Policy | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PolicyValues>({
    resolver: zodResolver(policySchema),
    values: policy
      ? {
          version: policy.version,
          title: policy.title,
          effectiveFrom: policy.effectiveFrom,
          content: policy.content,
          purposes: policy.purposes.map((p) => ({
            code: p.code,
            name: p.name,
            description: p.description ?? '',
            required: p.required,
          })),
        }
      : {
          version: '',
          title: 'Política de tratamiento de datos personales',
          effectiveFrom: '',
          content: '',
          purposes: SUGGESTED_PURPOSES,
        },
  });
  const purposes = useFieldArray({ control: form.control, name: 'purposes' });
  const mutation = useMutation({
    mutationFn: (v: PolicyValues) => {
      const input = {
        ...v,
        purposes: v.purposes.map((p) => ({ ...p, description: p.description || null })),
      };
      return policy
        ? privacyService.updatePolicy(policy.id, input)
        : privacyService.createPolicy(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['data-policies'] });
      toast.success('Borrador guardado.');
      onClose();
    },
    onError: (e) =>
      setError(
        applyServerErrors(e, form.setError, [
          'version',
          'title',
          'effectiveFrom',
          'content',
          'purposes',
        ]),
      ),
  });
  const { errors } = form.formState;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={policy ? `Editar versión ${policy.version}` : 'Nueva versión de la política'}
      description="Se guarda como borrador. Al publicarla queda fija y se pueden registrar autorizaciones sobre ella."
      className="max-w-3xl"
      submitLabel="Guardar borrador"
      pending={mutation.isPending}
      error={error}
      onSubmit={form.handleSubmit((v) => {
        setError(null);
        mutation.mutate(v);
      })}
    >
      <Alert tone="info">
        EduCore no incluye un texto legal predefinido: redáctalo con la asesoría jurídica de la
        institución.
      </Alert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Versión" required error={errors.version?.message}>
          {(c) => <Input {...c} placeholder="2027-1" {...form.register('version')} />}
        </Field>
        <Field label="Título" required error={errors.title?.message} className="sm:col-span-2">
          {(c) => <Input {...c} {...form.register('title')} />}
        </Field>
        <Field label="Vigente desde" required error={errors.effectiveFrom?.message}>
          {(c) => <Input {...c} type="date" {...form.register('effectiveFrom')} />}
        </Field>
      </div>
      <Field label="Texto de la política" required error={errors.content?.message}>
        {(c) => <Textarea {...c} className="min-h-48" {...form.register('content')} />}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Finalidades que se someten a autorización
        </legend>
        {purposes.fields.map((field, index) => (
          <div
            key={field.id}
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-[8rem_1fr_auto]"
          >
            <Input
              aria-label="Código"
              placeholder="CÓDIGO"
              {...form.register(`purposes.${index}.code`)}
            />
            <Input
              aria-label="Finalidad"
              placeholder="Descripción breve"
              {...form.register(`purposes.${index}.name`)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Quitar finalidad"
              onClick={() => purposes.remove(index)}
            >
              <Trash2 aria-hidden />
            </Button>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <Checkbox {...form.register(`purposes.${index}.required`)} /> Necesaria para prestar
              el servicio educativo
            </label>
            {(errors.purposes?.[index]?.code || errors.purposes?.[index]?.name) && (
              <p className="text-xs text-danger sm:col-span-3">
                {errors.purposes?.[index]?.code?.message ?? errors.purposes?.[index]?.name?.message}
              </p>
            )}
          </div>
        ))}
        {errors.purposes?.message && (
          <p className="text-xs text-danger">{errors.purposes.message}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => purposes.append({ code: '', name: '', description: '', required: false })}
        >
          <Plus aria-hidden /> Agregar finalidad
        </Button>
      </fieldset>
    </FormDialog>
  );
}

function PoliciesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Policy | null | 'new'>(null);
  const [publishing, setPublishing] = useState<Policy | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['data-policies'],
    queryFn: ({ signal }) => privacyService.policies(signal),
  });
  const publish = useMutation({
    mutationFn: (id: string) => privacyService.publishPolicy(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['data-policies'] });
      await queryClient.invalidateQueries({ queryKey: ['data-consents'] });
      toast.success('Política publicada.');
      setPublishing(null);
    },
    onError: (e) => setPublishError(getErrorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <Button className="self-end" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Nueva versión
        </Button>
      )}
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          title="Aún no hay política de tratamiento de datos"
          description="Crea la primera versión."
        />
      ) : (
        data.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>
                  {p.title} · versión {p.version}
                </CardTitle>
                <CardDescription>
                  Vigente desde {formatDate(p.effectiveFrom)}
                  {p.publishedAt && ` · publicada ${formatDateTime(p.publishedAt)}`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={p.status === 'PUBLISHED' ? 'success' : 'warning'}>
                  {p.status === 'PUBLISHED' ? 'Publicada' : 'Borrador'}
                </Badge>
                {canManage && p.status === 'DRAFT' && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      onClick={() => setEditing(p)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button size="sm" onClick={() => setPublishing(p)}>
                      <Send aria-hidden /> Publicar
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap gap-1">
                {p.purposes.map((x) => (
                  <Badge key={x.id} tone={x.required ? 'primary' : 'neutral'}>
                    {x.name}
                  </Badge>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-muted-foreground">Ver texto</summary>
                <p className="mt-2 whitespace-pre-wrap">{p.content}</p>
              </details>
            </CardContent>
          </Card>
        ))
      )}
      {canManage && editing !== null && (
        <PolicyDialog
          policy={editing === 'new' ? null : editing}
          open
          onClose={() => setEditing(null)}
        />
      )}
      <FormDialog
        open={publishing !== null}
        onOpenChange={(o) => !o && (setPublishing(null), setPublishError(null))}
        title={`Publicar versión ${publishing?.version ?? ''}`}
        description="Una versión publicada no se puede modificar. Para cambiarla habrá que crear una versión nueva."
        submitLabel="Publicar"
        pending={publish.isPending}
        error={publishError}
        onSubmit={() => publishing && publish.mutate(publishing.id)}
      />
    </div>
  );
}

export function PrivacyPage() {
  const { can } = useAuth();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Protección de datos"
        description="Política de tratamiento de datos personales y autorizaciones (Ley 1581 de 2012)."
      />
      <Tabs defaultValue="coverage">
        <TabsList>
          <TabsTrigger value="coverage">Cobertura</TabsTrigger>
          <TabsTrigger value="consents">Autorizaciones</TabsTrigger>
          <TabsTrigger value="policies">Políticas</TabsTrigger>
        </TabsList>
        <TabsContent value="coverage">
          <CoverageTab />
        </TabsContent>
        <TabsContent value="consents">
          <ConsentsTab canManage={can(PERMISSIONS.PRIVACY_CONSENTS_MANAGE)} />
        </TabsContent>
        <TabsContent value="policies">
          <PoliciesTab canManage={can(PERMISSIONS.PRIVACY_POLICIES_MANAGE)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

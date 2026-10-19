import { PERMISSIONS, RECORD_STATUSES } from '@educore/shared';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { z } from 'zod';
import { CatalogManager } from '@/components/catalog-manager';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { ErrorState, LoadingState } from '@/components/ui/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/auth-context';
import { codeField, nullIfEmpty, optionalText, phoneField, requiredText } from '@/lib/forms';
import { GeneralTab } from '../components/general-tab';
import { LogoCard } from '../components/logo-card';
import { SettingsTab } from '../components/settings-tab';
import {
  type Campus,
  institutionService,
  RECORD_STATUS_LABELS,
  type Shift,
} from '../institution.service';

const statusOptions = RECORD_STATUSES.map((s) => ({ value: s, label: RECORD_STATUS_LABELS[s] }));
const statusBadge = (status: 'ACTIVE' | 'INACTIVE') => (
  <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>{RECORD_STATUS_LABELS[status]}</Badge>
);

const campusSchema = z.object({
  code: codeField,
  name: requiredText('El nombre', 2, 150),
  isMain: z.boolean(),
  daneCode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{6,20}$/.test(v), 'Entre 6 y 20 dígitos.'),
  address: optionalText(300),
  city: optionalText(120),
  phone: phoneField,
  status: z.enum(RECORD_STATUSES),
});
type CampusForm = z.infer<typeof campusSchema>;

const shiftSchema = z.object({
  code: codeField,
  name: requiredText('El nombre', 2, 100),
  status: z.enum(RECORD_STATUSES),
});
type ShiftForm = z.infer<typeof shiftSchema>;

const campusPayload = (v: CampusForm) => ({
  code: v.code,
  name: v.name,
  isMain: v.isMain,
  daneCode: nullIfEmpty(v.daneCode),
  address: nullIfEmpty(v.address),
  city: nullIfEmpty(v.city),
  phone: nullIfEmpty(v.phone),
});

export function InstitutionPage() {
  const { can } = useAuth();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['institution'],
    queryFn: ({ signal }) => institutionService.get(signal),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Institución"
        description="Datos legales, configuración, sedes y jornadas."
      />
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Datos generales</TabsTrigger>
          <TabsTrigger value="settings">Configuración</TabsTrigger>
          <TabsTrigger value="campuses">Sedes</TabsTrigger>
          <TabsTrigger value="shifts">Jornadas</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          {isPending ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : (
            <GeneralTab institution={data} editable={can(PERMISSIONS.INSTITUTION_UPDATE)} />
          )}
        </TabsContent>
        <TabsContent value="settings">
          {isPending ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : (
            <div className="flex flex-col gap-6">
              <LogoCard
                institution={data}
                editable={can(PERMISSIONS.INSTITUTION_SETTINGS_UPDATE)}
              />
              <SettingsTab
                institution={data}
                editable={can(PERMISSIONS.INSTITUTION_SETTINGS_UPDATE)}
              />
            </div>
          )}
        </TabsContent>
        <TabsContent value="campuses">
          <CatalogManager<Campus, CampusForm>
            queryKey={['campuses']}
            list={institutionService.campuses}
            entityName="sede"
            emptyDescription="Registra al menos una sede para poder crear grupos."
            canManage={can(PERMISSIONS.CAMPUSES_MANAGE)}
            schema={campusSchema}
            columns={[
              {
                header: 'Sede',
                cell: (c) => (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.isMain && (
                      <Badge tone="primary">
                        <Star className="size-3" aria-hidden /> Principal
                      </Badge>
                    )}
                  </span>
                ),
              },
              { header: 'Código', cell: (c) => c.code },
              { header: 'Ciudad', cell: (c) => c.city ?? '—' },
              { header: 'Estado', cell: (c) => statusBadge(c.status) },
            ]}
            fields={[
              { name: 'code', label: 'Código', required: true },
              { name: 'name', label: 'Nombre', required: true },
              { name: 'daneCode', label: 'Código DANE de la sede' },
              { name: 'phone', label: 'Teléfono' },
              { name: 'address', label: 'Dirección', wide: true },
              { name: 'city', label: 'Ciudad o municipio' },
              {
                name: 'status',
                label: 'Estado',
                type: 'select',
                options: statusOptions,
                editOnly: true,
              },
              { name: 'isMain', label: 'Es la sede principal', type: 'checkbox' },
            ]}
            toForm={(c) => ({
              code: c?.code ?? '',
              name: c?.name ?? '',
              isMain: c?.isMain ?? false,
              daneCode: c?.daneCode ?? '',
              address: c?.address ?? '',
              city: c?.city ?? '',
              phone: c?.phone ?? '',
              status: c?.status ?? 'ACTIVE',
            })}
            create={(v) => institutionService.createCampus(campusPayload(v))}
            update={(c, v) =>
              institutionService.updateCampus(c.id, { ...campusPayload(v), status: v.status })
            }
          />
        </TabsContent>
        <TabsContent value="shifts">
          <CatalogManager<Shift, ShiftForm>
            queryKey={['shifts']}
            list={institutionService.shifts}
            entityName="jornada"
            emptyDescription="Por ejemplo: Mañana, Tarde, Única, Fin de semana."
            canManage={can(PERMISSIONS.SHIFTS_MANAGE)}
            schema={shiftSchema}
            columns={[
              { header: 'Jornada', cell: (s) => <span className="font-medium">{s.name}</span> },
              { header: 'Código', cell: (s) => s.code },
              { header: 'Estado', cell: (s) => statusBadge(s.status) },
            ]}
            fields={[
              { name: 'code', label: 'Código', required: true },
              { name: 'name', label: 'Nombre', required: true },
              {
                name: 'status',
                label: 'Estado',
                type: 'select',
                options: statusOptions,
                editOnly: true,
              },
            ]}
            toForm={(s) => ({
              code: s?.code ?? '',
              name: s?.name ?? '',
              status: s?.status ?? 'ACTIVE',
            })}
            create={(v) => institutionService.createShift({ code: v.code, name: v.name })}
            update={(s, v) => institutionService.updateShift(s.id, v)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

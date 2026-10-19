import { PERMISSIONS, RECORD_STATUSES } from '@educore/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { CatalogManager } from '@/components/catalog-manager';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/auth-context';
import {
  RECORD_STATUS_LABELS,
  useCampuses,
  useShifts,
} from '@/features/institution/institution.service';
import { codeField, dateField, requiredText } from '@/lib/forms';
import { formatDate } from '@/lib/format';
import {
  type AcademicYear,
  academicsService,
  type CatalogItem,
  type EducationLevel,
  type Grade,
  type SchoolGroup,
  type Subject,
  useAcademicYears,
  YEAR_STATUS_LABELS,
  YEAR_STATUS_TONES,
} from '../academics.service';

const statusOptions = RECORD_STATUSES.map((s) => ({ value: s, label: RECORD_STATUS_LABELS[s] }));
const statusBadge = (status: 'ACTIVE' | 'INACTIVE') => (
  <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>{RECORD_STATUS_LABELS[status]}</Badge>
);
const intString = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .refine(
      (v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max,
      `${label}: número entre ${min} y ${max}.`,
    );

// --- Años lectivos ----------------------------------------------------------

const yearSchema = z
  .object({
    year: intString('El año', 2000, 2100),
    name: requiredText('El nombre', 3, 100),
    startsOn: dateField('Inicio'),
    endsOn: dateField('Fin'),
  })
  .refine((v) => v.endsOn > v.startsOn, {
    path: ['endsOn'],
    message: 'Debe ser posterior al inicio.',
  });
type YearForm = z.infer<typeof yearSchema>;

function YearsTab({ canManage }: { canManage: boolean }) {
  return (
    <CatalogManager<AcademicYear, YearForm>
      queryKey={['academic-years']}
      list={academicsService.years}
      entityName="año lectivo"
      entityPlural="años lectivos"
      emptyDescription="Crea el año lectivo y sus períodos; actívalo cuando los períodos sumen 100 %."
      canManage={canManage}
      rowEditable={(y) => y.status !== 'CLOSED'}
      schema={yearSchema}
      columns={[
        {
          header: 'Año lectivo',
          cell: (y) => (
            <Link
              to={`/academico/anios/${y.id}`}
              className="font-medium text-primary hover:underline"
            >
              {y.name}
            </Link>
          ),
        },
        {
          header: 'Fechas',
          cell: (y) => `${formatDate(y.startsOn)} – ${formatDate(y.endsOn)}`,
          className: 'whitespace-nowrap',
        },
        { header: 'Períodos', cell: (y) => `${y.periods.length} (${y.totalWeightPercent} %)` },
        {
          header: 'Estado',
          cell: (y) => (
            <Badge tone={YEAR_STATUS_TONES[y.status]}>{YEAR_STATUS_LABELS[y.status]}</Badge>
          ),
        },
      ]}
      fields={[
        {
          name: 'year',
          label: 'Año',
          type: 'number',
          required: true,
          createOnly: true,
          hint: 'Calendario B: usa el año de inicio.',
        },
        { name: 'name', label: 'Nombre', required: true },
        { name: 'startsOn', label: 'Inicio', type: 'date', required: true },
        { name: 'endsOn', label: 'Fin', type: 'date', required: true },
      ]}
      toForm={(y) => ({
        year: String(y?.year ?? new Date().getFullYear() + 1),
        name: y?.name ?? '',
        startsOn: y?.startsOn ?? '',
        endsOn: y?.endsOn ?? '',
      })}
      create={(v) => academicsService.createYear({ ...v, year: Number(v.year) })}
      update={(y, v) =>
        academicsService.updateYear(y.id, { name: v.name, startsOn: v.startsOn, endsOn: v.endsOn })
      }
    />
  );
}

// --- Niveles y grados -------------------------------------------------------

const levelSchema = z.object({
  code: codeField,
  name: requiredText('El nombre', 2, 150),
  sortOrder: intString('El orden', 0, 1000),
  status: z.enum(RECORD_STATUSES),
});
type LevelForm = z.infer<typeof levelSchema>;

const gradeSchema = levelSchema.extend({
  educationLevelId: z.string().uuid('Selecciona un nivel.'),
});
type GradeForm = z.infer<typeof gradeSchema>;

function LevelsTab({ canManage }: { canManage: boolean }) {
  const levels = useQuery({
    queryKey: ['education-levels'],
    queryFn: ({ signal }) => academicsService.levels(signal),
  });
  const levelOptions = (levels.data ?? [])
    .filter((l) => l.status === 'ACTIVE')
    .map((l) => ({ value: l.id, label: l.name }));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Niveles educativos</h2>
        <CatalogManager<EducationLevel, LevelForm>
          queryKey={['education-levels']}
          invalidates={[['grades']]}
          list={academicsService.levels}
          entityName="nivel"
          entityPlural="niveles"
          emptyDescription="Por ejemplo: Preescolar, Básica primaria, Básica secundaria, Media."
          canManage={canManage}
          schema={levelSchema}
          columns={[
            { header: 'Nivel', cell: (l) => <span className="font-medium">{l.name}</span> },
            { header: 'Código', cell: (l) => l.code },
            { header: 'Orden', cell: (l) => l.sortOrder, className: 'tabular-nums' },
            { header: 'Estado', cell: (l) => statusBadge(l.status) },
          ]}
          fields={[
            { name: 'code', label: 'Código', required: true },
            { name: 'name', label: 'Nombre', required: true },
            {
              name: 'sortOrder',
              label: 'Orden',
              type: 'number',
              hint: 'Posición en los listados.',
            },
            {
              name: 'status',
              label: 'Estado',
              type: 'select',
              options: statusOptions,
              editOnly: true,
            },
          ]}
          toForm={(l) => ({
            code: l?.code ?? '',
            name: l?.name ?? '',
            sortOrder: String(l?.sortOrder ?? 0),
            status: l?.status ?? 'ACTIVE',
          })}
          create={(v) =>
            academicsService.createLevel({
              code: v.code,
              name: v.name,
              sortOrder: Number(v.sortOrder),
            })
          }
          update={(l, v) =>
            academicsService.updateLevel(l.id, { ...v, sortOrder: Number(v.sortOrder) })
          }
        />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Grados</h2>
        <CatalogManager<Grade, GradeForm>
          queryKey={['grades']}
          list={academicsService.grades}
          entityName="grado"
          emptyDescription={
            levelOptions.length === 0
              ? 'Primero crea un nivel educativo.'
              : 'Por ejemplo: Transición, Primero, Sexto, Undécimo.'
          }
          canManage={canManage && levelOptions.length > 0}
          schema={gradeSchema}
          columns={[
            { header: 'Grado', cell: (g) => <span className="font-medium">{g.name}</span> },
            { header: 'Nivel', cell: (g) => g.educationLevelName },
            { header: 'Código', cell: (g) => g.code },
            { header: 'Estado', cell: (g) => statusBadge(g.status) },
          ]}
          fields={[
            {
              name: 'educationLevelId',
              label: 'Nivel',
              type: 'select',
              options: levelOptions,
              required: true,
              wide: true,
            },
            { name: 'code', label: 'Código', required: true },
            { name: 'name', label: 'Nombre', required: true },
            { name: 'sortOrder', label: 'Orden', type: 'number' },
            {
              name: 'status',
              label: 'Estado',
              type: 'select',
              options: statusOptions,
              editOnly: true,
            },
          ]}
          toForm={(g) => ({
            educationLevelId: g?.educationLevelId ?? levelOptions[0]?.value ?? '',
            code: g?.code ?? '',
            name: g?.name ?? '',
            sortOrder: String(g?.sortOrder ?? 0),
            status: g?.status ?? 'ACTIVE',
          })}
          create={(v) =>
            academicsService.createGrade({
              educationLevelId: v.educationLevelId,
              code: v.code,
              name: v.name,
              sortOrder: Number(v.sortOrder),
            })
          }
          update={(g, v) =>
            academicsService.updateGrade(g.id, { ...v, sortOrder: Number(v.sortOrder) })
          }
        />
      </section>
    </div>
  );
}

// --- Áreas y asignaturas ----------------------------------------------------

const areaSchema = z.object({
  code: codeField,
  name: requiredText('El nombre', 2, 150),
  status: z.enum(RECORD_STATUSES),
});
type AreaForm = z.infer<typeof areaSchema>;
const subjectSchema = areaSchema.extend({ subjectAreaId: z.string().uuid('Selecciona un área.') });
type SubjectForm = z.infer<typeof subjectSchema>;

function SubjectsTab({ canManage }: { canManage: boolean }) {
  const areas = useQuery({
    queryKey: ['subject-areas'],
    queryFn: ({ signal }) => academicsService.areas(signal),
  });
  const areaOptions = (areas.data ?? [])
    .filter((a) => a.status === 'ACTIVE')
    .map((a) => ({ value: a.id, label: a.name }));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Áreas</h2>
        <CatalogManager<CatalogItem, AreaForm>
          queryKey={['subject-areas']}
          invalidates={[['subjects']]}
          list={academicsService.areas}
          entityName="área"
          emptyDescription="Por ejemplo: Matemáticas, Humanidades, Ciencias naturales."
          canManage={canManage}
          schema={areaSchema}
          columns={[
            { header: 'Área', cell: (a) => <span className="font-medium">{a.name}</span> },
            { header: 'Código', cell: (a) => a.code },
            { header: 'Estado', cell: (a) => statusBadge(a.status) },
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
          toForm={(a) => ({
            code: a?.code ?? '',
            name: a?.name ?? '',
            status: a?.status ?? 'ACTIVE',
          })}
          create={(v) => academicsService.createArea({ code: v.code, name: v.name })}
          update={(a, v) => academicsService.updateArea(a.id, v)}
        />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Asignaturas</h2>
        <CatalogManager<Subject, SubjectForm>
          queryKey={['subjects']}
          list={academicsService.subjects}
          entityName="asignatura"
          emptyDescription={areaOptions.length === 0 ? 'Primero crea un área.' : undefined}
          canManage={canManage && areaOptions.length > 0}
          schema={subjectSchema}
          columns={[
            { header: 'Asignatura', cell: (s) => <span className="font-medium">{s.name}</span> },
            { header: 'Área', cell: (s) => s.subjectAreaName },
            { header: 'Código', cell: (s) => s.code },
            { header: 'Estado', cell: (s) => statusBadge(s.status) },
          ]}
          fields={[
            {
              name: 'subjectAreaId',
              label: 'Área',
              type: 'select',
              options: areaOptions,
              required: true,
              wide: true,
            },
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
            subjectAreaId: s?.subjectAreaId ?? areaOptions[0]?.value ?? '',
            code: s?.code ?? '',
            name: s?.name ?? '',
            status: s?.status ?? 'ACTIVE',
          })}
          create={(v) =>
            academicsService.createSubject({
              subjectAreaId: v.subjectAreaId,
              code: v.code,
              name: v.name,
            })
          }
          update={(s, v) => academicsService.updateSubject(s.id, v)}
        />
      </section>
    </div>
  );
}

// --- Grupos -----------------------------------------------------------------

const groupSchema = z.object({
  academicYearId: z.string().uuid('Selecciona un año.'),
  gradeId: z.string().uuid('Selecciona un grado.'),
  campusId: z.string().uuid('Selecciona una sede.'),
  shiftId: z.string().uuid('Selecciona una jornada.'),
  code: codeField,
  name: requiredText('El nombre', 1, 100),
  capacity: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 200),
      'Entre 1 y 200.',
    ),
  status: z.enum(RECORD_STATUSES),
});
type GroupForm = z.infer<typeof groupSchema>;

function GroupsTab({ canManage }: { canManage: boolean }) {
  const years = useAcademicYears();
  const grades = useQuery({
    queryKey: ['grades'],
    queryFn: ({ signal }) => academicsService.grades(signal),
  });
  const campuses = useCampuses();
  const shifts = useShifts();
  const defaultYear =
    years.data?.find((y) => y.status === 'ACTIVE') ??
    years.data?.find((y) => y.status === 'PLANNING') ??
    years.data?.[0];
  const [yearId, setYearId] = useState<string>('');
  const selectedYear = yearId || defaultYear?.id || '';
  const year = years.data?.find((y) => y.id === selectedYear);

  const active = <T extends { id: string; name: string; status: string }>(items: T[] | undefined) =>
    (items ?? []).filter((i) => i.status === 'ACTIVE').map((i) => ({ value: i.id, label: i.name }));
  const gradeOptions = active(grades.data);
  const campusOptions = active(campuses.data);
  const shiftOptions = active(shifts.data);
  const missing = [
    !year && 'un año lectivo',
    gradeOptions.length === 0 && 'grados',
    campusOptions.length === 0 && 'sedes',
    shiftOptions.length === 0 && 'jornadas',
  ].filter(Boolean);

  return (
    <CatalogManager<SchoolGroup, GroupForm>
      key={selectedYear}
      queryKey={['school-groups', selectedYear]}
      list={(signal) =>
        selectedYear
          ? academicsService.groups({ academicYearId: selectedYear }, signal)
          : Promise.resolve([])
      }
      entityName="grupo"
      emptyDescription={
        missing.length > 0
          ? `Para crear grupos necesitas ${missing.join(', ')} activos.`
          : undefined
      }
      canManage={canManage && missing.length === 0 && year?.status !== 'CLOSED'}
      rowEditable={() => year?.status !== 'CLOSED'}
      toolbar={
        <Select
          aria-label="Año lectivo"
          className="w-56"
          value={selectedYear}
          onChange={(e) => setYearId(e.target.value)}
        >
          {(years.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name} · {YEAR_STATUS_LABELS[y.status]}
            </option>
          ))}
        </Select>
      }
      schema={groupSchema}
      columns={[
        { header: 'Grupo', cell: (g) => <span className="font-medium">{g.name}</span> },
        { header: 'Código', cell: (g) => g.code },
        { header: 'Grado', cell: (g) => g.gradeName },
        { header: 'Sede', cell: (g) => g.campusName },
        { header: 'Jornada', cell: (g) => g.shiftName },
        { header: 'Cupo', cell: (g) => g.capacity ?? '—', className: 'tabular-nums' },
        { header: 'Estado', cell: (g) => statusBadge(g.status) },
      ]}
      fields={[
        { name: 'gradeId', label: 'Grado', type: 'select', options: gradeOptions, required: true },
        { name: 'campusId', label: 'Sede', type: 'select', options: campusOptions, required: true },
        {
          name: 'shiftId',
          label: 'Jornada',
          type: 'select',
          options: shiftOptions,
          required: true,
        },
        { name: 'code', label: 'Código', required: true, hint: 'Ej.: 601' },
        { name: 'name', label: 'Nombre', required: true, hint: 'Ej.: Sexto A' },
        { name: 'capacity', label: 'Cupo', type: 'number' },
        { name: 'status', label: 'Estado', type: 'select', options: statusOptions, editOnly: true },
      ]}
      toForm={(g) => ({
        academicYearId: g?.academicYearId ?? selectedYear,
        gradeId: g?.gradeId ?? gradeOptions[0]?.value ?? '',
        campusId: g?.campusId ?? campusOptions[0]?.value ?? '',
        shiftId: g?.shiftId ?? shiftOptions[0]?.value ?? '',
        code: g?.code ?? '',
        name: g?.name ?? '',
        capacity: g?.capacity ? String(g.capacity) : '',
        status: g?.status ?? 'ACTIVE',
      })}
      create={(v) =>
        academicsService.createGroup({
          ...v,
          status: undefined,
          capacity: v.capacity ? Number(v.capacity) : null,
        })
      }
      update={(g, v) =>
        academicsService.updateGroup(g.id, {
          ...v,
          academicYearId: undefined,
          capacity: v.capacity ? Number(v.capacity) : null,
        })
      }
    />
  );
}

export function AcademicsPage() {
  const { can } = useAuth();
  const manage = can(PERMISSIONS.ACADEMICS_MANAGE);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Estructura académica"
        description="Años lectivos, niveles, grados, áreas, asignaturas y grupos."
      />
      <Tabs defaultValue="years">
        <TabsList>
          <TabsTrigger value="years">Años lectivos</TabsTrigger>
          <TabsTrigger value="levels">Niveles y grados</TabsTrigger>
          <TabsTrigger value="subjects">Áreas y asignaturas</TabsTrigger>
          <TabsTrigger value="groups">Grupos</TabsTrigger>
        </TabsList>
        <TabsContent value="years">
          <YearsTab canManage={can(PERMISSIONS.ACADEMIC_YEARS_MANAGE)} />
        </TabsContent>
        <TabsContent value="levels">
          <LevelsTab canManage={manage} />
        </TabsContent>
        <TabsContent value="subjects">
          <SubjectsTab canManage={manage} />
        </TabsContent>
        <TabsContent value="groups">
          <GroupsTab canManage={manage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

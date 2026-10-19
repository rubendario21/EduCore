import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

const FOUR_PERIODS = [
  {
    number: 1,
    name: 'Primer período',
    startsOn: '2027-01-25',
    endsOn: '2027-04-02',
    weightPercent: 25,
  },
  {
    number: 2,
    name: 'Segundo período',
    startsOn: '2027-04-05',
    endsOn: '2027-06-18',
    weightPercent: 25,
  },
  {
    number: 3,
    name: 'Tercer período',
    startsOn: '2027-07-06',
    endsOn: '2027-09-10',
    weightPercent: 25,
  },
  {
    number: 4,
    name: 'Cuarto período',
    startsOn: '2027-09-13',
    endsOn: '2027-11-30',
    weightPercent: 25,
  },
];

describe('Estructura académica (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let institutionId: string;
  let admin: string;

  const api = (token = admin) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
      delete: (url: string) => auth(agent.delete(`/api/v1${url}`)),
    };
  };

  async function createYear(year = 2027, startsOn = `${year}-01-25`, endsOn = `${year}-11-30`) {
    const res = await api().post('/academic-years', {
      year,
      name: `Año lectivo ${year}`,
      startsOn,
      endsOn,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function addPeriods(yearId: string, periods = FOUR_PERIODS) {
    let last;
    for (const period of periods) {
      last = await api().post(`/academic-years/${yearId}/periods`, period);
      expect(last.status, JSON.stringify(last.body)).toBe(201);
    }
    return last!.body;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    institutionId = (await seedInstitution(app)).id;
    await seedMember(app, {
      institutionId,
      email: 'rectoria@prueba.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.INSTITUTION_ADMIN,
    });
    admin = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
  });

  // ---------------------------------------------------------------------------
  describe('Niveles, grados, áreas y asignaturas', () => {
    it('crea la jerarquía nivel → grado y área → asignatura', async () => {
      const level = await api().post('/education-levels', {
        code: 'primaria',
        name: 'Básica primaria',
        sortOrder: 2,
      });
      expect(level.body).toMatchObject({ code: 'PRIMARIA', sortOrder: 2, status: 'ACTIVE' });

      const grade = await api().post('/grades', {
        code: 'G1',
        name: 'Primero',
        educationLevelId: level.body.id,
        sortOrder: 1,
      });
      expect(grade.body).toMatchObject({ code: 'G1', educationLevelName: 'Básica primaria' });

      const area = await api().post('/subject-areas', { code: 'MAT', name: 'Matemáticas' });
      const subject = await api().post('/subjects', {
        code: 'GEOM',
        name: 'Geometría',
        subjectAreaId: area.body.id,
      });
      expect(subject.body).toMatchObject({ code: 'GEOM', subjectAreaName: 'Matemáticas' });

      expect((await api().get(`/grades?educationLevelId=${level.body.id}`)).body).toHaveLength(1);
      expect((await api().get(`/subjects?subjectAreaId=${area.body.id}`)).body).toHaveLength(1);
    });

    it('rechaza códigos duplicados', async () => {
      await api().post('/subject-areas', { code: 'MAT', name: 'Matemáticas' });
      const dup = await api().post('/subject-areas', { code: 'mat', name: 'Otra' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CODE_TAKEN');
    });

    it('no usa referencias inactivas ni de otra institución', async () => {
      const level = await api().post('/education-levels', { code: 'PRE', name: 'Preescolar' });
      await api().patch(`/education-levels/${level.body.id}`, { status: 'INACTIVE' });
      const inactive = await api().post('/grades', {
        code: 'TR',
        name: 'Transición',
        educationLevelId: level.body.id,
      });
      expect(inactive.status).toBe(409);
      expect(inactive.body.error.code).toBe('INACTIVE_REFERENCE');

      const other = await seedInstitution(app, 'Otro Colegio');
      const foreignLevel = await prisma.educationLevel.create({
        data: { institutionId: other.id, code: 'X', name: 'Ajeno' },
      });
      const foreign = await api().post('/grades', {
        code: 'G9',
        name: 'Noveno',
        educationLevelId: foreignLevel.id,
      });
      expect(foreign.status).toBe(404);
      expect(
        (await api().get('/education-levels')).body.map((l: { code: string }) => l.code),
      ).toEqual(['PRE']);
    });

    it('impide desactivar un nivel con grados activos o un área con asignaturas activas', async () => {
      const level = await api().post('/education-levels', { code: 'MEDIA', name: 'Media' });
      await api().post('/grades', { code: 'G10', name: 'Décimo', educationLevelId: level.body.id });
      const res = await api().patch(`/education-levels/${level.body.id}`, { status: 'INACTIVE' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'IN_USE', details: { count: 1 } });

      const area = await api().post('/subject-areas', { code: 'CN', name: 'Ciencias naturales' });
      await api().post('/subjects', { code: 'BIO', name: 'Biología', subjectAreaId: area.body.id });
      expect(
        (await api().patch(`/subject-areas/${area.body.id}`, { status: 'INACTIVE' })).body.error
          .code,
      ).toBe('IN_USE');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Años lectivos y períodos', () => {
    it('crea un año en planeación y rechaza duplicados y fechas inválidas', async () => {
      const id = await createYear(2027);
      const year = await api().get(`/academic-years/${id}`);
      expect(year.body).toMatchObject({
        year: 2027,
        status: 'PLANNING',
        totalWeightPercent: 0,
        periods: [],
      });

      expect(
        (
          await api().post('/academic-years', {
            year: 2027,
            name: 'Repetido',
            startsOn: '2027-01-01',
            endsOn: '2027-11-01',
          })
        ).body.error.code,
      ).toBe('ACADEMIC_YEAR_TAKEN');

      const inverted = await api().post('/academic-years', {
        year: 2028,
        name: 'Invertido',
        startsOn: '2028-11-30',
        endsOn: '2028-01-25',
      });
      expect(inverted.status).toBe(400);
      const impossible = await api().post('/academic-years', {
        year: 2028,
        name: 'Fecha imposible',
        startsOn: '2028-02-30',
        endsOn: '2028-11-30',
      });
      expect(impossible.body.error.details[0].field).toBe('startsOn');
    });

    it('admite calendario B (año que cruza dos años calendario)', async () => {
      expect(await createYear(2027, '2027-08-17', '2028-06-15')).toBeTruthy();
    });

    it('agrega períodos y calcula el peso total', async () => {
      const id = await createYear();
      const year = await addPeriods(id);
      expect(year.totalWeightPercent).toBe(100);
      expect(year.periods.map((p: { number: number }) => p.number)).toEqual([1, 2, 3, 4]);
    });

    it('rechaza períodos solapados, fuera del año, repetidos o que superen 100 %', async () => {
      const id = await createYear();
      await addPeriods(id, FOUR_PERIODS.slice(0, 2));

      const overlap = await api().post(`/academic-years/${id}/periods`, {
        ...FOUR_PERIODS[2],
        startsOn: '2027-06-18',
      });
      expect(overlap.status).toBe(400);
      expect(JSON.stringify(overlap.body.error.details)).toContain('se cruzan con el período 2');

      const outside = await api().post(`/academic-years/${id}/periods`, {
        ...FOUR_PERIODS[3],
        endsOn: '2027-12-15',
      });
      expect(JSON.stringify(outside.body.error.details)).toContain('dentro del año lectivo');

      const repeated = await api().post(`/academic-years/${id}/periods`, {
        ...FOUR_PERIODS[2],
        number: 1,
      });
      expect(repeated.body.error.details.map((d: { field: string }) => d.field)).toContain(
        'number',
      );

      const heavy = await api().post(`/academic-years/${id}/periods`, {
        ...FOUR_PERIODS[2],
        weightPercent: 60,
      });
      expect(JSON.stringify(heavy.body.error.details)).toContain('sumarían 110 %');
    });

    it('solo activa un año cuyos períodos suman exactamente 100 %', async () => {
      const id = await createYear();
      await addPeriods(id, FOUR_PERIODS.slice(0, 3));

      const notReady = await api().post(`/academic-years/${id}/activate`);
      expect(notReady.status).toBe(409);
      expect(notReady.body.error).toMatchObject({
        code: 'ACADEMIC_YEAR_NOT_READY',
        details: { problems: ['Los pesos de los períodos suman 75 % y deben sumar 100 %.'] },
      });

      await addPeriods(id, FOUR_PERIODS.slice(3));
      const active = await api().post(`/academic-years/${id}/activate`);
      expect(active.status).toBe(200);
      expect(active.body.status).toBe('ACTIVE');
      expect(await prisma.auditLog.count({ where: { action: 'academics.year.activated' } })).toBe(
        1,
      );
    });

    it('admite pesos con decimales que suman 100 %', async () => {
      const id = await createYear();
      await addPeriods(id, [
        {
          number: 1,
          name: 'Período 1',
          startsOn: '2027-01-25',
          endsOn: '2027-05-10',
          weightPercent: 33.33,
        },
        {
          number: 2,
          name: 'Período 2',
          startsOn: '2027-05-11',
          endsOn: '2027-08-20',
          weightPercent: 33.33,
        },
        {
          number: 3,
          name: 'Período 3',
          startsOn: '2027-08-21',
          endsOn: '2027-11-30',
          weightPercent: 33.34,
        },
      ]);
      expect((await api().post(`/academic-years/${id}/activate`)).status).toBe(200);
    });

    it('con el año activo solo permite renombrar períodos', async () => {
      const id = await createYear();
      const year = await addPeriods(id);
      await api().post(`/academic-years/${id}/activate`);
      const periodId = year.periods[0].id;

      expect(
        (await api().post(`/academic-years/${id}/periods`, { ...FOUR_PERIODS[0], number: 5 })).body
          .error.code,
      ).toBe('ACADEMIC_YEAR_ACTIVE_LOCKED');
      expect(
        (await api().patch(`/academic-periods/${periodId}`, { weightPercent: 30 })).body.error.code,
      ).toBe('ACADEMIC_YEAR_ACTIVE_LOCKED');
      expect((await api().delete(`/academic-periods/${periodId}`)).body.error.code).toBe(
        'ACADEMIC_YEAR_ACTIVE_LOCKED',
      );
      expect(
        (await api().patch(`/academic-years/${id}`, { endsOn: '2027-12-01' })).body.error.code,
      ).toBe('ACADEMIC_YEAR_ACTIVE_LOCKED');

      const renamed = await api().patch(`/academic-periods/${periodId}`, { name: 'Período I' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.periods[0].name).toBe('Período I');
    });

    it('solo puede haber un año activo, incluso con activaciones simultáneas', async () => {
      const a = await createYear(2027);
      const b = await createYear(2028);
      await addPeriods(a);
      await addPeriods(
        b,
        FOUR_PERIODS.map((p) => ({
          ...p,
          startsOn: p.startsOn.replace('2027', '2028'),
          endsOn: p.endsOn.replace('2027', '2028'),
        })),
      );

      const results = await Promise.all([
        api().post(`/academic-years/${a}/activate`),
        api().post(`/academic-years/${b}/activate`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.academicYear.count({ where: { institutionId, status: 'ACTIVE' } })).toBe(
        1,
      );
    });

    it('cierra el año y lo deja de solo lectura', async () => {
      const id = await createYear();
      const year = await addPeriods(id);
      await api().post(`/academic-years/${id}/activate`);

      const closed = await api().post(`/academic-years/${id}/close`);
      expect(closed.body.status).toBe('CLOSED');

      expect(
        (await api().patch(`/academic-years/${id}`, { name: 'Otro nombre' })).body.error.code,
      ).toBe('ACADEMIC_YEAR_CLOSED');
      expect(
        (await api().patch(`/academic-periods/${year.periods[0].id}`, { name: 'Otro nombre' })).body
          .error.code,
      ).toBe('ACADEMIC_YEAR_CLOSED');
      expect((await api().post(`/academic-years/${id}/activate`)).body.error.code).toBe(
        'INVALID_STATUS_TRANSITION',
      );
    });

    it('en planeación permite editar y eliminar períodos', async () => {
      const id = await createYear();
      const year = await addPeriods(id, FOUR_PERIODS.slice(0, 2));
      const edited = await api().patch(`/academic-periods/${year.periods[1].id}`, {
        weightPercent: 75,
      });
      expect(edited.body.totalWeightPercent).toBe(100);
      const afterDelete = await api().delete(`/academic-periods/${year.periods[1].id}`);
      expect(afterDelete.body.periods).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Grupos', () => {
    async function seedStructure() {
      const campusA = await api().post('/campuses', { code: 'A', name: 'Sede A', isMain: true });
      const campusB = await api().post('/campuses', { code: 'B', name: 'Sede B' });
      const shift = await api().post('/shifts', { code: 'MANANA', name: 'Mañana' });
      const level = await api().post('/education-levels', { code: 'SEC', name: 'Secundaria' });
      const grade = await api().post('/grades', {
        code: 'G6',
        name: 'Sexto',
        educationLevelId: level.body.id,
      });
      const yearId = await createYear();
      return {
        campusA: campusA.body.id,
        campusB: campusB.body.id,
        shift: shift.body.id,
        grade: grade.body.id,
        yearId,
      };
    }

    it('crea grupos con su grado, sede y jornada', async () => {
      const s = await seedStructure();
      const res = await api().post('/school-groups', {
        academicYearId: s.yearId,
        gradeId: s.grade,
        campusId: s.campusA,
        shiftId: s.shift,
        code: '601',
        name: 'Sexto A',
        capacity: 35,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        code: '601',
        academicYear: 2027,
        gradeName: 'Sexto',
        campusName: 'Sede A',
        shiftName: 'Mañana',
        capacity: 35,
      });
      expect((await api().get(`/school-groups?academicYearId=${s.yearId}`)).body).toHaveLength(1);
    });

    it('el código es único por año y sede', async () => {
      const s = await seedStructure();
      const base = {
        academicYearId: s.yearId,
        gradeId: s.grade,
        shiftId: s.shift,
        code: '601',
        name: 'Sexto A',
      };
      await api().post('/school-groups', { ...base, campusId: s.campusA });
      expect(
        (await api().post('/school-groups', { ...base, campusId: s.campusA })).body.error.code,
      ).toBe('CODE_TAKEN');
      expect((await api().post('/school-groups', { ...base, campusId: s.campusB })).status).toBe(
        201,
      );
    });

    it('rechaza referencias inactivas y años cerrados', async () => {
      const s = await seedStructure();
      const base = {
        academicYearId: s.yearId,
        gradeId: s.grade,
        campusId: s.campusB,
        shiftId: s.shift,
        code: '601',
        name: 'Sexto A',
      };
      await api().patch(`/campuses/${s.campusB}`, { status: 'INACTIVE' });
      expect((await api().post('/school-groups', base)).body.error.code).toBe('INACTIVE_REFERENCE');

      await addPeriods(s.yearId);
      await api().post(`/academic-years/${s.yearId}/activate`);
      const group = await api().post('/school-groups', { ...base, campusId: s.campusA });
      await api().post(`/academic-years/${s.yearId}/close`);
      expect(
        (await api().post('/school-groups', { ...base, campusId: s.campusA, code: '602' })).body
          .error.code,
      ).toBe('ACADEMIC_YEAR_CLOSED');
      expect(
        (await api().patch(`/school-groups/${group.body.id}`, { name: 'Cambio' })).body.error.code,
      ).toBe('ACADEMIC_YEAR_CLOSED');
    });
  });
});

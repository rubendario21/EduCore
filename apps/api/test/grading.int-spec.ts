import { DECREE_1290_EXAMPLE, SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';
const example = {
  ...DECREE_1290_EXAMPLE.scale,
  promotionUnit: 'AREA',
  maxFailedForPromotion: 2,
  minAttendancePercent: 75,
  notes: 'Se reprueba un área con desempeño bajo al final del año.',
  levels: DECREE_1290_EXAMPLE.levels,
};

describe('SIEE configurable (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: string;
  let coordinator: string;
  let years: { y2027: string; y2028: string };

  const api = (token = admin) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      put: (url: string, body: object) => auth(agent.put(`/api/v1${url}`)).send(body),
    };
  };
  const scheme = (yearId: string) => `/academic-years/${yearId}/grading-scheme`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    const institutionId = (await seedInstitution(app)).id;
    await seedMember(app, {
      institutionId,
      email: 'rectoria@prueba.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.INSTITUTION_ADMIN,
    });
    await seedMember(app, {
      institutionId,
      email: 'coordinacion@prueba.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.COORDINATOR,
    });
    admin = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
    coordinator = await loginAs(app, 'coordinacion@prueba.edu.co', PASSWORD);
    const create = async (year: number) =>
      (
        await api().post('/academic-years', {
          year,
          name: `Año ${year}`,
          startsOn: `${year}-01-25`,
          endsOn: `${year}-11-30`,
        })
      ).body.id as string;
    years = { y2027: await create(2027), y2028: await create(2028) };
  });

  it('sin configurar responde que el SIEE no está definido', async () => {
    const res = await api().get(scheme(years.y2027));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GRADING_SCHEME_NOT_DEFINED');
  });

  it('guarda el SIEE con sus niveles, lo reemplaza completo y audita ambos cambios', async () => {
    const created = await api().put(scheme(years.y2027), example);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body).toMatchObject({
      minScore: 1,
      maxScore: 5,
      decimals: 1,
      passingScore: 3,
      promotionUnit: 'AREA',
      maxFailedForPromotion: 2,
      minAttendancePercent: 75,
      levels: [
        { code: 'BAJO', minScore: 1, maxScore: 2.9 },
        { code: 'BASICO', minScore: 3, maxScore: 3.9 },
        { code: 'ALTO', minScore: 4, maxScore: 4.5 },
        { code: 'SUPERIOR', minScore: 4.6, maxScore: 5 },
      ],
    });

    // Escala propia de la institución: 0 a 100 sin decimales y dos niveles.
    const custom = await api().put(scheme(years.y2027), {
      ...example,
      minScore: 0,
      maxScore: 100,
      decimals: 0,
      passingScore: 60,
      levels: [
        { code: 'NO_APRUEBA', name: 'No aprueba', minScore: 0, maxScore: 59 },
        { code: 'APRUEBA', name: 'Aprueba', minScore: 60, maxScore: 100 },
      ],
    });
    expect(custom.status).toBe(200);
    expect(custom.body.levels.map((l: { code: string }) => l.code)).toEqual([
      'NO_APRUEBA',
      'APRUEBA',
    ]);
    expect(await prisma.performanceLevel.count()).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: { action: { startsWith: 'academics.grading_scheme.' } },
      }),
    ).toBe(2);
  });

  it('rechaza niveles con huecos o solapes y explica el problema', async () => {
    const withGap = await api().put(scheme(years.y2027), {
      ...example,
      levels: example.levels.map((l) => (l.code === 'ALTO' ? { ...l, minScore: 4.1 } : l)),
    });
    expect(withGap.status).toBe(400);
    expect(JSON.stringify(withGap.body)).toContain('Hay un hueco entre');
    const badPassing = await api().put(scheme(years.y2027), { ...example, passingScore: 7 });
    expect(JSON.stringify(badPassing.body)).toContain('aprobación debe estar entre');
    expect(await prisma.gradingScheme.count()).toBe(0);
  });

  it('copia el SIEE de un año a otro que aún no lo tiene', async () => {
    await api().put(scheme(years.y2027), example);
    const copied = await api().post(`${scheme(years.y2028)}/copy`, {
      fromAcademicYearId: years.y2027,
    });
    expect(copied.status, JSON.stringify(copied.body)).toBe(201);
    expect(copied.body).toMatchObject({
      academicYear: { year: 2028 },
      passingScore: 3,
      levels: expect.any(Array),
    });
    expect(copied.body.levels).toHaveLength(4);
    const again = await api().post(`${scheme(years.y2028)}/copy`, {
      fromAcademicYearId: years.y2027,
    });
    expect(again.body.error.code).toBe('GRADING_SCHEME_ALREADY_DEFINED');
  });

  it('un año cerrado no cambia su SIEE', async () => {
    await api().put(scheme(years.y2027), example);
    await prisma.academicYear.update({ where: { id: years.y2027 }, data: { status: 'CLOSED' } });
    const res = await api().put(scheme(years.y2027), { ...example, passingScore: 3.5 });
    expect(res.body.error.code).toBe('ACADEMIC_YEAR_CLOSED');
  });

  it('la base de datos rechaza una escala incoherente', async () => {
    await api().put(scheme(years.y2027), example);
    const db = await connectAsApp();
    try {
      expect(await sqlStateOf(db.query(`UPDATE grading_scheme SET passing_score = 9`))).toBe(
        SQLSTATE.CHECK_VIOLATION,
      );
      expect(await sqlStateOf(db.query(`UPDATE grading_scheme SET decimals = 3`))).toBe(
        SQLSTATE.CHECK_VIOLATION,
      );
    } finally {
      await db.end();
    }
  });

  it('el coordinador consulta el SIEE pero no lo modifica', async () => {
    await api().put(scheme(years.y2027), example);
    expect((await api(coordinator).get(scheme(years.y2027))).status).toBe(200);
    expect((await api(coordinator).put(scheme(years.y2027), example)).status).toBe(403);
  });
});

import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { todayIn } from '../src/modules/dashboard/dashboard.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

describe('Dashboard (integración)', () => {
  let app: NestExpressApplication;
  let institutionId: string;
  let admin: string;

  const get = () =>
    request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${admin}`);
  const post = (url: string, body: object = {}) =>
    request(app.getHttpServer())
      .post(`/api/v1${url}`)
      .set('Authorization', `Bearer ${admin}`)
      .send(body);

  beforeAll(async () => {
    app = await createTestApp();
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
    await seedMember(app, {
      institutionId,
      email: 'docente@prueba.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.TEACHER,
    });
    await seedMember(app, {
      institutionId,
      email: 'invitado@prueba.edu.co',
      password: null,
      roleCode: SYSTEM_ROLES.TEACHER,
    });
    admin = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
  });

  it('distingue cero de "sin datos": sin año activo, activeYear es null', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      users: { active: 2, invited: 1, suspended: 0 },
      institution: { activeCampuses: 0, activeShifts: 0 },
      academics: { activeGrades: 0, activeSubjects: 0, activeYear: null },
    });
    expect(res.body.users.byRole).toEqual([
      { code: 'INSTITUTION_ADMIN', name: 'Administrador institucional', count: 1 },
      { code: 'TEACHER', name: 'Docente', count: 1 },
    ]);
  });

  it('informa el año activo, el período en curso y sus grupos', async () => {
    const today = todayIn('America/Bogota');
    const year = Number(today.slice(0, 4));
    const yearRes = await post('/academic-years', {
      year,
      name: `Año ${year}`,
      startsOn: `${year}-01-01`,
      endsOn: `${year}-12-31`,
    });
    await post(`/academic-years/${yearRes.body.id}/periods`, {
      number: 1,
      name: 'Período único',
      startsOn: `${year}-01-01`,
      endsOn: `${year}-12-31`,
      weightPercent: 100,
    });
    await post(`/academic-years/${yearRes.body.id}/activate`);

    const res = await get();
    expect(res.body.today).toBe(today);
    expect(res.body.academics.activeYear).toMatchObject({
      year,
      periodCount: 1,
      currentPeriod: { number: 1, name: 'Período único' },
      activeGroups: 0,
    });
  });

  it('calcula la fecha de hoy en la zona horaria de la institución', () => {
    // 2026-10-20 03:00 UTC sigue siendo 19 de octubre en Bogotá (UTC-5).
    const instant = new Date('2026-10-20T03:00:00Z');
    expect(todayIn('America/Bogota', instant)).toBe('2026-10-19');
    expect(todayIn('UTC', instant)).toBe('2026-10-20');
  });
});

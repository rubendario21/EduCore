import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

describe('Institución, sedes y jornadas (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let institutionId: string;
  let admin: string;
  let coordinator: string;

  const api = (token?: string) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object) => auth(agent.post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    institutionId = (await seedInstitution(app, 'Institución Educativa Ejemplo')).id;
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
  });

  describe('Datos de la institución', () => {
    it('devuelve los datos con la configuración regional por defecto', async () => {
      const res = await api(admin).get('/institution');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: institutionId,
        legalName: 'Institución Educativa Ejemplo',
        country: 'CO',
        settings: {
          timezone: 'America/Bogota',
          locale: 'es-CO',
          currency: 'COP',
          branding: { primaryColor: null, accentColor: null },
          preferences: { guardianAbsenceExcusesEnabled: false },
        },
      });
    });

    it('valida el dígito de verificación del NIT (algoritmo DIAN)', async () => {
      const wrong = await api(admin).patch('/institution', { taxId: '800197268', taxIdDv: '5' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.details).toEqual([
        { field: 'taxIdDv', messages: ['El dígito de verificación no corresponde al NIT.'] },
      ]);

      const missing = await api(admin).patch('/institution', { taxId: '800197268' });
      expect(missing.status).toBe(400);

      const ok = await api(admin).patch('/institution', {
        taxId: '800197268',
        taxIdDv: '4',
        tradeName: 'Colegio Ejemplo',
        website: 'https://colegio-ejemplo.edu.co',
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        taxId: '800197268',
        taxIdDv: '4',
        tradeName: 'Colegio Ejemplo',
      });

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'institution.profile.updated' },
      });
      expect(entry.changes).toMatchObject({ taxId: { from: null, to: '800197268' } });
    });

    it('permite vaciar campos opcionales', async () => {
      await api(admin).patch('/institution', { phone: '601 555 1234' });
      const res = await api(admin).patch('/institution', { phone: '' });
      expect(res.body.phone).toBeNull();
    });

    it('el coordinador puede consultar pero no editar', async () => {
      expect((await api(coordinator).get('/institution')).status).toBe(200);
      expect(
        (await api(coordinator).patch('/institution', { legalName: 'Otro nombre' })).status,
      ).toBe(403);
    });
  });

  describe('Configuración regional y marca', () => {
    it('valida zona horaria, moneda y colores', async () => {
      const res = await api(admin).patch('/institution/settings', {
        timezone: 'Marte/Olympus',
        currency: 'XYZ',
        branding: { primaryColor: 'azul' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'branding.primaryColor',
      ]);

      const zone = await api(admin).patch('/institution/settings', {
        timezone: 'Marte/Olympus',
        currency: 'XYZ',
      });
      expect(zone.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'currency',
        'timezone',
      ]);
    });

    it('actualiza la marca sin perder lo demás y la expone públicamente', async () => {
      await api(admin).patch('/institution/settings', {
        preferences: { guardianAbsenceExcusesEnabled: true },
      });
      const res = await api(admin).patch('/institution/settings', {
        branding: { primaryColor: '#1F4E9C', accentColor: '#0E9384' },
      });
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({
        branding: { primaryColor: '#1F4E9C', accentColor: '#0E9384' },
        preferences: { guardianAbsenceExcusesEnabled: true },
      });

      const branding = await api().get('/institution/branding');
      expect(branding.status).toBe(200);
      expect(branding.body).toEqual({
        name: 'Institución Educativa Ejemplo',
        legalName: 'Institución Educativa Ejemplo',
        primaryColor: '#1F4E9C',
        accentColor: '#0E9384',
        logoUrl: null,
      });
    });

    it('la marca pública no expone datos internos', async () => {
      const branding = await api().get('/institution/branding');
      expect(Object.keys(branding.body).sort()).toEqual([
        'accentColor',
        'legalName',
        'logoUrl',
        'name',
        'primaryColor',
      ]);
    });
  });

  describe('Sedes', () => {
    it('crea sedes con código en mayúsculas y rechaza duplicados', async () => {
      const res = await api(admin).post('/campuses', {
        code: 'principal',
        name: 'Sede principal',
        isMain: true,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ code: 'PRINCIPAL', isMain: true, status: 'ACTIVE' });

      const dup = await api(admin).post('/campuses', { code: 'PRINCIPAL', name: 'Otra' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CODE_TAKEN');
    });

    it('mantiene una sola sede principal y protege la sede principal', async () => {
      const main = await api(admin).post('/campuses', { code: 'A', name: 'Sede A', isMain: true });
      const other = await api(admin).post('/campuses', { code: 'B', name: 'Sede B' });

      const deactivateMain = await api(admin).patch(`/campuses/${main.body.id}`, {
        status: 'INACTIVE',
      });
      expect(deactivateMain.body.error.code).toBe('MAIN_CAMPUS_INACTIVE');

      const unsetMain = await api(admin).patch(`/campuses/${main.body.id}`, { isMain: false });
      expect(unsetMain.status).toBe(400);

      expect(
        (await api(admin).patch(`/campuses/${other.body.id}`, { isMain: true })).body.isMain,
      ).toBe(true);
      const list = await api(admin).get('/campuses');
      expect(
        list.body.filter((c: { isMain: boolean }) => c.isMain).map((c: { code: string }) => c.code),
      ).toEqual(['B']);
    });

    it('impide desactivar la última sede activa', async () => {
      const only = await api(admin).post('/campuses', { code: 'UNICA', name: 'Sede única' });
      const res = await api(admin).patch(`/campuses/${only.body.id}`, { status: 'INACTIVE' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_ACTIVE_RECORD');
    });

    it('impide desactivar una sede con grupos activos en años no cerrados', async () => {
      const a = await api(admin).post('/campuses', { code: 'A', name: 'Sede A', isMain: true });
      const b = await api(admin).post('/campuses', { code: 'B', name: 'Sede B' });
      const shift = await api(admin).post('/shifts', { code: 'MANANA', name: 'Mañana' });
      const level = await api(admin).post('/education-levels', {
        code: 'SEC',
        name: 'Básica secundaria',
      });
      const grade = await api(admin).post('/grades', {
        code: 'G6',
        name: 'Sexto',
        educationLevelId: level.body.id,
      });
      const year = await api(admin).post('/academic-years', {
        year: 2027,
        name: 'Año 2027',
        startsOn: '2027-01-25',
        endsOn: '2027-11-30',
      });
      await api(admin).post('/school-groups', {
        academicYearId: year.body.id,
        gradeId: grade.body.id,
        campusId: b.body.id,
        shiftId: shift.body.id,
        code: '601',
        name: 'Sexto A',
      });

      const res = await api(admin).patch(`/campuses/${b.body.id}`, { status: 'INACTIVE' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'IN_USE', details: { groupCount: 1 } });
      expect(a.status).toBe(201);
    });
  });

  describe('Jornadas', () => {
    it('crea, edita y protege la última jornada activa', async () => {
      const morning = await api(admin).post('/shifts', { code: 'manana', name: 'Mañana' });
      expect(morning.body).toMatchObject({ code: 'MANANA', status: 'ACTIVE' });

      const last = await api(admin).patch(`/shifts/${morning.body.id}`, { status: 'INACTIVE' });
      expect(last.body.error.code).toBe('LAST_ACTIVE_RECORD');

      await api(admin).post('/shifts', { code: 'TARDE', name: 'Tarde' });
      const ok = await api(admin).patch(`/shifts/${morning.body.id}`, { status: 'INACTIVE' });
      expect(ok.body.status).toBe('INACTIVE');
      expect(
        await prisma.auditLog.count({ where: { action: { startsWith: 'institution.shift.' } } }),
      ).toBe(3);
    });
  });
});

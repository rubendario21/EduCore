import { randomUUID } from 'node:crypto';
import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailService } from '../src/infrastructure/mail/mail.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

const person = (
  doc: string,
  firstNames = 'Sofía',
  lastNames = 'Martínez López',
  extra: Record<string, unknown> = {},
) => ({
  documentType: 'TI',
  documentNumber: doc,
  firstNames,
  lastNames,
  ...extra,
});

describe('Estudiantes, acudientes y personal (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let institutionId: string;
  let admin: string;
  let secretary: string;
  let coordinator: string;

  const api = (token: string) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
      delete: (url: string) => auth(agent.delete(`/api/v1${url}`)),
    };
  };

  async function createStudent(doc = '1100000001', extra: Record<string, unknown> = {}) {
    const res = await api(admin).post('/students', { person: person(doc), ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    mail.outbox.length = 0;
    institutionId = (await seedInstitution(app)).id;
    const seed = (email: string, roleCode: string) =>
      seedMember(app, { institutionId, email, password: PASSWORD, roleCode });
    await seed('rectoria@prueba.edu.co', SYSTEM_ROLES.INSTITUTION_ADMIN);
    await seed('secretaria@prueba.edu.co', SYSTEM_ROLES.SECRETARY);
    await seed('coordinacion@prueba.edu.co', SYSTEM_ROLES.COORDINATOR);
    admin = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
    secretary = await loginAs(app, 'secretaria@prueba.edu.co', PASSWORD);
    coordinator = await loginAs(app, 'coordinacion@prueba.edu.co', PASSWORD);
  });

  // ---------------------------------------------------------------------------
  describe('Estudiantes', () => {
    it('registra, lista, busca y edita estudiantes', async () => {
      const student = await createStudent('1100000001', { code: 'E-001' });
      expect(student).toMatchObject({
        code: 'E-001',
        status: 'ACTIVE',
        person: {
          documentType: 'TI',
          documentNumber: '1100000001',
          firstNames: 'Sofía',
          hasAccess: false,
        },
        guardians: [],
      });

      const list = await api(secretary).get('/students?search=sofia');
      expect(list.status).toBe(200);
      expect(list.body.meta.total).toBe(1);
      // Sin tildes ni mayúsculas, y por documento.
      expect((await api(secretary).get('/students?search=MARTINEZ%20lopez')).body.meta.total).toBe(
        1,
      );
      expect((await api(secretary).get('/students?search=1100000001')).body.meta.total).toBe(1);
      expect((await api(secretary).get('/students?search=E-001')).body.meta.total).toBe(1);

      const updated = await api(admin).patch(`/students/${student.id}`, {
        person: { phone: '300 123 4567', birthDate: '2014-03-09' },
        status: 'WITHDRAWN',
      });
      expect(updated.body).toMatchObject({
        status: 'WITHDRAWN',
        person: { phone: '300 123 4567', birthDate: '2014-03-09' },
      });
      expect(
        await prisma.auditLog.count({ where: { action: { startsWith: 'students.student.' } } }),
      ).toBe(2);
    });

    it('rechaza estudiantes y códigos duplicados', async () => {
      await createStudent('1100000001', { code: 'E-001' });
      const same = await api(admin).post('/students', { person: person('1100000001') });
      expect(same.status).toBe(409);
      expect(same.body.error.code).toBe('STUDENT_ALREADY_EXISTS');

      const code = await api(admin).post('/students', {
        person: person('1100000002', 'Juan', 'Pérez'),
        code: 'E-001',
      });
      expect(code.body.error.code).toBe('STUDENT_CODE_TAKEN');
    });

    it('no mezcla personas: mismo documento con otro nombre se rechaza', async () => {
      await createStudent('1100000001');
      const res = await api(admin).post('/guardians', {
        person: person('1100000001', 'Pedro', 'Gómez'),
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'PERSON_DATA_MISMATCH',
        details: { existingName: 'Sofía Martínez López' },
      });
    });

    it('valida los datos de la persona', async () => {
      const res = await api(admin).post('/students', {
        person: { documentType: 'XX', documentNumber: '1', firstNames: 'A' },
      });
      expect(res.status).toBe(400);
      const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
      expect(fields).toEqual([
        'person.documentNumber',
        'person.documentType',
        'person.firstNames',
        'person.lastNames',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Acudientes y vínculos', () => {
    it('una persona del personal que también es acudiente es UNA sola persona', async () => {
      const teacher = await api(admin).post('/staff', {
        person: person('52123456', 'Laura', 'Rincón', { documentType: 'CC' }),
        staffType: 'TEACHER',
        title: 'Docente de ciencias',
      });
      expect(teacher.status).toBe(201);
      const student = await createStudent();
      const peopleBefore = await prisma.person.count();

      const linked = await api(admin).post(`/students/${student.id}/guardians`, {
        person: person('52123456', 'LAURA', 'rincón', { documentType: 'CC' }),
        relationship: 'MOTHER',
        isLegalRepresentative: true,
      });
      expect(linked.status).toBe(201);
      expect(await prisma.person.count()).toBe(peopleBefore);
      expect(linked.body.guardians[0]).toMatchObject({
        relationship: 'MOTHER',
        isPrimary: true,
        isLegalRepresentative: true,
        person: { id: teacher.body.person.id },
      });
    });

    it('mantiene exactamente un acudiente principal', async () => {
      const student = await createStudent();
      const mother = await api(admin).post(`/students/${student.id}/guardians`, {
        person: person('52000001', 'Ana', 'López', { documentType: 'CC' }),
        relationship: 'MOTHER',
      });
      const motherId = mother.body.guardians[0].guardianId;
      expect(mother.body.guardians[0].isPrimary).toBe(true);

      const father = await api(admin).post(`/students/${student.id}/guardians`, {
        person: person('79000001', 'Carlos', 'Martínez', { documentType: 'CC' }),
        relationship: 'FATHER',
        isPrimary: true,
      });
      const fatherId = father.body.guardians.find(
        (g: { relationship: string }) => g.relationship === 'FATHER',
      ).guardianId;
      expect(
        father.body.guardians
          .filter((g: { isPrimary: boolean }) => g.isPrimary)
          .map((g: { guardianId: string }) => g.guardianId),
      ).toEqual([fatherId]);

      const unsetPrimary = await api(admin).patch(`/students/${student.id}/guardians/${fatherId}`, {
        isPrimary: false,
      });
      expect(unsetPrimary.body.error.code).toBe('PRIMARY_GUARDIAN_REQUIRED');
      const removePrimary = await api(admin).delete(
        `/students/${student.id}/guardians/${fatherId}`,
      );
      expect(removePrimary.body.error.code).toBe('PRIMARY_GUARDIAN_REQUIRED');

      const removeOther = await api(admin).delete(`/students/${student.id}/guardians/${motherId}`);
      expect(removeOther.status).toBe(200);
      expect(removeOther.body.guardians).toHaveLength(1);
      // El acudiente desvinculado sigue registrado (no se borra a la persona).
      expect((await api(admin).get(`/guardians/${motherId}`)).status).toBe(200);
      expect(
        await prisma.auditLog.count({ where: { action: { startsWith: 'students.guardian.' } } }),
      ).toBe(3);
    });

    it('la base de datos impide dos acudientes principales aunque falle la aplicación', async () => {
      const student = await createStudent();
      const a = await api(admin).post('/guardians', {
        person: person('52000001', 'Ana', 'López', { documentType: 'CC' }),
      });
      const b = await api(admin).post('/guardians', {
        person: person('79000001', 'Carlos', 'Martínez', { documentType: 'CC' }),
      });
      const db = await connectAsApp();
      try {
        const insert = (guardianId: string) =>
          db.query(
            `INSERT INTO student_guardian (student_id, guardian_id, relationship, is_primary, updated_at) VALUES ($1, $2, 'OTHER', true, now())`,
            [student.id, guardianId],
          );
        await insert(a.body.id);
        expect(await sqlStateOf(insert(b.body.id))).toBe(SQLSTATE.UNIQUE_VIOLATION);
      } finally {
        await db.end();
      }
    });

    it('rechaza vínculos inválidos', async () => {
      const student = await createStudent();
      const none = await api(admin).post(`/students/${student.id}/guardians`, {
        relationship: 'MOTHER',
      });
      expect(none.status).toBe(400);

      const self = await api(admin).post(`/students/${student.id}/guardians`, {
        person: person('1100000001'),
        relationship: 'OTHER',
      });
      expect(self.body.error.code).toBe('GUARDIAN_IS_STUDENT');

      const guardian = await api(admin).post('/guardians', {
        person: person('52000001', 'Ana', 'López', { documentType: 'CC' }),
      });
      await api(admin).post(`/students/${student.id}/guardians`, {
        guardianId: guardian.body.id,
        relationship: 'MOTHER',
      });
      const twice = await api(admin).post(`/students/${student.id}/guardians`, {
        guardianId: guardian.body.id,
        relationship: 'MOTHER',
      });
      expect(twice.body.error.code).toBe('GUARDIAN_ALREADY_LINKED');

      const view = await api(admin).get(`/guardians/${guardian.body.id}`);
      expect(view.body.students).toEqual([
        expect.objectContaining({ studentId: student.id, isPrimary: true }),
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Acceso al portal', () => {
    it('da acceso al estudiante con el rol Estudiante y envía la activación', async () => {
      const student = await createStudent();
      const res = await api(admin).post(`/students/${student.id}/access`, {
        email: 'Sofia.Martinez@Prueba.edu.co',
      });
      expect(res.status).toBe(201);
      expect(res.body.person).toMatchObject({ hasAccess: true, accessStatus: 'INVITED' });
      expect(mail.outbox.at(-1)).toMatchObject({ to: 'sofia.martinez@prueba.edu.co' });

      const membership = await prisma.userInstitution.findFirstOrThrow({
        where: { personId: student.person.id },
        include: { roles: { include: { role: true } } },
      });
      expect(membership.roles.map((r) => r.role.code)).toEqual(['STUDENT']);

      const again = await api(admin).post(`/students/${student.id}/access`, {
        email: 'otro@prueba.edu.co',
      });
      expect(again.body.error.code).toBe('ACCESS_ALREADY_GRANTED');
    });

    it('no reutiliza un correo de otra cuenta de la institución', async () => {
      const student = await createStudent();
      const res = await api(admin).post(`/students/${student.id}/access`, {
        email: 'secretaria@prueba.edu.co',
      });
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('crea la cuenta de un docente con sus roles, con las reglas de escalamiento', async () => {
      const teacher = await api(admin).post('/staff', {
        person: person('52123456', 'Laura', 'Rincón', { documentType: 'CC' }),
        staffType: 'TEACHER',
      });
      const ok = await api(admin).post(`/staff/${teacher.body.id}/access`, {
        email: 'laura@prueba.edu.co',
        roleCodes: ['TEACHER'],
      });
      expect(ok.status).toBe(201);
      expect(ok.body.person.hasAccess).toBe(true);

      // La secretaría gestiona estudiantes pero no puede crear cuentas.
      const student = await createStudent();
      const denied = await api(secretary).post(`/students/${student.id}/access`, {
        email: 'x@prueba.edu.co',
      });
      expect(denied.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Permisos y aislamiento', () => {
    it('el coordinador consulta pero no registra ni edita', async () => {
      const student = await createStudent();
      expect((await api(coordinator).get(`/students/${student.id}`)).status).toBe(200);
      expect(
        (await api(coordinator).post('/students', { person: person('1100000099') })).status,
      ).toBe(403);
      expect((await api(coordinator).patch(`/students/${student.id}`, { code: 'X' })).status).toBe(
        403,
      );
      expect((await api(coordinator).get('/staff')).status).toBe(200);
    });

    it('la secretaría registra estudiantes y acudientes, pero no personal', async () => {
      expect(
        (await api(secretary).post('/students', { person: person('1100000050') })).status,
      ).toBe(201);
      expect(
        (
          await api(secretary).post('/guardians', {
            person: person('52000050', 'Ana', 'López', { documentType: 'CC' }),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await api(secretary).post('/staff', {
            person: person('52000051', 'Luis', 'Díaz', { documentType: 'CC' }),
            staffType: 'SUPPORT',
          })
        ).status,
      ).toBe(403);
    });

    it('nunca expone ni vincula registros de otra institución', async () => {
      const other = await seedInstitution(app, 'Otro Colegio');
      const foreignPerson = await prisma.person.create({
        data: {
          institutionId: other.id,
          documentType: 'TI',
          documentNumber: '1100000001',
          firstNames: 'Sofía',
          lastNames: 'Martínez López',
        },
      });
      const foreignStudent = await prisma.student.create({
        data: { institutionId: other.id, personId: foreignPerson.id },
      });
      const foreignGuardianPerson = await prisma.person.create({
        data: {
          institutionId: other.id,
          documentType: 'CC',
          documentNumber: '52999999',
          firstNames: 'Otra',
          lastNames: 'Persona',
        },
      });
      const foreignGuardian = await prisma.guardian.create({
        data: { institutionId: other.id, personId: foreignGuardianPerson.id },
      });

      expect((await api(admin).get(`/students/${foreignStudent.id}`)).status).toBe(404);
      expect((await api(admin).get('/students')).body.meta.total).toBe(0);

      // El mismo documento en otra institución es OTRA persona (cada colegio es responsable de sus datos).
      const mine = await createStudent('1100000001');
      expect(mine.person.id).not.toBe(foreignPerson.id);

      const link = await api(admin).post(`/students/${mine.id}/guardians`, {
        guardianId: foreignGuardian.id,
        relationship: 'MOTHER',
      });
      expect(link.status).toBe(404);
      expect((await api(admin).patch(`/students/${randomUUID()}`, { code: 'X' })).status).toBe(404);
    });
  });
});

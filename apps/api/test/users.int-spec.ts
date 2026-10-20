import { PERMISSIONS, SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailService } from '../src/infrastructure/mail/mail.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedCustomRole, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

const newUser = (overrides: Record<string, unknown> = {}) => ({
  email: 'nuevo.docente@prueba.edu.co',
  documentType: 'CC',
  documentNumber: '79123456',
  firstNames: 'Carlos Andrés',
  lastNames: 'Gómez Ruiz',
  roleCodes: [SYSTEM_ROLES.TEACHER],
  ...overrides,
});

describe('Gestión de usuarios (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let institutionId: string;
  let ids: Record<'admin' | 'admin2' | 'manager' | 'teacher' | 'foreign', string>;
  let tokens: Record<'admin' | 'admin2' | 'manager' | 'teacher', string>;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) =>
      http()
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send(body ?? {}),
    patch: (url: string, body: object) =>
      http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object) =>
      http().put(url).set('Authorization', `Bearer ${token}`).send(body),
  });

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

    // Gestor de usuarios: puede administrar cuentas, pero no tiene permisos
    // de administración institucional (no puede crear ni gestionar administradores).
    // Cubre los permisos del rol Docente (con ALL, que incluye ASSIGNED): así
    // puede crear docentes, pero no administradores.
    await seedCustomRole(app, institutionId, 'USER_MANAGER', [
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.USERS_STATUS,
      PERMISSIONS.USERS_ROLES_ASSIGN,
      PERMISSIONS.ACADEMICS_READ,
      PERMISSIONS.TEACHING_READ,
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.ENROLLMENTS_READ,
      PERMISSIONS.GRADES_READ,
      PERMISSIONS.GRADES_MANAGE,
    ]);

    const seed = (email: string, roleCode: string, firstNames: string) =>
      seedMember(app, { institutionId, email, password: PASSWORD, roleCode, firstNames });
    const admin = await seed('rectoria@prueba.edu.co', SYSTEM_ROLES.INSTITUTION_ADMIN, 'Ana');
    const admin2 = await seed(
      'vicerrectoria@prueba.edu.co',
      SYSTEM_ROLES.INSTITUTION_ADMIN,
      'Beatriz',
    );
    const manager = await seed('secretaria@prueba.edu.co', 'USER_MANAGER', 'Diana');
    const teacher = await seed('docente@prueba.edu.co', SYSTEM_ROLES.TEACHER, 'Elena');

    // Otra institución (preparación multi-tenant): sus usuarios deben ser invisibles.
    const other = await seedInstitution(app, 'Otro Colegio');
    const foreign = await seedMember(app, {
      institutionId: other.id,
      email: 'ajeno@otro.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.TEACHER,
    });

    ids = {
      admin: admin.user.id,
      admin2: admin2.user.id,
      manager: manager.user.id,
      teacher: teacher.user.id,
      foreign: foreign.user.id,
    };
    tokens = {
      admin: await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD),
      admin2: await loginAs(app, 'vicerrectoria@prueba.edu.co', PASSWORD),
      manager: await loginAs(app, 'secretaria@prueba.edu.co', PASSWORD),
      teacher: await loginAs(app, 'docente@prueba.edu.co', PASSWORD),
    };
  });

  // ---------------------------------------------------------------------------
  describe('Crear', () => {
    it('crea la cuenta invitada, envía la activación y audita', async () => {
      const res = await as(tokens.admin).post('/api/v1/users', newUser());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        email: 'nuevo.docente@prueba.edu.co',
        status: 'INVITED',
        firstNames: 'Carlos Andrés',
        roles: [{ code: 'TEACHER' }],
        lastLoginAt: null,
        activationEmail: 'SENT',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

      expect(mail.outbox.at(-1)).toMatchObject({ to: 'nuevo.docente@prueba.edu.co' });
      expect(mail.outbox.at(-1)!.text).toContain('/activar-cuenta?token=');

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'users.account.created' },
      });
      expect(entry).toMatchObject({ actorUserId: ids.admin, entityId: res.body.id, institutionId });
    });

    it('rechaza correo o documento duplicados', async () => {
      expect((await as(tokens.admin).post('/api/v1/users', newUser())).status).toBe(201);

      const sameEmail = await as(tokens.admin).post(
        '/api/v1/users',
        newUser({ documentNumber: '1' + '23456' }),
      );
      expect(sameEmail.status).toBe(409);
      expect(sameEmail.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

      const sameDocument = await as(tokens.admin).post(
        '/api/v1/users',
        newUser({ email: 'otro@prueba.edu.co' }),
      );
      expect(sameDocument.status).toBe(409);
      expect(sameDocument.body.error.code).toBe('PERSON_DOCUMENT_TAKEN');
    });

    it('valida los datos con mensajes en español', async () => {
      const res = await as(tokens.admin).post(
        '/api/v1/users',
        newUser({ email: 'no-es-correo', documentType: 'XX', firstNames: 'A', roleCodes: [] }),
      );
      expect(res.status).toBe(400);
      const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
      expect(fields).toEqual(['documentType', 'email', 'firstNames', 'roleCodes']);
      expect(JSON.stringify(res.body)).toContain('Ingresa un correo electrónico válido.');
    });

    it('rechaza roles inexistentes y campos no previstos', async () => {
      const unknownRole = await as(tokens.admin).post(
        '/api/v1/users',
        newUser({ roleCodes: ['NO_EXISTE'] }),
      );
      expect(unknownRole.status).toBe(400);
      expect(unknownRole.body.error.details[0].field).toBe('roleCodes');

      const extra = await as(tokens.admin).post('/api/v1/users', newUser({ isAdmin: true }));
      expect(extra.status).toBe(400);
    });

    it('impide crear usuarios con un rol que concede más permisos de los que tiene quien lo crea', async () => {
      const res = await as(tokens.manager).post(
        '/api/v1/users',
        newUser({ roleCodes: [SYSTEM_ROLES.INSTITUTION_ADMIN] }),
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
      expect(res.body.error.details.missingPermissions).toContain(PERMISSIONS.ROLES_MANAGE);
      expect(await prisma.user.count({ where: { email: 'nuevo.docente@prueba.edu.co' } })).toBe(0);
    });

    it('el gestor sí puede crear usuarios con roles que no exceden sus permisos', async () => {
      const res = await as(tokens.manager).post('/api/v1/users', newUser());
      expect(res.status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Listar y consultar', () => {
    it('pagina, busca y filtra', async () => {
      const page = await as(tokens.admin).get('/api/v1/users?page=1&pageSize=2');
      expect(page.status).toBe(200);
      expect(page.body.meta).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
      expect(page.body.data).toHaveLength(2);

      const search = await as(tokens.admin).get('/api/v1/users?search=elena');
      expect(search.body.data.map((u: { email: string }) => u.email)).toEqual([
        'docente@prueba.edu.co',
      ]);

      const byRole = await as(tokens.admin).get('/api/v1/users?roleCode=INSTITUTION_ADMIN');
      expect(byRole.body.meta.total).toBe(2);

      expect((await as(tokens.admin).get('/api/v1/users?pageSize=101')).status).toBe(400);
    });

    it('nunca muestra usuarios de otra institución', async () => {
      const list = await as(tokens.admin).get('/api/v1/users?pageSize=100');
      expect(list.body.data.map((u: { id: string }) => u.id)).not.toContain(ids.foreign);

      const direct = await as(tokens.admin).get(`/api/v1/users/${ids.foreign}`);
      expect(direct.status).toBe(404);
      expect(direct.body.error.code).toBe('USER_NOT_FOUND');

      // Tampoco se puede modificar manipulando el identificador.
      expect(
        (
          await as(tokens.admin).patch(`/api/v1/users/${ids.foreign}/status`, {
            status: 'SUSPENDED',
          })
        ).status,
      ).toBe(404);
    });

    it('rechaza identificadores mal formados', async () => {
      expect((await as(tokens.admin).get('/api/v1/users/no-es-uuid')).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Editar', () => {
    it('actualiza datos y audita el antes y el después', async () => {
      const res = await as(tokens.admin).patch(`/api/v1/users/${ids.teacher}`, {
        firstNames: 'Elena Sofía',
        phone: '+57 300 123 4567',
        email: 'elena.docente@prueba.edu.co',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        firstNames: 'Elena Sofía',
        phone: '+57 300 123 4567',
        email: 'elena.docente@prueba.edu.co',
      });

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'users.account.updated' },
      });
      expect(entry.changes).toMatchObject({
        firstNames: { from: 'Elena', to: 'Elena Sofía' },
        email: { from: 'docente@prueba.edu.co', to: 'elena.docente@prueba.edu.co' },
      });
      // El usuario puede iniciar sesión con el correo nuevo.
      expect(await loginAs(app, 'elena.docente@prueba.edu.co', PASSWORD)).toBeTruthy();
    });

    it('rechaza un correo ya usado por otra cuenta', async () => {
      const res = await as(tokens.admin).patch(`/api/v1/users/${ids.teacher}`, {
        email: 'rectoria@prueba.edu.co',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('el gestor no puede editar a un administrador', async () => {
      const res = await as(tokens.manager).patch(`/api/v1/users/${ids.admin}`, {
        firstNames: 'Otro',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Suspender y reactivar', () => {
    it('suspender cierra de inmediato las sesiones del usuario', async () => {
      const res = await as(tokens.admin).patch(`/api/v1/users/${ids.teacher}/status`, {
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SUSPENDED');

      const me = await as(tokens.teacher).get('/api/v1/auth/me');
      expect(me.status).toBe(401);

      const reactivated = await as(tokens.admin).patch(`/api/v1/users/${ids.teacher}/status`, {
        status: 'ACTIVE',
      });
      expect(reactivated.body.status).toBe('ACTIVE');
      expect(
        await prisma.auditLog.count({
          where: { action: { in: ['users.account.suspended', 'users.account.reactivated'] } },
        }),
      ).toBe(2);
    });

    it('nadie puede suspenderse a sí mismo', async () => {
      const res = await as(tokens.admin).patch(`/api/v1/users/${ids.admin}/status`, {
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
    });

    it('el gestor no puede suspender a un administrador', async () => {
      const res = await as(tokens.manager).patch(`/api/v1/users/${ids.admin}/status`, {
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    });

    it('impide dejar la institución sin administradores activos', async () => {
      // Un rol personalizado con todos los permisos del administrador (pero que
      // no es el rol de administrador) intenta suspender al último administrador.
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { institutionId_code: { institutionId, code: SYSTEM_ROLES.INSTITUTION_ADMIN } },
        include: { permissions: { include: { permission: true } } },
      });
      await seedCustomRole(
        app,
        institutionId,
        'SUPER',
        adminRole.permissions.map((p) => p.permission.code),
      );
      await seedMember(app, {
        institutionId,
        email: 'super@prueba.edu.co',
        password: PASSWORD,
        roleCode: 'SUPER',
      });
      const superToken = await loginAs(app, 'super@prueba.edu.co', PASSWORD);

      expect(
        (await as(superToken).patch(`/api/v1/users/${ids.admin2}/status`, { status: 'SUSPENDED' }))
          .status,
      ).toBe(200);
      const last = await as(superToken).patch(`/api/v1/users/${ids.admin}/status`, {
        status: 'SUSPENDED',
      });
      expect(last.status).toBe(409);
      expect(last.body.error.code).toBe('LAST_ADMIN');

      const removeRole = await as(superToken).put(`/api/v1/users/${ids.admin}/roles`, {
        roleCodes: ['TEACHER'],
      });
      expect(removeRole.status).toBe(409);
      expect(removeRole.body.error.code).toBe('LAST_ADMIN');
    });

    it('dos administradores que se suspenden a la vez nunca dejan la institución sin administrador', async () => {
      const results = await Promise.all([
        as(tokens.admin).patch(`/api/v1/users/${ids.admin2}/status`, { status: 'SUSPENDED' }),
        as(tokens.admin2).patch(`/api/v1/users/${ids.admin}/status`, { status: 'SUSPENDED' }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);

      const activeAdmins = await prisma.userInstitution.count({
        where: {
          institutionId,
          status: 'ACTIVE',
          roles: { some: { role: { code: SYSTEM_ROLES.INSTITUTION_ADMIN } } },
        },
      });
      expect(activeAdmins).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Roles de un usuario', () => {
    it('reemplaza los roles y audita el cambio', async () => {
      const res = await as(tokens.admin).put(`/api/v1/users/${ids.teacher}/roles`, {
        roleCodes: [SYSTEM_ROLES.TEACHER, SYSTEM_ROLES.COORDINATOR],
      });
      expect(res.status).toBe(200);
      expect(res.body.roles.map((r: { code: string }) => r.code).sort()).toEqual([
        'COORDINATOR',
        'TEACHER',
      ]);

      // El cambio de permisos se aplica en la siguiente petición, sin volver a iniciar sesión.
      const me = await as(tokens.teacher).get('/api/v1/auth/me');
      expect(me.body.permissions.map((p: { code: string }) => p.code)).toContain(
        PERMISSIONS.USERS_READ,
      );

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'users.roles.changed' },
      });
      expect(entry.changes).toEqual({
        roles: { from: ['TEACHER'], to: ['COORDINATOR', 'TEACHER'] },
      });
    });

    it('impide asignar un rol con más permisos que los del asignador', async () => {
      const res = await as(tokens.manager).put(`/api/v1/users/${ids.teacher}/roles`, {
        roleCodes: [SYSTEM_ROLES.INSTITUTION_ADMIN],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    });

    it('nadie puede cambiar sus propios roles', async () => {
      const res = await as(tokens.manager).put(`/api/v1/users/${ids.manager}/roles`, {
        roleCodes: [SYSTEM_ROLES.TEACHER],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Correo de acceso', () => {
    it('envía activación a cuentas invitadas y recuperación a cuentas activas', async () => {
      const created = await as(tokens.admin).post('/api/v1/users', newUser());
      mail.outbox.length = 0;

      const invited = await as(tokens.admin).post(`/api/v1/users/${created.body.id}/access-email`);
      expect(invited.status).toBe(202);
      expect(invited.body).toEqual({ sent: 'ACTIVATION' });
      expect(mail.outbox.at(-1)!.text).toContain('/activar-cuenta?token=');

      const active = await as(tokens.admin).post(`/api/v1/users/${ids.teacher}/access-email`);
      expect(active.body).toEqual({ sent: 'RESET' });
      expect(mail.outbox.at(-1)!.text).toContain('/restablecer-contrasena?token=');
    });

    it('si el correo no sale, la cuenta se crea igual y se informa; el reenvío falla con un error claro', async () => {
      const spy = vi.spyOn(mail, 'send').mockRejectedValue(new Error('SMTP caído'));
      try {
        const created = await as(tokens.admin).post('/api/v1/users', newUser());
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ status: 'INVITED', activationEmail: 'FAILED' });

        const resend = await as(tokens.admin).post(`/api/v1/users/${created.body.id}/access-email`);
        expect(resend.status).toBe(502);
        expect(resend.body.error.code).toBe('MAIL_DELIVERY_FAILED');
      } finally {
        spy.mockRestore();
      }
      // Con el correo restablecido, el reenvío funciona.
      const member = await prisma.user.findUniqueOrThrow({
        where: { email: 'nuevo.docente@prueba.edu.co' },
      });
      expect((await as(tokens.admin).post(`/api/v1/users/${member.id}/access-email`)).status).toBe(
        202,
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('Perfil propio', () => {
    it('cualquier usuario consulta y edita su teléfono y dirección', async () => {
      const profile = await as(tokens.teacher).get('/api/v1/me/profile');
      expect(profile.status).toBe(200);
      expect(profile.body.id).toBe(ids.teacher);

      const res = await as(tokens.teacher).patch('/api/v1/me/profile', {
        phone: '601 555 1234',
        address: 'Calle 10 # 5-20',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ phone: '601 555 1234', address: 'Calle 10 # 5-20' });
    });

    it('no permite cambiar nombres ni documento desde el perfil', async () => {
      const res = await as(tokens.teacher).patch('/api/v1/me/profile', {
        firstNames: 'Otro nombre',
      });
      expect(res.status).toBe(400);
    });
  });
});

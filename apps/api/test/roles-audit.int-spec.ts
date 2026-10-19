import { PERMISSION_CATALOG, PERMISSIONS, SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedCustomRole, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

describe('Roles y auditoría (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let institutionId: string;
  let adminToken: string;
  let limitedToken: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
    // Puede gestionar roles, pero no tiene acceso a la auditoría.
    await seedCustomRole(app, institutionId, 'ROLE_EDITOR', [
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.ROLES_MANAGE,
    ]);
    await seedMember(app, {
      institutionId,
      email: 'editor@prueba.edu.co',
      password: PASSWORD,
      roleCode: 'ROLE_EDITOR',
    });
    adminToken = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
    limitedToken = await loginAs(app, 'editor@prueba.edu.co', PASSWORD);
  });

  describe('Roles', () => {
    it('lista el catálogo de permisos con sus alcances admitidos', async () => {
      const res = await http().get('/api/v1/permissions').set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(PERMISSION_CATALOG.length);
      expect(res.body[0]).toHaveProperty('allowedScopes', ['ALL']);
    });

    it('lista los roles de sistema (no editables) con su número de usuarios', async () => {
      const res = await http().get('/api/v1/roles').set(auth(adminToken));
      const admin = res.body.find(
        (r: { code: string }) => r.code === SYSTEM_ROLES.INSTITUTION_ADMIN,
      );
      expect(admin).toMatchObject({ isSystem: true, memberCount: 1 });
      expect(res.body.filter((r: { isSystem: boolean }) => r.isSystem)).toHaveLength(7);
    });

    it('crea, edita y elimina un rol personalizado, con auditoría', async () => {
      const created = await http()
        .post('/api/v1/roles')
        .set(auth(adminToken))
        .send({
          code: 'orientador',
          name: 'Orientador escolar',
          permissions: [
            { code: PERMISSIONS.USERS_READ },
            { code: PERMISSIONS.ACADEMICS_READ, scope: 'ALL' },
          ],
        });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'ORIENTADOR', isSystem: false, memberCount: 0 });
      expect(created.body.permissions).toHaveLength(2);

      const updated = await http()
        .patch(`/api/v1/roles/${created.body.id}`)
        .set(auth(adminToken))
        .send({ name: 'Orientación', permissions: [{ code: PERMISSIONS.USERS_READ }] });
      expect(updated.status).toBe(200);
      expect(updated.body.permissions).toEqual([{ code: PERMISSIONS.USERS_READ, scope: 'ALL' }]);

      expect(
        (await http().delete(`/api/v1/roles/${created.body.id}`).set(auth(adminToken))).status,
      ).toBe(204);
      expect(
        await prisma.auditLog.count({ where: { action: { startsWith: 'access.role.' } } }),
      ).toBe(3);
      const update = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'access.role.updated' },
      });
      expect(update.changes).toMatchObject({
        name: { from: 'Orientador escolar', to: 'Orientación' },
      });
    });

    it('protege los roles de sistema y los códigos reservados', async () => {
      const system = await prisma.role.findFirstOrThrow({
        where: { institutionId, code: SYSTEM_ROLES.TEACHER },
      });
      const edit = await http()
        .patch(`/api/v1/roles/${system.id}`)
        .set(auth(adminToken))
        .send({ name: 'Profe' });
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('SYSTEM_ROLE_READ_ONLY');

      const reserved = await http()
        .post('/api/v1/roles')
        .set(auth(adminToken))
        .send({ code: 'TEACHER', name: 'Docente 2', permissions: [] });
      expect(reserved.body.error.code).toBe('ROLE_CODE_RESERVED');
    });

    it('valida permisos inexistentes, repetidos y alcances no soportados', async () => {
      const res = await http()
        .post('/api/v1/roles')
        .set(auth(adminToken))
        .send({
          code: 'MALO',
          name: 'Rol inválido',
          permissions: [
            { code: 'no.existe.nunca' },
            { code: PERMISSIONS.USERS_READ, scope: 'ASSIGNED' },
            { code: PERMISSIONS.ROLES_READ },
            { code: PERMISSIONS.ROLES_READ },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual([
        'permissions.0',
        'permissions.1',
        'permissions.3',
      ]);
    });

    it('impide crear un rol con permisos que el editor no tiene', async () => {
      const res = await http()
        .post('/api/v1/roles')
        .set(auth(limitedToken))
        .send({
          code: 'AUDITOR',
          name: 'Auditor',
          permissions: [{ code: PERMISSIONS.AUDIT_READ }],
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        code: 'PRIVILEGE_ESCALATION',
        details: { missingPermissions: [PERMISSIONS.AUDIT_READ] },
      });
    });

    it('impide eliminar un rol que tiene usuarios', async () => {
      const editor = await prisma.role.findFirstOrThrow({
        where: { institutionId, code: 'ROLE_EDITOR' },
      });
      const res = await http().delete(`/api/v1/roles/${editor.id}`).set(auth(adminToken));
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'ROLE_IN_USE', details: { memberCount: 1 } });
    });
  });

  describe('Auditoría', () => {
    it('lista solo los eventos de la institución, del más reciente al más antiguo, con su autor', async () => {
      const other = await seedInstitution(app, 'Otro Colegio');
      await prisma.auditLog.create({
        data: { institutionId: other.id, action: 'test.otra_institucion' },
      });

      const res = await http().get('/api/v1/audit-logs?pageSize=100').set(auth(adminToken));
      expect(res.status).toBe(200);
      const actions = res.body.data.map((e: { action: string }) => e.action);
      expect(actions).not.toContain('test.otra_institucion');
      expect(actions).toContain('auth.login.succeeded');

      const login = res.body.data.find(
        (e: { action: string }) => e.action === 'auth.login.succeeded',
      );
      expect(login.actor).toMatchObject({ email: expect.stringMatching(/@prueba\.edu\.co$/) });

      const dates = res.body.data.map((e: { createdAt: string }) => e.createdAt);
      expect([...dates].sort().reverse()).toEqual(dates);
    });

    it('filtra por prefijo de acción', async () => {
      const res = await http().get('/api/v1/audit-logs?action=auth.login.*').set(auth(adminToken));
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every((e: { action: string }) => e.action.startsWith('auth.login.')),
      ).toBe(true);
    });

    it('exige el permiso de auditoría', async () => {
      expect((await http().get('/api/v1/audit-logs').set(auth(limitedToken))).status).toBe(403);
    });
  });
});

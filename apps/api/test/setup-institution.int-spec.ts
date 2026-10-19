import { PERMISSION_CATALOG, SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupConfigSchema } from '../src/cli/setup-institution.config';
import { SetupInstitutionService, SetupRefusedError } from '../src/cli/setup-institution.service';
import { type PrismaClient } from '../src/generated/prisma/client';
import { AccessControlModule } from '../src/modules/access-control/access-control.module';
import { PermissionSyncService } from '../src/modules/access-control/permission-sync.service';
import { SYSTEM_ROLE_TEMPLATES } from '../src/modules/access-control/system-roles';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { createAppPrismaClient, resetDatabase } from './setup/database';
import { createTestApp } from './setup/create-test-app';

const config = setupConfigSchema.parse({
  institution: { legalName: 'Institución Educativa de Prueba', taxId: '900123456', taxIdDv: '8' },
  campuses: [
    { code: 'principal', name: 'Sede principal', isMain: true },
    { code: 'norte', name: 'Sede norte' },
  ],
  shifts: [{ code: 'manana', name: 'Mañana' }],
  admin: {
    email: 'Rectoria@Prueba.edu.co',
    documentType: 'CC',
    documentNumber: '1012345678',
    firstNames: 'Ana María',
    lastNames: 'Rodríguez Pérez',
  },
});

describe('Configuración inicial y sincronización de roles (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let setup: SetupInstitutionService;
  let sync: PermissionSyncService;
  let adminHash: string;

  beforeAll(async () => {
    app = await createTestApp({
      extraImports: [AccessControlModule],
      extraProviders: [SetupInstitutionService, PasswordHasher],
    });
    prisma = createAppPrismaClient();
    sync = app.get(PermissionSyncService);
    setup = app.get(SetupInstitutionService);
    adminHash = await app.get(PasswordHasher).hash('una frase larga y secreta');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('setup:institution', () => {
    it('crea la institución, sedes, jornadas, roles y el administrador activo', async () => {
      const result = await setup.run(config, adminHash);

      const institution = await prisma.institution.findUniqueOrThrow({
        where: { id: result.institutionId },
        include: { settings: true, campuses: true, shifts: true },
      });
      expect(institution.settings).toMatchObject({
        timezone: 'America/Bogota',
        locale: 'es-CO',
        currency: 'COP',
      });
      expect(institution.campuses.map((c) => c.code).sort()).toEqual(['NORTE', 'PRINCIPAL']);
      expect(institution.shifts.map((s) => s.code)).toEqual(['MANANA']);

      const roles = await prisma.role.findMany({ where: { institutionId: result.institutionId } });
      expect(roles.map((r) => r.code).sort()).toEqual(Object.values(SYSTEM_ROLES).sort());
      expect(roles.every((r) => r.isSystem)).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: result.adminUserId },
        include: { memberships: { include: { roles: { include: { role: true } }, person: true } } },
      });
      // El correo se normaliza a minúsculas y la contraseña se guarda con Argon2id.
      expect(user.email).toBe('rectoria@prueba.edu.co');
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]).toMatchObject({
        status: 'ACTIVE',
        institutionId: result.institutionId,
        person: { documentType: 'CC', documentNumber: '1012345678' },
      });
      expect(user.memberships[0]!.roles.map((r) => r.role.code)).toEqual([
        SYSTEM_ROLES.INSTITUTION_ADMIN,
      ]);
    });

    it('registra el evento en la auditoría sin datos sensibles', async () => {
      const result = await setup.run(config, adminHash);
      const [entry] = await prisma.auditLog.findMany({
        where: { action: 'institution.setup.completed' },
      });
      expect(entry).toMatchObject({
        institutionId: result.institutionId,
        entityId: result.institutionId,
      });
      expect(JSON.stringify(entry)).not.toContain('argon2');
    });

    it('se niega a crear una segunda institución y no modifica los datos', async () => {
      await setup.run(config, adminHash);
      const before = await prisma.institution.count();

      await expect(
        setup.run(
          { ...config, admin: { ...config.admin, email: 'otro@prueba.edu.co' } },
          adminHash,
        ),
      ).rejects.toBeInstanceOf(SetupRefusedError);

      expect(await prisma.institution.count()).toBe(before);
      expect(await prisma.user.count()).toBe(1);
    });

    it('revierte todo si falla a mitad de camino', async () => {
      // Se fuerza un fallo a mitad de la transacción con un correo ya registrado.
      await prisma.user.create({ data: { email: 'rectoria@prueba.edu.co' } });
      await expect(setup.run(config, adminHash)).rejects.toThrow();
      expect(await prisma.institution.count()).toBe(0);
      expect(await prisma.role.count()).toBe(0);
    });
  });

  describe('Sincronización de permisos y roles de sistema', () => {
    it('restaura los permisos de los roles de sistema y elimina permisos retirados', async () => {
      const { institutionId } = await setup.run(config, adminHash);
      const teacher = await prisma.role.findUniqueOrThrow({
        where: { institutionId_code: { institutionId, code: SYSTEM_ROLES.TEACHER } },
      });
      const admin = await prisma.role.findUniqueOrThrow({
        where: { institutionId_code: { institutionId, code: SYSTEM_ROLES.INSTITUTION_ADMIN } },
        include: { permissions: true },
      });

      // Alteraciones simuladas: un permiso de más en Docente, uno de menos en
      // Administrador y un permiso obsoleto que ya no existe en el catálogo.
      const audit = await prisma.permission.findUniqueOrThrow({
        where: { code: 'audit.logs.read' },
      });
      await prisma.rolePermission.create({ data: { roleId: teacher.id, permissionId: audit.id } });
      await prisma.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: admin.id,
            permissionId: admin.permissions[0]!.permissionId,
          },
        },
      });
      await prisma.permission.create({
        data: { code: 'obsoleto.recurso.accion', module: 'obsoleto', description: 'Retirado' },
      });

      await sync.syncAll();

      const permissionCodes = (await prisma.permission.findMany()).map((p) => p.code).sort();
      expect(permissionCodes).toEqual(PERMISSION_CATALOG.map((p) => p.code).sort());

      for (const template of SYSTEM_ROLE_TEMPLATES) {
        const role = await prisma.role.findUniqueOrThrow({
          where: { institutionId_code: { institutionId, code: template.code } },
          include: { permissions: { include: { permission: true } } },
        });
        expect(role.permissions.map((p) => p.permission.code).sort()).toEqual(
          template.permissions.map((p) => p.code).sort(),
        );
      }
    });

    it('es idempotente: ejecutarla dos veces no cambia nada', async () => {
      await setup.run(config, adminHash);
      await sync.syncAll();
      const snapshot = await prisma.rolePermission.findMany({
        orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
      });
      await sync.syncAll();
      expect(
        await prisma.rolePermission.findMany({
          orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
        }),
      ).toEqual(snapshot);
    });
  });
});

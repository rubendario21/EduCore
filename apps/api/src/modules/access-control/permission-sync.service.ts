import { PERMISSION_CATALOG } from '@educore/shared';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SYSTEM_ROLE_TEMPLATES } from './system-roles';

/** Clave del advisory lock: evita que dos instancias sincronicen a la vez. */
const SYNC_LOCK_KEY = 73_110_001;

/**
 * Mantiene la base alineada con el catálogo de permisos y las plantillas de
 * roles de sistema definidas en código. Se ejecuta al arrancar y es idempotente.
 */
@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncAll();
    } catch (error) {
      // Sin base de datos la API arranca igualmente y /health lo informa.
      this.logger.error(
        { err: error instanceof Error ? { name: error.name, message: error.message } : error },
        'No fue posible sincronizar permisos y roles de sistema',
      );
    }
  }

  async syncAll(): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;
        await this.syncCatalog(tx);
        const institutions = await tx.institution.findMany({ select: { id: true } });
        for (const { id } of institutions) {
          await this.syncSystemRoles(tx, id);
        }
      },
      { timeout: 30_000 },
    );
  }

  /** Inserta o actualiza los permisos del catálogo y elimina los retirados del código. */
  async syncCatalog(tx: Prisma.TransactionClient): Promise<void> {
    // Los alcances admitidos viven solo en el código (allowedScopesFor), no en la tabla.
    for (const { code, module, description } of PERMISSION_CATALOG) {
      await tx.permission.upsert({
        where: { code },
        create: { code, module, description },
        update: { module, description },
      });
    }
    const removed = await tx.permission.deleteMany({
      where: { code: { notIn: PERMISSION_CATALOG.map((p) => p.code) } },
    });
    if (removed.count > 0) {
      this.logger.warn(`Se retiraron ${removed.count} permisos que ya no existen en el catálogo`);
    }
  }

  /** Crea los roles de sistema de una institución y fija sus permisos según la plantilla. */
  async syncSystemRoles(tx: Prisma.TransactionClient, institutionId: string): Promise<void> {
    const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
    const permissionIdByCode = new Map(permissions.map((p) => [p.code, p.id]));

    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const role = await tx.role.upsert({
        where: { institutionId_code: { institutionId, code: template.code } },
        create: {
          institutionId,
          code: template.code,
          name: template.name,
          description: template.description,
          isSystem: true,
        },
        update: { name: template.name, description: template.description, isSystem: true },
      });

      const desired = template.permissions.map((p) => {
        const permissionId = permissionIdByCode.get(p.code);
        if (!permissionId) throw new Error(`El permiso ${p.code} no está en el catálogo`);
        return { permissionId, scope: p.scope };
      });

      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: desired.map((d) => d.permissionId) } },
      });
      for (const { permissionId, scope } of desired) {
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
          create: { roleId: role.id, permissionId, scope },
          update: { scope },
        });
      }
    }
  }
}

import { SYSTEM_ROLES } from '@educore/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PermissionSyncService } from '../modules/access-control/permission-sync.service';
import { AuditService } from '../modules/audit/audit.service';
import { type SetupConfig } from './setup-institution.config';

export class SetupRefusedError extends Error {}

export interface SetupResult {
  institutionId: string;
  adminUserId: string;
}

/**
 * Configuración inicial de la instalación. Todo ocurre en una sola
 * transacción: si algo falla, la base queda como estaba.
 */
@Injectable()
export class SetupInstitutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionSync: PermissionSyncService,
    private readonly audit: AuditService,
  ) {}

  async run(config: SetupConfig, adminPasswordHash: string): Promise<SetupResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // La v1 es monoinstitución: registrar un segundo colegio exige la fase
        // multi-tenant (aislamiento probado). Ver docs/00-diagnostico-y-plan.md §8.
        const existing = await tx.institution.count();
        if (existing > 0) {
          throw new SetupRefusedError(
            'Ya existe una institución configurada. Esta versión de EduCore opera con una sola institución.',
          );
        }

        const institution = await tx.institution.create({
          data: {
            ...config.institution,
            settings: { create: config.settings },
            campuses: {
              create: config.campuses.map((c) => ({ ...c, code: c.code.toUpperCase() })),
            },
            shifts: { create: config.shifts.map((s) => ({ ...s, code: s.code.toUpperCase() })) },
          },
        });

        await this.permissionSync.syncCatalog(tx);
        await this.permissionSync.syncSystemRoles(tx, institution.id);

        const adminRole = await tx.role.findUniqueOrThrow({
          where: {
            institutionId_code: {
              institutionId: institution.id,
              code: SYSTEM_ROLES.INSTITUTION_ADMIN,
            },
          },
        });

        const user = await tx.user.create({
          data: {
            email: config.admin.email,
            passwordHash: adminPasswordHash,
            passwordChangedAt: new Date(),
          },
        });

        const person = await tx.person.create({
          data: {
            institutionId: institution.id,
            documentType: config.admin.documentType,
            documentNumber: config.admin.documentNumber,
            firstNames: config.admin.firstNames,
            lastNames: config.admin.lastNames,
            email: config.admin.email,
          },
        });

        await tx.userInstitution.create({
          data: {
            userId: user.id,
            institutionId: institution.id,
            personId: person.id,
            status: 'ACTIVE',
            roles: { create: { roleId: adminRole.id } },
          },
        });

        await this.audit.record(
          {
            institutionId: institution.id,
            actorUserId: null,
            action: 'institution.setup.completed',
            entityType: 'institution',
            entityId: institution.id,
            metadata: {
              campuses: config.campuses.length,
              shifts: config.shifts.length,
              adminUserId: user.id,
              source: 'cli',
            },
          },
          tx,
        );

        return { institutionId: institution.id, adminUserId: user.id };
      },
      { timeout: 60_000 },
    );
  }
}

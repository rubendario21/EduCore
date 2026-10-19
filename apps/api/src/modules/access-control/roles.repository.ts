import { Injectable } from '@nestjs/common';
import { type PermissionScope, type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

const roleInclude = {
  permissions: { select: { scope: true, permission: { select: { code: true } } } },
  _count: { select: { memberships: true } },
} satisfies Prisma.RoleInclude;

export type RoleRecord = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

/** Consultas de roles, siempre limitadas a la institución. */
@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }

  findPermissionsByCodes(codes: string[], db: Db = this.prisma) {
    return db.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
  }

  list(institutionId: string): Promise<RoleRecord[]> {
    return this.prisma.role.findMany({
      where: { institutionId },
      include: roleInclude,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  find(institutionId: string, id: string, db: Db = this.prisma): Promise<RoleRecord | null> {
    return db.role.findFirst({ where: { id, institutionId }, include: roleInclude });
  }

  findByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.role.findUnique({
      where: { institutionId_code: { institutionId, code } },
      select: { id: true },
    });
  }

  create(
    data: { institutionId: string; code: string; name: string; description: string | null },
    db: Db,
  ) {
    return db.role.create({ data: { ...data, isSystem: false } });
  }

  update(id: string, data: { name?: string; description?: string | null }, db: Db) {
    return db.role.update({ where: { id }, data });
  }

  async replacePermissions(
    roleId: string,
    grants: Array<{ permissionId: string; scope: PermissionScope }>,
    db: Db,
  ): Promise<void> {
    await db.rolePermission.deleteMany({ where: { roleId } });
    if (grants.length > 0) {
      await db.rolePermission.createMany({ data: grants.map((g) => ({ roleId, ...g })) });
    }
  }

  delete(id: string, db: Db) {
    return db.role.delete({ where: { id } });
  }
}

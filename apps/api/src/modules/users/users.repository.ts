import { SYSTEM_ROLES } from '@educore/shared';
import { Injectable } from '@nestjs/common';
import { type MembershipStatus, type Prisma } from '../../generated/prisma/client';
import { normalizeSearch } from '../../common/search';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

const memberInclude = {
  user: { select: { id: true, email: true, lastLoginAt: true, passwordHash: true } },
  person: true,
  roles: {
    include: {
      role: {
        select: {
          id: true,
          code: true,
          name: true,
          permissions: { select: { scope: true, permission: { select: { code: true } } } },
        },
      },
    },
  },
} satisfies Prisma.UserInstitutionInclude;

export type Member = Prisma.UserInstitutionGetPayload<{ include: typeof memberInclude }>;

export const roleWithPermissions = {
  select: {
    id: true,
    code: true,
    name: true,
    permissions: { select: { scope: true, permission: { select: { code: true } } } },
  },
} satisfies Prisma.RoleDefaultArgs;

export type RoleWithPermissions = Prisma.RoleGetPayload<typeof roleWithPermissions>;

export interface ListMembersFilter {
  search?: string;
  status?: MembershipStatus;
  roleCode?: string;
  skip: number;
  take: number;
}

/**
 * Consultas de usuarios. TODAS filtran por institución: un identificador de
 * otra institución se comporta como inexistente (404), nunca como ajeno.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  /**
   * Serializa, por institución, las operaciones que pueden dejarla sin
   * administrador (suspender o quitar roles), para que dos administradores no
   * se desactiven mutuamente a la vez.
   */
  async lockAdminChanges(institutionId: string, tx: Db): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admins:${institutionId}`}))`;
  }

  async list(
    institutionId: string,
    filter: ListMembersFilter,
  ): Promise<{ items: Member[]; total: number }> {
    // Nombres y documento sin distinguir tildes (person.search_text); correo por coincidencia parcial.
    const search = filter.search
      ? {
          OR: [
            { person: { searchText: { contains: normalizeSearch(filter.search) } } },
            { user: { email: { contains: filter.search, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const where: Prisma.UserInstitutionWhereInput = {
      institutionId,
      ...(filter.status && { status: filter.status }),
      ...(filter.roleCode && { roles: { some: { role: { code: filter.roleCode } } } }),
      ...search,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.userInstitution.findMany({
        where,
        include: memberInclude,
        orderBy: [{ person: { lastNames: 'asc' } }, { person: { firstNames: 'asc' } }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.userInstitution.count({ where }),
    ]);
    return { items, total };
  }

  findMember(institutionId: string, userId: string, db: Db = this.prisma): Promise<Member | null> {
    return db.userInstitution.findUnique({
      where: { userId_institutionId: { userId, institutionId } },
      include: memberInclude,
    });
  }

  findUserByEmail(email: string, db: Db = this.prisma) {
    return db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, memberships: { select: { institutionId: true } } },
    });
  }

  findMembershipByPerson(personId: string, db: Db = this.prisma) {
    return db.userInstitution.findUnique({
      where: { personId },
      select: { id: true, userId: true, status: true },
    });
  }

  countMembershipsOfUser(userId: string, db: Db = this.prisma): Promise<number> {
    return db.userInstitution.count({ where: { userId } });
  }

  findPersonByDocument(
    institutionId: string,
    documentType: Prisma.PersonCreateInput['documentType'],
    documentNumber: string,
    db: Db = this.prisma,
  ) {
    return db.person.findUnique({
      where: {
        institutionId_documentType_documentNumber: { institutionId, documentType, documentNumber },
      },
      select: { id: true },
    });
  }

  findRolesByCodes(
    institutionId: string,
    codes: string[],
    db: Db = this.prisma,
  ): Promise<RoleWithPermissions[]> {
    return db.role.findMany({
      where: { institutionId, code: { in: codes } },
      ...roleWithPermissions,
    });
  }

  /** Administradores institucionales activos, excluyendo opcionalmente una membresía. */
  countActiveAdmins(institutionId: string, excludeMembershipId: string, db: Db = this.prisma) {
    return db.userInstitution.count({
      where: {
        institutionId,
        status: 'ACTIVE',
        id: { not: excludeMembershipId },
        user: { isActive: true },
        roles: { some: { role: { code: SYSTEM_ROLES.INSTITUTION_ADMIN } } },
      },
    });
  }

  createUser(email: string, db: Db) {
    return db.user.create({ data: { email }, select: { id: true, passwordHash: true } });
  }

  createPerson(data: Prisma.PersonUncheckedCreateInput, db: Db) {
    return db.person.create({ data });
  }

  createMembership(
    data: { userId: string; institutionId: string; personId: string; status: MembershipStatus },
    roleIds: string[],
    assignedByUserId: string,
    db: Db,
  ) {
    return db.userInstitution.create({
      data: {
        ...data,
        roles: { create: roleIds.map((roleId) => ({ roleId, assignedByUserId })) },
      },
    });
  }

  updatePerson(personId: string, data: Prisma.PersonUpdateInput, db: Db) {
    return db.person.update({ where: { id: personId }, data });
  }

  updateEmail(userId: string, email: string, db: Db) {
    return db.user.update({ where: { id: userId }, data: { email } });
  }

  setMembershipStatus(membershipId: string, status: MembershipStatus, db: Db) {
    return db.userInstitution.update({ where: { id: membershipId }, data: { status } });
  }

  async replaceRoles(membershipId: string, roleIds: string[], assignedByUserId: string, db: Db) {
    await db.membershipRole.deleteMany({ where: { membershipId, roleId: { notIn: roleIds } } });
    for (const roleId of roleIds) {
      await db.membershipRole.upsert({
        where: { membershipId_roleId: { membershipId, roleId } },
        create: { membershipId, roleId, assignedByUserId },
        update: {},
      });
    }
  }

  revokeMembershipSessions(membershipId: string, reason: string, db: Db) {
    return db.userSession.updateMany({
      where: { membershipId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}

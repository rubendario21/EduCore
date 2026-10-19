import { Injectable } from '@nestjs/common';
import { type PasswordTokenPurpose, type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

const membershipForAuth = {
  include: {
    institution: { select: { id: true, legalName: true, tradeName: true, status: true } },
    person: { select: { firstNames: true, lastNames: true } },
    roles: {
      include: {
        role: {
          select: {
            code: true,
            name: true,
            permissions: { select: { scope: true, permission: { select: { code: true } } } },
          },
        },
      },
    },
  },
} satisfies Prisma.UserInstitutionDefaultArgs;

export type MembershipForAuth = Prisma.UserInstitutionGetPayload<typeof membershipForAuth>;

const userForLogin = {
  include: { memberships: membershipForAuth },
} satisfies Prisma.UserDefaultArgs;

export type UserForLogin = Prisma.UserGetPayload<typeof userForLogin>;

const sessionForAuth = {
  include: {
    user: { select: { id: true, email: true, isActive: true } },
    membership: membershipForAuth,
  },
} satisfies Prisma.UserSessionDefaultArgs;

export type SessionForAuth = Prisma.UserSessionGetPayload<typeof sessionForAuth>;

/** Consultas de autenticación. Es la única clase del módulo que usa Prisma. */
@Injectable()
export class AuthRepository {
  constructor(readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  // --- Usuarios ---------------------------------------------------------

  findUserByEmail(email: string, db: Db = this.prisma): Promise<UserForLogin | null> {
    return db.user.findUnique({ where: { email }, ...userForLogin });
  }

  findUserById(id: string, db: Db = this.prisma): Promise<UserForLogin | null> {
    return db.user.findUnique({ where: { id }, ...userForLogin });
  }

  /** Suma un intento fallido de forma atómica y devuelve el total. */
  async incrementFailedLogins(userId: string, db: Db = this.prisma): Promise<number> {
    const user = await db.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    return user.failedLoginCount;
  }

  lockUser(userId: string, until: Date, db: Db = this.prisma) {
    return db.user.update({
      where: { id: userId },
      data: { lockedUntil: until, failedLoginCount: 0 },
    });
  }

  recordSuccessfulLogin(userId: string, newPasswordHash: string | null, db: Db = this.prisma) {
    return db.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(newPasswordHash && { passwordHash: newPasswordHash }),
      },
    });
  }

  updatePassword(userId: string, passwordHash: string, db: Db = this.prisma) {
    return db.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }

  activateInvitedMemberships(userId: string, db: Db = this.prisma) {
    return db.userInstitution.updateMany({
      where: { userId, status: 'INVITED' },
      data: { status: 'ACTIVE' },
    });
  }

  // --- Sesiones -----------------------------------------------------------

  createSession(data: Prisma.UserSessionUncheckedCreateInput, db: Db = this.prisma) {
    return db.userSession.create({ data });
  }

  findSessionById(id: string, db: Db = this.prisma): Promise<SessionForAuth | null> {
    return db.userSession.findUnique({ where: { id }, ...sessionForAuth });
  }

  findSessionByTokenHash(hash: string, db: Db = this.prisma): Promise<SessionForAuth | null> {
    return db.userSession.findUnique({ where: { refreshTokenHash: hash }, ...sessionForAuth });
  }

  /**
   * Marca la sesión como rotada solo si nadie lo hizo antes. Devuelve false si
   * otra petición se adelantó (carrera entre pestañas o reutilización del token).
   */
  async claimSessionRotation(id: string, db: Db = this.prisma): Promise<boolean> {
    const { count } = await db.userSession.updateMany({
      where: { id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    return count === 1;
  }

  async familyStartedAt(familyId: string, db: Db = this.prisma): Promise<Date | null> {
    const first = await db.userSession.findFirst({
      where: { familyId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return first?.createdAt ?? null;
  }

  revokeFamily(familyId: string, reason: string, db: Db = this.prisma) {
    return db.userSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  revokeAllUserSessions(
    userId: string,
    reason: string,
    options: { exceptFamilyId?: string } = {},
    db: Db = this.prisma,
  ) {
    return db.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(options.exceptFamilyId && { familyId: { not: options.exceptFamilyId } }),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  // --- Tokens de contraseña ----------------------------------------------

  countRecentPasswordTokens(
    userId: string,
    purpose: PasswordTokenPurpose,
    since: Date,
    db: Db = this.prisma,
  ): Promise<number> {
    return db.passwordToken.count({ where: { userId, purpose, createdAt: { gte: since } } });
  }

  /** Invalida los tokens pendientes del usuario (solo el más reciente es válido). */
  invalidatePendingPasswordTokens(userId: string, db: Db = this.prisma) {
    return db.passwordToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  createPasswordToken(data: Prisma.PasswordTokenUncheckedCreateInput, db: Db = this.prisma) {
    return db.passwordToken.create({ data });
  }

  findPasswordToken(tokenHash: string, db: Db = this.prisma) {
    return db.passwordToken.findUnique({
      where: { tokenHash },
      include: {
        user: { include: { memberships: { include: { person: true } } } },
      },
    });
  }

  /** Consume el token de forma atómica: solo una petición puede usarlo. */
  async consumePasswordToken(id: string, db: Db = this.prisma): Promise<boolean> {
    const { count } = await db.passwordToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
}

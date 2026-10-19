import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type CookieOptions, type Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { isMembershipUsable } from './auth-context';
import { AuthRepository, type MembershipForAuth, type SessionForAuth } from './auth.repository';
import { type AccessTokenPayload, type ClientInfo } from './auth.types';
import { generateOpaqueToken, sha256Hex } from './tokens';

export const REFRESH_COOKIE_NAME = 'educore_rt';
/** La cookie solo viaja a los endpoints de autenticación, no al resto de la API. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const JWT_ISSUER = 'educore-api';
export const JWT_AUDIENCE = 'educore-web';

/**
 * Margen en el que una rotación previa se considera una carrera benigna entre
 * pestañas (comparten la cookie) y no un robo del token.
 */
const ROTATION_GRACE_MS = 10_000;

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
  familyId: string;
}

export type RotationResult =
  | { kind: 'rotated'; issued: IssuedSession; session: SessionForAuth }
  | { kind: 'invalid' }
  | { kind: 'race' }
  | { kind: 'reuse'; session: SessionForAuth };

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  private daysFromNow(days: number, from = new Date()): Date {
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: this.config.auth.accessTtlSeconds,
    });
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      // Lista explícita de algoritmos: impide ataques de confusión ("alg": "none", RS/HS).
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  /** Crea una sesión (nueva familia en el login, o la siguiente de una familia al rotar). */
  async issue(
    params: {
      userId: string;
      membership: MembershipForAuth;
      client: ClientInfo;
      familyId?: string;
      expiresAt?: Date;
    },
    db?: Prisma.TransactionClient,
  ): Promise<IssuedSession> {
    const refreshToken = generateOpaqueToken();
    const familyId = params.familyId ?? randomUUID();
    const refreshExpiresAt = params.expiresAt ?? this.daysFromNow(this.config.auth.refreshTtlDays);

    const session = await this.repository.createSession(
      {
        userId: params.userId,
        membershipId: params.membership.id,
        familyId,
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: params.client.ip?.slice(0, 45),
        userAgent: params.client.userAgent?.slice(0, 300),
      },
      db,
    );

    const accessToken = await this.signAccessToken({
      sub: params.userId,
      mid: params.membership.id,
      iid: params.membership.institutionId,
      sid: session.id,
    });

    return {
      accessToken,
      expiresIn: this.config.auth.accessTtlSeconds,
      refreshToken,
      refreshExpiresAt,
      sessionId: session.id,
      familyId,
    };
  }

  /**
   * Rota el refresh token. Reutilizar un token ya rotado (fuera del margen de
   * carrera entre pestañas) indica posible robo: se revoca toda la familia.
   */
  async rotate(refreshToken: string, client: ClientInfo): Promise<RotationResult> {
    const result = await this.repository.transaction(async (tx): Promise<RotationResult> => {
      const session = await this.repository.findSessionByTokenHash(sha256Hex(refreshToken), tx);
      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return { kind: 'invalid' };
      }

      const claimed = await this.repository.claimSessionRotation(session.id, tx);
      if (!claimed) {
        const rotatedAt = session.rotatedAt?.getTime() ?? Date.now();
        return Date.now() - rotatedAt <= ROTATION_GRACE_MS
          ? { kind: 'race' }
          : { kind: 'reuse', session };
      }

      if (!session.user.isActive || !isMembershipUsable(session.membership)) {
        await this.repository.revokeFamily(session.familyId, 'ACCOUNT_DISABLED', tx);
        return { kind: 'invalid' };
      }

      // Duración deslizante, con un tope absoluto desde el inicio de sesión.
      const startedAt =
        (await this.repository.familyStartedAt(session.familyId, tx)) ?? session.createdAt;
      const absoluteLimit = this.daysFromNow(this.config.auth.refreshAbsoluteTtlDays, startedAt);
      const sliding = this.daysFromNow(this.config.auth.refreshTtlDays);
      const expiresAt = sliding < absoluteLimit ? sliding : absoluteLimit;
      if (expiresAt <= new Date()) {
        await this.repository.revokeFamily(session.familyId, 'ABSOLUTE_EXPIRY', tx);
        return { kind: 'invalid' };
      }

      const issued = await this.issue(
        {
          userId: session.userId,
          membership: session.membership,
          client,
          familyId: session.familyId,
          expiresAt,
        },
        tx,
      );
      return { kind: 'rotated', issued, session };
    });

    // La revocación por reutilización se confirma fuera de la transacción
    // anterior, para que persista aunque la petición termine en error.
    if (result.kind === 'reuse') {
      await this.repository.revokeFamily(result.session.familyId, 'REUSE_DETECTED');
      await this.audit.record({
        institutionId: result.session.membership.institutionId,
        actorUserId: result.session.userId,
        action: 'auth.session.reuse_detected',
        entityType: 'user_session',
        entityId: result.session.id,
        metadata: { familyId: result.session.familyId },
        context: client,
      });
      this.logger.warn(
        { userId: result.session.userId, familyId: result.session.familyId },
        'Reutilización de refresh token detectada: familia de sesiones revocada',
      );
    }

    return result;
  }

  async revokeByRefreshToken(refreshToken: string): Promise<SessionForAuth | null> {
    const session = await this.repository.findSessionByTokenHash(sha256Hex(refreshToken));
    if (session) await this.repository.revokeFamily(session.familyId, 'LOGOUT');
    return session;
  }

  // --- Cookie -------------------------------------------------------------

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.auth.cookieSecure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  setRefreshCookie(res: Response, issued: IssuedSession): void {
    res.cookie(REFRESH_COOKIE_NAME, issued.refreshToken, {
      ...this.cookieOptions(),
      expires: issued.refreshExpiresAt,
    });
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }
}

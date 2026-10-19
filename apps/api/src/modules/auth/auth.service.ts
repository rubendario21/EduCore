import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { type AuthUserView, isMembershipUsable, toAuthUserView } from './auth-context';
import { AuthErrors } from './auth.errors';
import { AuthRepository, type UserForLogin } from './auth.repository';
import { type AuthContext, type ClientInfo } from './auth.types';
import { PasswordHasher } from './password-hasher';
import { type IssuedSession, SessionService } from './session.service';

export interface AuthenticatedSession {
  issued: IssuedSession;
  user: AuthUserView;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessions: SessionService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Inicio de sesión. Todas las respuestas negativas previas a verificar la
   * contraseña son idénticas, para no revelar qué correos existen.
   */
  async login(email: string, password: string, client: ClientInfo): Promise<AuthenticatedSession> {
    const user = await this.repository.findUserByEmail(email);
    // La v1 es monoinstitución: la membresía relevante es la única del usuario.
    const membership = user?.memberships[0];

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.auditLogin('auth.login.blocked', user, client);
      throw AuthErrors.accountLocked(Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
    }

    // Se verifica siempre (con un hash ficticio si no hay usuario) para que el
    // tiempo de respuesta no delate si la cuenta existe.
    const passwordOk = await this.hasher.verify(user?.passwordHash, password);

    if (!user || !membership || !passwordOk) {
      if (user) await this.registerFailedAttempt(user, client);
      else await this.auditLogin('auth.login.failed', null, client, { reason: 'UNKNOWN_EMAIL' });
      throw AuthErrors.invalidCredentials();
    }

    if (!user.isActive || !isMembershipUsable(membership)) {
      await this.auditLogin('auth.login.rejected', user, client, { reason: 'ACCOUNT_SUSPENDED' });
      throw AuthErrors.accountSuspended();
    }

    const rehash = this.hasher.needsRehash(user.passwordHash!)
      ? await this.hasher.hash(password)
      : null;
    await this.repository.recordSuccessfulLogin(user.id, rehash);

    const issued = await this.sessions.issue({ userId: user.id, membership, client });
    await this.auditLogin('auth.login.succeeded', user, client, {
      sessionFamilyId: issued.familyId,
    });

    return { issued, user: toAuthUserView(user, membership) };
  }

  async refresh(
    refreshToken: string | undefined,
    client: ClientInfo,
  ): Promise<AuthenticatedSession> {
    if (!refreshToken) throw AuthErrors.sessionInvalid();

    const result = await this.sessions.rotate(refreshToken, client);
    switch (result.kind) {
      case 'rotated':
        return {
          issued: result.issued,
          user: toAuthUserView(result.session.user, result.session.membership),
        };
      case 'race':
        throw AuthErrors.sessionRotated();
      default:
        throw AuthErrors.sessionInvalid();
    }
  }

  async logout(refreshToken: string | undefined, client: ClientInfo): Promise<void> {
    if (!refreshToken) return;
    const session = await this.sessions.revokeByRefreshToken(refreshToken);
    if (session) {
      await this.audit.record({
        institutionId: session.membership.institutionId,
        actorUserId: session.userId,
        action: 'auth.logout',
        entityType: 'user_session',
        entityId: session.id,
        context: client,
      });
    }
  }

  async me(auth: AuthContext): Promise<AuthUserView> {
    const user = await this.repository.findUserById(auth.userId);
    const membership = user?.memberships.find((m) => m.id === auth.membershipId);
    if (!user || !membership) throw AuthErrors.sessionInvalid();
    return toAuthUserView(user, membership);
  }

  private async registerFailedAttempt(user: UserForLogin, client: ClientInfo): Promise<void> {
    const { maxFailedAttempts, lockoutMinutes } = this.config.auth;
    const failures = await this.repository.incrementFailedLogins(user.id);
    if (failures >= maxFailedAttempts) {
      await this.repository.lockUser(user.id, new Date(Date.now() + lockoutMinutes * 60_000));
      await this.auditLogin('auth.account.locked', user, client, { failures, lockoutMinutes });
    } else {
      await this.auditLogin('auth.login.failed', user, client, {
        reason: 'INVALID_PASSWORD',
        failures,
      });
    }
  }

  private auditLogin(
    action: string,
    user: UserForLogin | null,
    client: ClientInfo,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      institutionId: user?.memberships[0]?.institutionId ?? null,
      actorUserId: user?.id ?? null,
      action,
      entityType: user ? 'user' : undefined,
      entityId: user?.id,
      metadata,
      context: client,
    });
  }
}

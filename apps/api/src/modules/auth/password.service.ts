import { Injectable, Logger } from '@nestjs/common';
import { ValidationException } from '../../common/errors/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { type PasswordTokenPurpose, type Prisma } from '../../generated/prisma/client';
import { type MailMessage, MailService } from '../../infrastructure/mail/mail.service';
import { accountActivationEmail, passwordResetEmail } from '../../infrastructure/mail/templates';
import { AuditService } from '../audit/audit.service';
import { AuthErrors } from './auth.errors';
import { AuthRepository, type UserForLogin } from './auth.repository';
import { type AuthContext, type ClientInfo } from './auth.types';
import { PasswordHasher } from './password-hasher';
import { checkPasswordPolicy } from './password-policy';
import { generateOpaqueToken, sha256Hex } from './tokens';

const RESET_TTL_MINUTES = 30;
const ACTIVATION_TTL_HOURS = 72;
/** Máximo de enlaces de recuperación por cuenta y hora (evita usar EduCore para inundar buzones). */
const MAX_RESET_REQUESTS_PER_HOUR = 3;

export const RESET_PATH = '/restablecer-contrasena';
export const ACTIVATION_PATH = '/activar-cuenta';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Solicitud de recuperación. Siempre termina sin error (el controlador
   * responde 202), exista o no la cuenta.
   */
  async requestReset(email: string, client: ClientInfo): Promise<void> {
    const user = await this.repository.findUserByEmail(email);
    const membership = user?.memberships[0];
    if (!user || !user.isActive || !membership || membership.status === 'SUSPENDED') return;

    const since = new Date(Date.now() - 60 * 60_000);
    const recent = await this.repository.countRecentPasswordTokens(user.id, 'RESET', since);
    if (recent >= MAX_RESET_REQUESTS_PER_HOUR) return;

    const token = await this.createToken(user.id, 'RESET', RESET_TTL_MINUTES * 60_000);
    await this.audit.record({
      institutionId: membership.institutionId,
      actorUserId: user.id,
      action: 'auth.password.reset_requested',
      entityType: 'user',
      entityId: user.id,
      context: client,
    });

    this.sendInBackground(
      passwordResetEmail({
        to: user.email,
        name: membership.person.firstNames,
        institutionName: membership.institution.tradeName ?? membership.institution.legalName,
        url: `${this.config.appPublicUrl}${RESET_PATH}?token=${encodeURIComponent(token)}`,
        expiresInMinutes: RESET_TTL_MINUTES,
      }),
    );
  }

  /**
   * Prepara el enlace de activación de una cuenta nueva (lo usa la gestión de
   * usuarios). Se llama dentro de la transacción que crea la cuenta y devuelve
   * el correo, que el llamador envía con `deliver` SOLO tras confirmarla: así
   * nunca se envía un enlace de una cuenta que finalmente no se creó.
   */
  async prepareActivation(user: UserForLogin, tx: Prisma.TransactionClient): Promise<MailMessage> {
    const membership = user.memberships[0];
    if (!membership) throw new Error('La cuenta no tiene membresía');
    const token = await this.createToken(
      user.id,
      'ACTIVATION',
      ACTIVATION_TTL_HOURS * 3_600_000,
      tx,
    );
    return accountActivationEmail({
      to: user.email,
      name: membership.person.firstNames,
      institutionName: membership.institution.tradeName ?? membership.institution.legalName,
      url: `${this.config.appPublicUrl}${ACTIVATION_PATH}?token=${encodeURIComponent(token)}`,
      expiresInHours: ACTIVATION_TTL_HOURS,
    });
  }

  /**
   * Prepara un enlace de recuperación solicitado por un administrador (mismo
   * patrón que la activación: se envía con `deliver` tras confirmar).
   */
  async prepareReset(user: UserForLogin, tx: Prisma.TransactionClient): Promise<MailMessage> {
    const membership = user.memberships[0];
    if (!membership) throw new Error('La cuenta no tiene membresía');
    const token = await this.createToken(user.id, 'RESET', RESET_TTL_MINUTES * 60_000, tx);
    return passwordResetEmail({
      to: user.email,
      name: membership.person.firstNames,
      institutionName: membership.institution.tradeName ?? membership.institution.legalName,
      url: `${this.config.appPublicUrl}${RESET_PATH}?token=${encodeURIComponent(token)}`,
      expiresInMinutes: RESET_TTL_MINUTES,
    });
  }

  /** Envía un correo preparado previamente (p. ej. la activación tras confirmar la transacción). */
  deliver(message: MailMessage): void {
    this.sendInBackground(message);
  }

  /** Define una contraseña con un token de recuperación o de activación. */
  async resetWithToken(token: string, newPassword: string, client: ClientInfo): Promise<void> {
    const record = await this.repository.findPasswordToken(sha256Hex(token));
    if (!record || record.usedAt || record.expiresAt <= new Date() || !record.user.isActive) {
      throw AuthErrors.invalidOrExpiredToken();
    }

    // La política se valida antes de consumir el token, para que un error de
    // validación no obligue a pedir un enlace nuevo.
    const person = record.user.memberships[0]?.person;
    this.assertPolicy(newPassword, {
      email: record.user.email,
      firstNames: person?.firstNames,
      lastNames: person?.lastNames,
    });
    const passwordHash = await this.hasher.hash(newPassword);

    await this.repository.transaction(async (tx) => {
      if (!(await this.repository.consumePasswordToken(record.id, tx))) {
        throw AuthErrors.invalidOrExpiredToken();
      }
      await this.repository.updatePassword(record.userId, passwordHash, tx);
      await this.repository.invalidatePendingPasswordTokens(record.userId, tx);
      await this.repository.revokeAllUserSessions(record.userId, 'PASSWORD_RESET', {}, tx);
      if (
        record.purpose === 'ACTIVATION' ||
        record.user.memberships.some((m) => m.status === 'INVITED')
      ) {
        await this.repository.activateInvitedMemberships(record.userId, tx);
      }
      await this.audit.record(
        {
          institutionId: record.user.memberships[0]?.institutionId ?? null,
          actorUserId: record.userId,
          action:
            record.purpose === 'ACTIVATION' ? 'auth.account.activated' : 'auth.password.reset',
          entityType: 'user',
          entityId: record.userId,
          context: client,
        },
        tx,
      );
    });
  }

  /** Cambio de contraseña con sesión iniciada. Cierra las demás sesiones del usuario. */
  async change(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ) {
    const user = await this.repository.findUserById(auth.userId);
    if (!user) throw AuthErrors.sessionInvalid();
    if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
      throw AuthErrors.currentPasswordInvalid();
    }
    if (currentPassword === newPassword) {
      throw new ValidationException([
        { field: 'newPassword', messages: ['Debe ser distinta de la contraseña actual.'] },
      ]);
    }
    const person = user.memberships.find((m) => m.id === auth.membershipId)?.person;
    this.assertPolicy(newPassword, {
      email: user.email,
      firstNames: person?.firstNames,
      lastNames: person?.lastNames,
    });
    const passwordHash = await this.hasher.hash(newPassword);

    await this.repository.transaction(async (tx) => {
      await this.repository.updatePassword(user.id, passwordHash, tx);
      await this.repository.invalidatePendingPasswordTokens(user.id, tx);
      await this.repository.revokeAllUserSessions(
        user.id,
        'PASSWORD_CHANGED',
        { exceptFamilyId: auth.familyId },
        tx,
      );
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: user.id,
          action: 'auth.password.changed',
          entityType: 'user',
          entityId: user.id,
          context: client,
        },
        tx,
      );
    });
  }

  private assertPolicy(password: string, context: Parameters<typeof checkPasswordPolicy>[1]): void {
    const problems = checkPasswordPolicy(password, context);
    if (problems.length > 0) {
      throw new ValidationException([{ field: 'newPassword', messages: problems }]);
    }
  }

  private async createToken(
    userId: string,
    purpose: PasswordTokenPurpose,
    ttlMs: number,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const token = generateOpaqueToken();
    await this.repository.invalidatePendingPasswordTokens(userId, tx);
    await this.repository.createPasswordToken(
      { userId, purpose, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlMs) },
      tx,
    );
    return token;
  }

  /**
   * El correo se envía sin esperar la respuesta del proveedor: así el tiempo de
   * respuesta no revela si la cuenta existe, y un fallo del SMTP no rompe el flujo.
   */
  private sendInBackground(message: MailMessage): void {
    this.mail.send(message).catch((error: unknown) => {
      this.logger.error(
        { err: error instanceof Error ? { name: error.name, message: error.message } : error },
        'No fue posible enviar el correo',
      );
    });
  }
}

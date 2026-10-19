import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenExpiredError } from '@nestjs/jwt';
import { buildAuthContext, isMembershipUsable } from '../auth-context';
import { AuthErrors } from '../auth.errors';
import { AuthRepository } from '../auth.repository';
import { type AccessTokenPayload } from '../auth.types';
import { type AuthenticatedRequest, IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { SessionService } from '../session.service';

/**
 * Guard global: toda ruta exige un token de acceso válido salvo las marcadas
 * con @Public(). Además del JWT, comprueba en la base que la sesión no se haya
 * revocado y que la cuenta siga activa, de modo que un logout o una suspensión
 * tengan efecto inmediato (sin esperar a que el token expire).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly repository: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw AuthErrors.unauthenticated();

    let payload: AccessTokenPayload;
    try {
      payload = await this.sessions.verifyAccessToken(token);
    } catch (error) {
      throw error instanceof TokenExpiredError
        ? AuthErrors.accessTokenExpired()
        : AuthErrors.unauthenticated();
    }

    const session = await this.repository.findSessionById(payload.sid);
    if (
      !session ||
      session.revokedAt ||
      session.userId !== payload.sub ||
      session.membershipId !== payload.mid ||
      !session.user.isActive ||
      !isMembershipUsable(session.membership)
    ) {
      throw AuthErrors.sessionInvalid();
    }

    request.auth = buildAuthContext({
      userId: session.userId,
      email: session.user.email,
      sessionId: session.id,
      familyId: session.familyId,
      membership: session.membership,
    });
    return true;
  }
}

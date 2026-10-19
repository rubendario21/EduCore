import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthErrors } from '../../auth/auth.errors';
import { type AuthenticatedRequest, IS_PUBLIC_KEY } from '../../auth/decorators/auth.decorators';
import { type PermissionCode } from '@educore/shared';
import { AccessErrors, AUTHENTICATED_KEY, PERMISSIONS_KEY } from '../authorization';

/**
 * Autorización global con "denegar por defecto": toda ruta debe declarar
 * @Public(), @Authenticated() o @RequirePermissions(...). Una ruta sin
 * declaración se rechaza siempre (y la prueba de rutas lo detecta antes).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Falla cerrado si, por un error de orden de los guards, no hay identidad.
    if (!request.auth) throw AuthErrors.unauthenticated();

    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    if (required && required.length > 0) {
      // Basta con tener el permiso con algún alcance; cada servicio filtra los
      // datos según el alcance concedido (ver scopesOf).
      if (required.every((code) => request.auth!.permissions.has(code))) return true;
      throw AccessErrors.forbidden();
    }

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) return true;

    this.logger.error(
      { path: request.path, method: request.method },
      'Ruta sin declaración de acceso (@Public, @Authenticated o @RequirePermissions): denegada',
    );
    throw AccessErrors.forbidden();
  }
}

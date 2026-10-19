import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { type Request } from 'express';
import { AppConfigService } from '../../../config/app-config.service';
import { AuthErrors } from '../auth.errors';

export const CSRF_HEADER = 'x-educore-csrf';

/**
 * Protección CSRF para los endpoints que actúan con la cookie de sesión
 * (renovar y cerrar sesión). Además de SameSite=Strict en la cookie:
 * 1. Exige un encabezado propio: un formulario o enlace de otro sitio no puede
 *    enviarlo, y desde JavaScript de otro origen obliga a un preflight CORS que
 *    la API rechaza.
 * 2. Si el navegador envía Origin, debe ser uno de los orígenes autorizados.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(config: AppConfigService) {
    this.allowedOrigins = new Set(config.webOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers[CSRF_HEADER] !== '1') throw AuthErrors.csrfCheckFailed();
    const origin = request.headers.origin;
    if (origin !== undefined && !this.allowedOrigins.has(origin))
      throw AuthErrors.csrfCheckFailed();
    return true;
  }
}

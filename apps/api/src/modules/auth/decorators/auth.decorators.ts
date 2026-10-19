import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type Request } from 'express';
import { type AuthContext, type ClientInfo } from '../auth.types';

export const IS_PUBLIC_KEY = 'educore:isPublic';
export const AUTH_RATE_LIMIT_KEY = 'educore:authRateLimit';

/** El endpoint no requiere sesión (login, recuperación, health, marca pública). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Aplica el límite estricto de intentos por IP de los endpoints sensibles
 * (login, recuperación, renovación), además del límite global.
 */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

export type AuthenticatedRequest = Request & { auth?: AuthContext; id?: string };

/** Contexto del usuario autenticado. Falla si se usa en un endpoint público. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) {
    throw new Error('CurrentAuth usado en un endpoint sin autenticación');
  }
  return request.auth;
});

export function clientInfoFrom(request: AuthenticatedRequest): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    requestId: request.id ? String(request.id) : null,
  };
}

/** Datos del cliente (IP, user-agent, requestId) para sesiones y auditoría. */
export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  clientInfoFrom(ctx.switchToHttp().getRequest<AuthenticatedRequest>()),
);

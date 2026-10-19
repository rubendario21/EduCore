import { type PermissionCode, type PermissionScope } from '@educore/shared';
import { HttpStatus, SetMetadata } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { type AuthContext } from '../auth/auth.types';

export const PERMISSIONS_KEY = 'educore:permissions';
export const AUTHENTICATED_KEY = 'educore:authenticated';

/**
 * El endpoint exige TODOS los permisos indicados. El alcance de los datos
 * (ALL, ASSIGNED…) lo aplica después el servicio con `scopesOf`.
 */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** El endpoint solo exige sesión iniciada (p. ej. el perfil propio). */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);

export interface PermissionGrant {
  code: string;
  scope: PermissionScope;
}

export function scopesOf(auth: AuthContext, code: PermissionCode): ReadonlySet<PermissionScope> {
  return auth.permissions.get(code) ?? new Set();
}

export function hasPermission(
  auth: AuthContext,
  code: PermissionCode,
  scope: PermissionScope = 'ALL',
) {
  const scopes = scopesOf(auth, code);
  return scopes.has('ALL') || scopes.has(scope);
}

/**
 * Permisos que el actor NO posee de una lista. Se usa para impedir la escalada
 * de privilegios: nadie puede conceder (a un rol o a una persona) más de lo
 * que él mismo tiene. Tener un permiso con alcance ALL cubre cualquier alcance.
 */
export function missingGrants(
  actor: ReadonlyMap<string, ReadonlySet<PermissionScope>>,
  grants: readonly PermissionGrant[],
): PermissionGrant[] {
  return grants.filter(({ code, scope }) => {
    const scopes = actor.get(code);
    return !scopes || !(scopes.has('ALL') || scopes.has(scope));
  });
}

export const AccessErrors = {
  forbidden: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'No tienes permiso para realizar esta operación.',
    ),

  privilegeEscalation: (missing: PermissionGrant[]) =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'PRIVILEGE_ESCALATION',
      'No puedes conceder ni gestionar permisos que tú no tienes.',
      { missingPermissions: missing.map((m) => m.code) },
    ),

  cannotModifySelf: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'CANNOT_MODIFY_SELF',
      'No puedes cambiar tu propio estado ni tus propios roles. Pídelo a otro administrador.',
    ),

  lastAdmin: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'LAST_ADMIN',
      'La institución debe conservar al menos un administrador institucional activo.',
    ),
};

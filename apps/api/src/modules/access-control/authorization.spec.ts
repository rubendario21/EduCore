import { type PermissionScope } from '@educore/shared';
import { type ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../../common/errors/app.exception';
import { type AuthContext } from '../auth/auth.types';
import { IS_PUBLIC_KEY } from '../auth/decorators/auth.decorators';
import { AUTHENTICATED_KEY, missingGrants, PERMISSIONS_KEY } from './authorization';
import { PermissionsGuard } from './guards/permissions.guard';

function perms(entries: Record<string, PermissionScope[]>): Map<string, Set<PermissionScope>> {
  return new Map(Object.entries(entries).map(([code, scopes]) => [code, new Set(scopes)]));
}

describe('missingGrants (prevención de escalada de privilegios)', () => {
  const actor = perms({ 'users.accounts.read': ['ALL'], 'academics.structure.read': ['ASSIGNED'] });

  it('no reporta faltantes si el actor tiene todos los permisos', () => {
    expect(missingGrants(actor, [{ code: 'users.accounts.read', scope: 'ALL' }])).toEqual([]);
  });

  it('el alcance ALL cubre cualquier alcance', () => {
    expect(missingGrants(actor, [{ code: 'users.accounts.read', scope: 'ASSIGNED' }])).toEqual([]);
  });

  it('un alcance parcial no permite conceder ALL', () => {
    expect(missingGrants(actor, [{ code: 'academics.structure.read', scope: 'ALL' }])).toEqual([
      { code: 'academics.structure.read', scope: 'ALL' },
    ]);
  });

  it('reporta los permisos que el actor no posee', () => {
    expect(
      missingGrants(actor, [
        { code: 'users.accounts.read', scope: 'ALL' },
        { code: 'access.roles.manage', scope: 'ALL' },
      ]),
    ).toEqual([{ code: 'access.roles.manage', scope: 'ALL' }]);
  });
});

describe('PermissionsGuard (denegar por defecto)', () => {
  afterEach(() => vi.restoreAllMocks());

  function contextWith(metadata: Record<string, unknown>, auth?: Partial<AuthContext>) {
    const handler = () => undefined;
    for (const [key, value] of Object.entries(metadata))
      Reflect.defineMetadata(key, value, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ auth, path: '/api/v1/prueba', method: 'GET' }),
      }),
    } as unknown as ExecutionContext;
  }

  const guard = new PermissionsGuard(new Reflector());
  const auth = { permissions: perms({ 'users.accounts.read': ['ALL'] }) };

  it('permite las rutas públicas sin sesión', () => {
    expect(guard.canActivate(contextWith({ [IS_PUBLIC_KEY]: true }))).toBe(true);
  });

  it('permite la ruta si el usuario tiene el permiso requerido', () => {
    expect(
      guard.canActivate(contextWith({ [PERMISSIONS_KEY]: ['users.accounts.read'] }, auth)),
    ).toBe(true);
  });

  it('exige TODOS los permisos declarados', () => {
    const ctx = contextWith(
      { [PERMISSIONS_KEY]: ['users.accounts.read', 'users.accounts.create'] },
      auth,
    );
    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it('permite @Authenticated a cualquier usuario con sesión', () => {
    expect(
      guard.canActivate(contextWith({ [AUTHENTICATED_KEY]: true }, { permissions: new Map() })),
    ).toBe(true);
  });

  it('deniega y registra una ruta sin declaración de acceso', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(() => guard.canActivate(contextWith({}, auth))).toThrow(AppException);
    expect(error).toHaveBeenCalledOnce();
  });

  it('falla cerrado si no hay identidad en una ruta protegida', () => {
    try {
      guard.canActivate(contextWith({ [PERMISSIONS_KEY]: ['users.accounts.read'] }));
      expect.unreachable();
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(401);
    }
  });
});

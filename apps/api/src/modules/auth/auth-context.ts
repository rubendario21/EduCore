import { type PermissionScope } from '@educore/shared';
import { type MembershipForAuth } from './auth.repository';
import { type AuthContext } from './auth.types';

export interface AuthUserView {
  id: string;
  email: string;
  firstNames: string;
  lastNames: string;
  institution: { id: string; name: string };
  roles: Array<{ code: string; name: string }>;
  permissions: Array<{ code: string; scopes: PermissionScope[] }>;
}

/** Une los permisos de todos los roles de la membresía (con sus alcances). */
export function collectPermissions(
  membership: MembershipForAuth,
): Map<string, Set<PermissionScope>> {
  const permissions = new Map<string, Set<PermissionScope>>();
  for (const { role } of membership.roles) {
    for (const { scope, permission } of role.permissions) {
      const scopes = permissions.get(permission.code) ?? new Set<PermissionScope>();
      scopes.add(scope);
      permissions.set(permission.code, scopes);
    }
  }
  return permissions;
}

export function buildAuthContext(params: {
  userId: string;
  email: string;
  sessionId: string;
  familyId: string;
  membership: MembershipForAuth;
}): AuthContext {
  return {
    userId: params.userId,
    email: params.email,
    membershipId: params.membership.id,
    institutionId: params.membership.institutionId,
    sessionId: params.sessionId,
    familyId: params.familyId,
    roleCodes: params.membership.roles.map((r) => r.role.code),
    permissions: collectPermissions(params.membership),
  };
}

/** Vista del usuario para la web: solo lo necesario para la sesión y el menú. */
export function toAuthUserView(
  user: { id: string; email: string },
  membership: MembershipForAuth,
): AuthUserView {
  return {
    id: user.id,
    email: user.email,
    firstNames: membership.person.firstNames,
    lastNames: membership.person.lastNames,
    institution: {
      id: membership.institution.id,
      name: membership.institution.tradeName ?? membership.institution.legalName,
    },
    roles: membership.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
    permissions: [...collectPermissions(membership)]
      .map(([code, scopes]) => ({ code, scopes: [...scopes].sort() }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** La membresía permite operar: activa y en una institución activa. */
export function isMembershipUsable(membership: MembershipForAuth): boolean {
  return membership.status === 'ACTIVE' && membership.institution.status === 'ACTIVE';
}

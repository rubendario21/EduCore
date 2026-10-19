import { allowedScopesFor, PERMISSION_CATALOG, SYSTEM_ROLES } from '@educore/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AppException,
  type FieldError,
  ValidationException,
} from '../../common/errors/app.exception';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService, diffChanges } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { AccessErrors, missingGrants, type PermissionGrant } from './authorization';
import {
  type CreateRoleDto,
  type PermissionDto,
  type RoleDto,
  type RolePermissionInputDto,
  type UpdateRoleDto,
} from './dto/roles.dto';
import { type RoleRecord, RolesRepository } from './roles.repository';

const RoleErrors = {
  notFound: () => new AppException(HttpStatus.NOT_FOUND, 'ROLE_NOT_FOUND', 'El rol no existe.'),
  codeTaken: () =>
    new AppException(HttpStatus.CONFLICT, 'ROLE_CODE_TAKEN', 'Ya existe un rol con ese código.'),
  codeReserved: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ROLE_CODE_RESERVED',
      'Ese código está reservado para un rol de sistema.',
    ),
  systemReadOnly: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'SYSTEM_ROLE_READ_ONLY',
      'Los roles de sistema no se pueden modificar ni eliminar.',
    ),
  inUse: (count: number) =>
    new AppException(
      HttpStatus.CONFLICT,
      'ROLE_IN_USE',
      `El rol está asignado a ${count} usuario(s). Quítalo de esos usuarios antes de eliminarlo.`,
      { memberCount: count },
    ),
};

function toRoleDto(role: RoleRecord): RoleDto {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    memberCount: role._count.memberships,
    permissions: role.permissions
      .map((p) => ({ code: p.permission.code, scope: p.scope }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function grantsOf(role: RoleRecord): PermissionGrant[] {
  return role.permissions.map((p) => ({ code: p.permission.code, scope: p.scope }));
}

@Injectable()
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly audit: AuditService,
  ) {}

  listPermissions(): PermissionDto[] {
    return PERMISSION_CATALOG.map((p) => ({
      code: p.code,
      module: p.module,
      description: p.description,
      allowedScopes: [...allowedScopesFor(p.code)],
    }));
  }

  async list(auth: AuthContext): Promise<RoleDto[]> {
    return (await this.repository.list(auth.institutionId)).map(toRoleDto);
  }

  async get(auth: AuthContext, id: string): Promise<RoleDto> {
    const role = await this.repository.find(auth.institutionId, id);
    if (!role) throw RoleErrors.notFound();
    return toRoleDto(role);
  }

  async create(auth: AuthContext, dto: CreateRoleDto, client: ClientInfo): Promise<RoleDto> {
    if ((Object.values(SYSTEM_ROLES) as string[]).includes(dto.code))
      throw RoleErrors.codeReserved();
    const grants = this.validateGrants(dto.permissions);
    this.assertCanGrant(auth, grants);

    const created = await this.repository.transaction(async (tx) => {
      if (await this.repository.findByCode(auth.institutionId, dto.code, tx))
        throw RoleErrors.codeTaken();
      const role = await this.repository.create(
        {
          institutionId: auth.institutionId,
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
        },
        tx,
      );
      await this.repository.replacePermissions(role.id, await this.resolveGrants(grants, tx), tx);
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'access.role.created',
          entityType: 'role',
          entityId: role.id,
          metadata: { code: dto.code, permissions: grants.map((g) => `${g.code}:${g.scope}`) },
          context: client,
        },
        tx,
      );
      return (await this.repository.find(auth.institutionId, role.id, tx))!;
    });
    return toRoleDto(created);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateRoleDto,
    client: ClientInfo,
  ): Promise<RoleDto> {
    const grants = dto.permissions ? this.validateGrants(dto.permissions) : null;

    const updated = await this.repository.transaction(async (tx) => {
      const role = await this.requireEditable(auth, id, tx);
      if (grants) this.assertCanGrant(auth, grants);

      await this.repository.update(role.id, { name: dto.name, description: dto.description }, tx);
      if (grants) {
        await this.repository.replacePermissions(role.id, await this.resolveGrants(grants, tx), tx);
      }

      const after = (await this.repository.find(auth.institutionId, role.id, tx))!;
      const before = grantsOf(role)
        .map((g) => `${g.code}:${g.scope}`)
        .sort();
      const now = grantsOf(after)
        .map((g) => `${g.code}:${g.scope}`)
        .sort();
      const changes = {
        ...diffChanges(role, after, ['name', 'description']),
        ...(JSON.stringify(before) !== JSON.stringify(now) && {
          permissions: { from: before, to: now },
        }),
      };
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            action: 'access.role.updated',
            entityType: 'role',
            entityId: role.id,
            changes,
            context: client,
          },
          tx,
        );
      }
      return after;
    });
    return toRoleDto(updated);
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const role = await this.requireEditable(auth, id, tx);
      if (role._count.memberships > 0) throw RoleErrors.inUse(role._count.memberships);
      await this.repository.delete(role.id, tx);
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'access.role.deleted',
          entityType: 'role',
          entityId: role.id,
          metadata: { code: role.code, name: role.name },
          context: client,
        },
        tx,
      );
    });
  }

  /** Rol personalizado de la institución que el actor puede gestionar. */
  private async requireEditable(auth: AuthContext, id: string, tx: Prisma.TransactionClient) {
    const role = await this.repository.find(auth.institutionId, id, tx);
    if (!role) throw RoleErrors.notFound();
    if (role.isSystem) throw RoleErrors.systemReadOnly();
    // Tampoco se puede editar un rol que concede más de lo que el actor tiene.
    this.assertCanGrant(auth, grantsOf(role));
    return role;
  }

  /** Permisos del catálogo, sin repetir y con alcances que el módulo sabe aplicar. */
  private validateGrants(input: RolePermissionInputDto[]): PermissionGrant[] {
    const problems: FieldError[] = [];
    const seen = new Set<string>();
    input.forEach((grant, index) => {
      const field = `permissions.${index}`;
      const allowed = allowedScopesFor(grant.code);
      if (allowed.length === 0) {
        problems.push({ field, messages: [`El permiso ${grant.code} no existe.`] });
      } else if (!allowed.includes(grant.scope)) {
        problems.push({
          field,
          messages: [`El permiso ${grant.code} solo admite el alcance ${allowed.join(', ')}.`],
        });
      }
      if (seen.has(grant.code))
        problems.push({ field, messages: [`El permiso ${grant.code} está repetido.`] });
      seen.add(grant.code);
    });
    if (problems.length > 0) throw new ValidationException(problems);
    return input.map((g) => ({ code: g.code, scope: g.scope }));
  }

  private assertCanGrant(auth: AuthContext, grants: PermissionGrant[]): void {
    const missing = missingGrants(auth.permissions, grants);
    if (missing.length > 0) throw AccessErrors.privilegeEscalation(missing);
  }

  private async resolveGrants(grants: PermissionGrant[], tx: Prisma.TransactionClient) {
    const permissions = await this.repository.findPermissionsByCodes(
      grants.map((g) => g.code),
      tx,
    );
    const idByCode = new Map(permissions.map((p) => [p.code, p.id]));
    return grants.map((g) => ({ permissionId: idByCode.get(g.code)!, scope: g.scope }));
  }
}

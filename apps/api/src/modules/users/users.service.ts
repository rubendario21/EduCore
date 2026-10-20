import { SYSTEM_ROLES } from '@educore/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';
import { paginated, type Paginated, toPrismaPage } from '../../common/pagination/pagination';
import { type MembershipStatus, type Prisma } from '../../generated/prisma/client';
import { type MailMessage } from '../../infrastructure/mail/mail.service';
import { AccessErrors, missingGrants, type PermissionGrant } from '../access-control/authorization';
import { AuditService, diffChanges } from '../audit/audit.service';
import { AuthRepository } from '../auth/auth.repository';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import {
  type CreateUserDto,
  type ListUsersQueryDto,
  type UpdateProfileDto,
  type UpdateUserDto,
  type UserDto,
} from './dto/users.dto';
import { type Member, type RoleWithPermissions, UsersRepository } from './users.repository';

export const UserErrors = {
  mailDeliveryFailed: () =>
    new AppException(
      HttpStatus.BAD_GATEWAY,
      'MAIL_DELIVERY_FAILED',
      'No fue posible enviar el correo. Revisa la configuración del correo (SMTP) e inténtalo de nuevo.',
    ),
  notFound: () => new AppException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'El usuario no existe.'),
  emailTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'EMAIL_ALREADY_REGISTERED',
      'Ya existe un usuario con ese correo electrónico.',
    ),
  emailManagedElsewhere: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'EMAIL_MANAGED_ELSEWHERE',
      'El correo de esta cuenta no puede cambiarse desde aquí porque la cuenta pertenece también a otra institución.',
    ),
  documentTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'PERSON_DOCUMENT_TAKEN',
      'Ya existe una persona con ese tipo y número de documento en la institución.',
    ),
  accessAlreadyGranted: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACCESS_ALREADY_GRANTED',
      'Esta persona ya tiene acceso a EduCore.',
    ),
  suspended: () =>
    new AppException(HttpStatus.CONFLICT, 'USER_SUSPENDED', 'El usuario está suspendido.'),
};

function toDate(value: string | null | undefined): Date | null | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? null
      : new Date(`${value}T00:00:00.000Z`);
}

function grantsOfRoles(roles: Array<Pick<RoleWithPermissions, 'permissions'>>): PermissionGrant[] {
  return roles.flatMap((role) =>
    role.permissions.map((p) => ({ code: p.permission.code, scope: p.scope })),
  );
}

export function toUserDto(member: Member): UserDto {
  return {
    id: member.user.id,
    membershipId: member.id,
    email: member.user.email,
    status: member.status,
    firstNames: member.person.firstNames,
    lastNames: member.person.lastNames,
    documentType: member.person.documentType,
    documentNumber: member.person.documentNumber,
    birthDate: member.person.birthDate?.toISOString().slice(0, 10) ?? null,
    phone: member.person.phone,
    address: member.person.address,
    roles: member.roles
      .map(({ role }) => ({ id: role.id, code: role.code, name: role.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    lastLoginAt: member.user.lastLoginAt?.toISOString() ?? null,
    createdAt: member.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly authRepository: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, query: ListUsersQueryDto): Promise<Paginated<UserDto>> {
    const { items, total } = await this.repository.list(auth.institutionId, {
      search: query.search,
      status: query.status,
      roleCode: query.roleCode,
      ...toPrismaPage(query),
    });
    return paginated(items.map(toUserDto), total, query);
  }

  async get(auth: AuthContext, userId: string): Promise<UserDto> {
    return toUserDto(await this.requireMember(auth, userId));
  }

  async create(auth: AuthContext, dto: CreateUserDto, client: ClientInfo): Promise<UserDto> {
    const roles = await this.requireRoles(auth, dto.roleCodes);
    this.assertCanGrant(auth, roles);

    // Contenedor (no variable suelta): se asigna dentro de la transacción.
    const pending: { mail?: MailMessage } = {};
    const member = await this.repository.transaction(async (tx) => {
      const existingUser = await this.repository.findUserByEmail(dto.email, tx);
      if (existingUser?.memberships.some((m) => m.institutionId === auth.institutionId)) {
        throw UserErrors.emailTaken();
      }
      if (
        await this.repository.findPersonByDocument(
          auth.institutionId,
          dto.documentType,
          dto.documentNumber,
          tx,
        )
      ) {
        throw UserErrors.documentTaken();
      }

      // Una cuenta global puede existir por otra institución (fase multi-tenant):
      // se vincula en lugar de duplicarla.
      const user = existingUser ?? (await this.repository.createUser(dto.email, tx));
      const person = await this.repository.createPerson(
        {
          institutionId: auth.institutionId,
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
          firstNames: dto.firstNames,
          lastNames: dto.lastNames,
          birthDate: toDate(dto.birthDate),
          email: dto.email,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
        },
        tx,
      );
      const status: MembershipStatus = user.passwordHash ? 'ACTIVE' : 'INVITED';
      await this.repository.createMembership(
        { userId: user.id, institutionId: auth.institutionId, personId: person.id, status },
        roles.map((r) => r.id),
        auth.userId,
        tx,
      );

      if (!user.passwordHash) {
        const forMail = await this.authRepository.findUserById(user.id, tx);
        pending.mail = await this.passwords.prepareActivation(forMail!, tx);
      }

      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'users.account.created',
          entityType: 'user',
          entityId: user.id,
          metadata: {
            email: dto.email,
            roles: roles.map((r) => r.code),
            linkedExistingAccount: !!existingUser,
          },
          context: client,
        },
        tx,
      );
      return (await this.repository.findMember(auth.institutionId, user.id, tx))!;
    });

    return { ...toUserDto(member), activationEmail: await this.deliverActivation(pending.mail) };
  }

  /** Envía la invitación ya confirmada y dice si salió (null si no hacía falta). */
  private async deliverActivation(
    mail: MailMessage | undefined,
  ): Promise<'SENT' | 'FAILED' | null> {
    if (!mail) return null;
    return (await this.passwords.deliverNow(mail)) ? 'SENT' : 'FAILED';
  }

  async update(
    auth: AuthContext,
    userId: string,
    dto: UpdateUserDto,
    client: ClientInfo,
  ): Promise<UserDto> {
    const updated = await this.repository.transaction(async (tx) => {
      const member = await this.requireMember(auth, userId, tx);
      if (member.user.id !== auth.userId) this.assertCanManage(auth, member);

      if (dto.email && dto.email !== member.user.email) {
        if (await this.repository.findUserByEmail(dto.email, tx)) throw UserErrors.emailTaken();
        if ((await this.repository.countMembershipsOfUser(member.user.id, tx)) > 1) {
          throw UserErrors.emailManagedElsewhere();
        }
        await this.repository.updateEmail(member.user.id, dto.email, tx);
      }

      const documentType = dto.documentType ?? member.person.documentType;
      const documentNumber = dto.documentNumber ?? member.person.documentNumber;
      if (
        documentType !== member.person.documentType ||
        documentNumber !== member.person.documentNumber
      ) {
        const other = await this.repository.findPersonByDocument(
          auth.institutionId,
          documentType,
          documentNumber,
          tx,
        );
        if (other && other.id !== member.person.id) throw UserErrors.documentTaken();
      }

      await this.repository.updatePerson(
        member.person.id,
        {
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
          firstNames: dto.firstNames,
          lastNames: dto.lastNames,
          birthDate: toDate(dto.birthDate),
          phone: dto.phone,
          address: dto.address,
          ...(dto.email && { email: dto.email }),
        },
        tx,
      );

      const after = (await this.repository.findMember(auth.institutionId, userId, tx))!;
      const changes = {
        ...diffChanges({ email: member.user.email }, { email: after.user.email }, ['email']),
        ...diffChanges(member.person, after.person, [
          'documentType',
          'documentNumber',
          'firstNames',
          'lastNames',
          'birthDate',
          'phone',
          'address',
        ]),
      };
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            action: 'users.account.updated',
            entityType: 'user',
            entityId: userId,
            changes,
            context: client,
          },
          tx,
        );
      }
      return after;
    });
    return toUserDto(updated);
  }

  async setStatus(
    auth: AuthContext,
    userId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    client: ClientInfo,
  ): Promise<UserDto> {
    if (userId === auth.userId) throw AccessErrors.cannotModifySelf();

    const updated = await this.repository.transaction(async (tx) => {
      await this.repository.lockAdminChanges(auth.institutionId, tx);
      const member = await this.requireMember(auth, userId, tx);
      this.assertCanManage(auth, member);

      // Reactivar una cuenta que nunca definió contraseña la deja invitada.
      const target: MembershipStatus =
        status === 'ACTIVE' && !member.user.passwordHash ? 'INVITED' : status;
      if (member.status === target) return member;
      if (status === 'ACTIVE' && member.status === 'INVITED') return member;

      if (status === 'SUSPENDED' && this.isActiveAdmin(member)) {
        await this.assertAnotherAdminRemains(auth.institutionId, member.id, tx);
      }

      await this.repository.setMembershipStatus(member.id, target, tx);
      if (target === 'SUSPENDED') {
        await this.repository.revokeMembershipSessions(member.id, 'ACCOUNT_SUSPENDED', tx);
      }
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: target === 'SUSPENDED' ? 'users.account.suspended' : 'users.account.reactivated',
          entityType: 'user',
          entityId: userId,
          changes: { status: { from: member.status, to: target } },
          context: client,
        },
        tx,
      );
      return (await this.repository.findMember(auth.institutionId, userId, tx))!;
    });
    return toUserDto(updated);
  }

  async setRoles(
    auth: AuthContext,
    userId: string,
    roleCodes: string[],
    client: ClientInfo,
  ): Promise<UserDto> {
    if (userId === auth.userId) throw AccessErrors.cannotModifySelf();
    const roles = await this.requireRoles(auth, roleCodes);
    this.assertCanGrant(auth, roles);

    const updated = await this.repository.transaction(async (tx) => {
      await this.repository.lockAdminChanges(auth.institutionId, tx);
      const member = await this.requireMember(auth, userId, tx);
      this.assertCanManage(auth, member);

      const removesAdmin =
        this.isActiveAdmin(member) && !roles.some((r) => r.code === SYSTEM_ROLES.INSTITUTION_ADMIN);
      if (removesAdmin) await this.assertAnotherAdminRemains(auth.institutionId, member.id, tx);

      const before = member.roles.map((r) => r.role.code).sort();
      const after = roles.map((r) => r.code).sort();
      if (JSON.stringify(before) === JSON.stringify(after)) return member;

      await this.repository.replaceRoles(
        member.id,
        roles.map((r) => r.id),
        auth.userId,
        tx,
      );
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'users.roles.changed',
          entityType: 'user',
          entityId: userId,
          changes: { roles: { from: before, to: after } },
          context: client,
        },
        tx,
      );
      return (await this.repository.findMember(auth.institutionId, userId, tx))!;
    });
    return toUserDto(updated);
  }

  /** Envía el enlace de activación (cuenta invitada) o de recuperación (cuenta activa). */
  async sendAccessEmail(
    auth: AuthContext,
    userId: string,
    client: ClientInfo,
  ): Promise<'ACTIVATION' | 'RESET'> {
    const pending: { mail?: MailMessage } = {};
    const kind = await this.repository.transaction(async (tx) => {
      const member = await this.requireMember(auth, userId, tx);
      if (member.user.id !== auth.userId) this.assertCanManage(auth, member);
      if (member.status === 'SUSPENDED') throw UserErrors.suspended();

      const user = (await this.authRepository.findUserById(member.user.id, tx))!;
      const purpose = member.user.passwordHash ? 'RESET' : 'ACTIVATION';
      pending.mail =
        purpose === 'RESET'
          ? await this.passwords.prepareReset(user, tx)
          : await this.passwords.prepareActivation(user, tx);
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: purpose === 'RESET' ? 'users.password_reset.sent' : 'users.activation.sent',
          entityType: 'user',
          entityId: userId,
          context: client,
        },
        tx,
      );
      return purpose;
    });
    if (pending.mail && !(await this.passwords.deliverNow(pending.mail))) {
      throw UserErrors.mailDeliveryFailed();
    }
    return kind;
  }

  // --- Acceso al portal para personas ya registradas ---------------------

  /**
   * Da acceso a EduCore a una persona que ya existe en la institución (un
   * estudiante, acudiente o miembro del personal): crea o vincula la cuenta,
   * la membresía con los roles indicados y envía la activación. Aplica las
   * mismas reglas que el alta de usuarios (roles válidos, sin escalamiento,
   * correo único).
   */
  async grantAccessToPerson(
    auth: AuthContext,
    personId: string,
    email: string,
    roleCodes: string[],
    client: ClientInfo,
    tx?: Prisma.TransactionClient,
  ): Promise<UserDto> {
    const roles = await this.requireRoles(auth, roleCodes);
    this.assertCanGrant(auth, roles);

    const pending: { mail?: MailMessage } = {};
    const run = async (db: Prisma.TransactionClient) => {
      if (await this.repository.findMembershipByPerson(personId, db))
        throw UserErrors.accessAlreadyGranted();
      const existingUser = await this.repository.findUserByEmail(email, db);
      if (existingUser?.memberships.some((m) => m.institutionId === auth.institutionId)) {
        throw UserErrors.emailTaken();
      }
      const user = existingUser ?? (await this.repository.createUser(email, db));
      await this.repository.createMembership(
        {
          userId: user.id,
          institutionId: auth.institutionId,
          personId,
          status: user.passwordHash ? 'ACTIVE' : 'INVITED',
        },
        roles.map((r) => r.id),
        auth.userId,
        db,
      );
      if (!user.passwordHash) {
        const forMail = await this.authRepository.findUserById(user.id, db);
        pending.mail = await this.passwords.prepareActivation(forMail!, db);
      }
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'users.access.granted',
          entityType: 'user',
          entityId: user.id,
          metadata: { personId, email, roles: roles.map((r) => r.code) },
          context: client,
        },
        db,
      );
      return (await this.repository.findMember(auth.institutionId, user.id, db))!;
    };

    const member = tx ? await run(tx) : await this.repository.transaction(run);
    return { ...toUserDto(member), activationEmail: await this.deliverActivation(pending.mail) };
  }

  // --- Perfil propio ------------------------------------------------------

  async getProfile(auth: AuthContext): Promise<UserDto> {
    return toUserDto(await this.requireMember(auth, auth.userId));
  }

  async updateProfile(
    auth: AuthContext,
    dto: UpdateProfileDto,
    client: ClientInfo,
  ): Promise<UserDto> {
    const updated = await this.repository.transaction(async (tx) => {
      const member = await this.requireMember(auth, auth.userId, tx);
      await this.repository.updatePerson(
        member.person.id,
        { phone: dto.phone, address: dto.address },
        tx,
      );
      const after = (await this.repository.findMember(auth.institutionId, auth.userId, tx))!;
      const changes = diffChanges(member.person, after.person, ['phone', 'address']);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            action: 'users.profile.updated',
            entityType: 'user',
            entityId: auth.userId,
            changes,
            context: client,
          },
          tx,
        );
      }
      return after;
    });
    return toUserDto(updated);
  }

  // --- Reglas internas ----------------------------------------------------

  private async requireMember(auth: AuthContext, userId: string, tx?: Prisma.TransactionClient) {
    const member = await this.repository.findMember(auth.institutionId, userId, tx);
    if (!member) throw UserErrors.notFound();
    return member;
  }

  private async requireRoles(auth: AuthContext, codes: string[]): Promise<RoleWithPermissions[]> {
    const roles = await this.repository.findRolesByCodes(auth.institutionId, codes);
    const unknown = codes.filter((code) => !roles.some((r) => r.code === code));
    if (unknown.length > 0) {
      throw new ValidationException([
        { field: 'roleCodes', messages: [`Roles inexistentes: ${unknown.join(', ')}`] },
      ]);
    }
    return roles;
  }

  /** Nadie concede, mediante roles, permisos que no tiene. */
  private assertCanGrant(auth: AuthContext, roles: RoleWithPermissions[]): void {
    const missing = missingGrants(auth.permissions, grantsOfRoles(roles));
    if (missing.length > 0) throw AccessErrors.privilegeEscalation(missing);
  }

  /** Nadie gestiona a un usuario con permisos que él no tiene. */
  private assertCanManage(auth: AuthContext, member: Member): void {
    const missing = missingGrants(auth.permissions, grantsOfRoles(member.roles.map((r) => r.role)));
    if (missing.length > 0) throw AccessErrors.privilegeEscalation(missing);
  }

  private isActiveAdmin(member: Member): boolean {
    return (
      member.status === 'ACTIVE' &&
      member.roles.some((r) => r.role.code === SYSTEM_ROLES.INSTITUTION_ADMIN)
    );
  }

  private async assertAnotherAdminRemains(
    institutionId: string,
    membershipId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if ((await this.repository.countActiveAdmins(institutionId, membershipId, tx)) === 0) {
      throw AccessErrors.lastAdmin();
    }
  }
}

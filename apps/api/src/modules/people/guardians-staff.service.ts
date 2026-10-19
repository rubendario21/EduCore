import { SYSTEM_ROLES } from '@educore/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { paginated, type Paginated, toPrismaPage } from '../../common/pagination/pagination';
import { toDateOnly } from '../../common/validation/colombia';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { UsersService } from '../users/users.service';
import {
  type CreateGuardianDto,
  type CreateStaffDto,
  type ListGuardiansQueryDto,
  type ListStaffQueryDto,
  type UpdateGuardianDto,
  type UpdateStaffDto,
} from './dto/people.dto';
import { PeopleRepository } from './people.repository';
import { guardianView, type GuardianView, staffView, type StaffView } from './people.views';
import { PersonResolver } from './person-resolver';

type Tx = Prisma.TransactionClient;

const Errors = {
  guardianNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'GUARDIAN_NOT_FOUND', 'El acudiente no existe.'),
  guardianExists: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'GUARDIAN_ALREADY_EXISTS',
      'Esta persona ya está registrada como acudiente.',
    ),
  staffNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'STAFF_NOT_FOUND', 'El miembro del personal no existe.'),
  staffExists: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'STAFF_ALREADY_EXISTS',
      'Esta persona ya está registrada en el personal.',
    ),
};

function auditEvent(
  auth: AuthContext,
  client: ClientInfo,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  return {
    institutionId: auth.institutionId,
    actorUserId: auth.userId,
    action,
    entityType,
    entityId,
    metadata,
    context: client,
  };
}

@Injectable()
export class GuardiansService {
  constructor(
    private readonly repository: PeopleRepository,
    private readonly persons: PersonResolver,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  private async require(auth: AuthContext, id: string, tx?: Tx) {
    const guardian = await this.repository.findGuardian(auth.institutionId, id, tx);
    if (!guardian) throw Errors.guardianNotFound();
    return guardian;
  }

  async list(auth: AuthContext, query: ListGuardiansQueryDto): Promise<Paginated<GuardianView>> {
    const { items, total } = await this.repository.listGuardians(auth.institutionId, {
      search: query.search,
      ...toPrismaPage(query),
    });
    return paginated(items.map(guardianView), total, query);
  }

  async get(auth: AuthContext, id: string): Promise<GuardianView> {
    return guardianView(await this.require(auth, id));
  }

  async create(
    auth: AuthContext,
    dto: CreateGuardianDto,
    client: ClientInfo,
  ): Promise<GuardianView> {
    const id = await this.repository.transaction(async (tx) => {
      const { person, reused } = await this.persons.findOrCreate(
        auth.institutionId,
        dto.person,
        tx,
      );
      if (person.guardian) throw Errors.guardianExists();
      const guardian = await this.repository.createGuardian(
        {
          institutionId: auth.institutionId,
          personId: person.id,
          occupation: dto.occupation ?? null,
          workplace: dto.workplace ?? null,
        },
        tx,
      );
      await this.audit.record(
        auditEvent(auth, client, 'guardians.guardian.created', 'guardian', guardian.id, {
          personId: person.id,
          reusedPerson: reused,
        }),
        tx,
      );
      return guardian.id;
    });
    return this.get(auth, id);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateGuardianDto,
    client: ClientInfo,
  ): Promise<GuardianView> {
    await this.repository.transaction(async (tx) => {
      const guardian = await this.require(auth, id, tx);
      if (dto.person)
        await this.persons.update(
          auth.institutionId,
          guardian.personId,
          guardian.person,
          dto.person,
          tx,
        );
      await this.repository.updateGuardian(
        id,
        { occupation: dto.occupation, workplace: dto.workplace },
        tx,
      );
      await this.audit.record(
        auditEvent(auth, client, 'guardians.guardian.updated', 'guardian', id, {
          fields: [
            ...Object.keys(dto.person ?? {}).map((f) => `person.${f}`),
            ...Object.keys(dto).filter((k) => k !== 'person'),
          ],
        }),
        tx,
      );
    });
    return this.get(auth, id);
  }

  /** Da acceso al portal al acudiente (rol Acudiente) y envía la activación. */
  async grantAccess(
    auth: AuthContext,
    id: string,
    email: string,
    client: ClientInfo,
  ): Promise<GuardianView> {
    const guardian = await this.require(auth, id);
    await this.users.grantAccessToPerson(
      auth,
      guardian.personId,
      email,
      [SYSTEM_ROLES.GUARDIAN],
      client,
    );
    return this.get(auth, id);
  }
}

@Injectable()
export class StaffService {
  constructor(
    private readonly repository: PeopleRepository,
    private readonly persons: PersonResolver,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  private async require(auth: AuthContext, id: string, tx?: Tx) {
    const member = await this.repository.findStaff(auth.institutionId, id, tx);
    if (!member) throw Errors.staffNotFound();
    return member;
  }

  async list(auth: AuthContext, query: ListStaffQueryDto): Promise<Paginated<StaffView>> {
    const { items, total } = await this.repository.listStaff(auth.institutionId, {
      search: query.search,
      staffType: query.staffType,
      status: query.status,
      ...toPrismaPage(query),
    });
    return paginated(items.map(staffView), total, query);
  }

  async get(auth: AuthContext, id: string): Promise<StaffView> {
    return staffView(await this.require(auth, id));
  }

  async create(auth: AuthContext, dto: CreateStaffDto, client: ClientInfo): Promise<StaffView> {
    const id = await this.repository.transaction(async (tx) => {
      const { person, reused } = await this.persons.findOrCreate(
        auth.institutionId,
        dto.person,
        tx,
      );
      if (person.staff) throw Errors.staffExists();
      const member = await this.repository.createStaff(
        {
          institutionId: auth.institutionId,
          personId: person.id,
          staffType: dto.staffType,
          title: dto.title ?? null,
          hireDate: dto.hireDate ? toDateOnly(dto.hireDate) : null,
        },
        tx,
      );
      await this.audit.record(
        auditEvent(auth, client, 'staff.member.created', 'staff_member', member.id, {
          personId: person.id,
          staffType: dto.staffType,
          reusedPerson: reused,
        }),
        tx,
      );
      return member.id;
    });
    return this.get(auth, id);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateStaffDto,
    client: ClientInfo,
  ): Promise<StaffView> {
    await this.repository.transaction(async (tx) => {
      const member = await this.require(auth, id, tx);
      if (dto.person)
        await this.persons.update(
          auth.institutionId,
          member.personId,
          member.person,
          dto.person,
          tx,
        );
      await this.repository.updateStaff(
        id,
        {
          staffType: dto.staffType,
          title: dto.title,
          hireDate:
            dto.hireDate === undefined ? undefined : dto.hireDate ? toDateOnly(dto.hireDate) : null,
          status: dto.status,
        },
        tx,
      );
      await this.audit.record(
        auditEvent(auth, client, 'staff.member.updated', 'staff_member', id, {
          fields: [
            ...Object.keys(dto.person ?? {}).map((f) => `person.${f}`),
            ...Object.keys(dto).filter((k) => k !== 'person'),
          ],
          ...(dto.status &&
            dto.status !== member.status && { status: { from: member.status, to: dto.status } }),
        }),
        tx,
      );
    });
    return this.get(auth, id);
  }

  /** Crea la cuenta de acceso del miembro del personal con los roles indicados. */
  async grantAccess(
    auth: AuthContext,
    id: string,
    email: string,
    roleCodes: string[],
    client: ClientInfo,
  ): Promise<StaffView> {
    const member = await this.require(auth, id);
    await this.users.grantAccessToPerson(auth, member.personId, email, roleCodes, client);
    return this.get(auth, id);
  }
}

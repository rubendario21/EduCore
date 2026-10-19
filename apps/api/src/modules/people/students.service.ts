import { SYSTEM_ROLES } from '@educore/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';
import { paginated, type Paginated, toPrismaPage } from '../../common/pagination/pagination';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { UsersService } from '../users/users.service';
import {
  type CreateStudentDto,
  type LinkGuardianDto,
  type ListStudentsQueryDto,
  type UpdateGuardianLinkDto,
  type UpdateStudentDto,
} from './dto/people.dto';
import { PeopleRepository, type StudentRecord } from './people.repository';
import { studentView, type StudentView } from './people.views';
import { PersonResolver } from './person-resolver';

type Tx = Prisma.TransactionClient;

export const StudentErrors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'STUDENT_NOT_FOUND', 'El estudiante no existe.'),
  alreadyExists: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'STUDENT_ALREADY_EXISTS',
      'Esta persona ya está registrada como estudiante.',
    ),
  codeTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'STUDENT_CODE_TAKEN',
      'Ya existe un estudiante con ese código.',
    ),
  guardianNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'GUARDIAN_NOT_FOUND', 'El acudiente no existe.'),
  alreadyLinked: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'GUARDIAN_ALREADY_LINKED',
      'El acudiente ya está vinculado a este estudiante.',
    ),
  selfLink: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'GUARDIAN_IS_STUDENT',
      'Un estudiante no puede ser su propio acudiente.',
    ),
  linkNotFound: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'LINK_NOT_FOUND',
      'El acudiente no está vinculado a este estudiante.',
    ),
  primaryRequired: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'PRIMARY_GUARDIAN_REQUIRED',
      'El estudiante debe conservar un acudiente principal. Marca otro acudiente como principal primero.',
    ),
};

@Injectable()
export class StudentsService {
  constructor(
    private readonly repository: PeopleRepository,
    private readonly persons: PersonResolver,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  private record(
    auth: AuthContext,
    client: ClientInfo,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    tx: Tx,
  ) {
    return this.audit.record(
      {
        institutionId: auth.institutionId,
        actorUserId: auth.userId,
        action,
        entityType: 'student',
        entityId,
        metadata,
        context: client,
      },
      tx,
    );
  }

  private async require(auth: AuthContext, id: string, tx?: Tx): Promise<StudentRecord> {
    const student = await this.repository.findStudent(auth.institutionId, id, tx);
    if (!student) throw StudentErrors.notFound();
    return student;
  }

  async list(auth: AuthContext, query: ListStudentsQueryDto): Promise<Paginated<StudentView>> {
    const { items, total } = await this.repository.listStudents(auth.institutionId, {
      search: query.search,
      status: query.status,
      ...toPrismaPage(query),
    });
    return paginated(items.map(studentView), total, query);
  }

  async get(auth: AuthContext, id: string): Promise<StudentView> {
    return studentView(await this.require(auth, id));
  }

  async create(auth: AuthContext, dto: CreateStudentDto, client: ClientInfo): Promise<StudentView> {
    const id = await this.repository.transaction(async (tx) => {
      const { person, reused } = await this.persons.findOrCreate(
        auth.institutionId,
        dto.person,
        tx,
      );
      if (person.student) throw StudentErrors.alreadyExists();
      if (dto.code && (await this.repository.findStudentByCode(auth.institutionId, dto.code, tx))) {
        throw StudentErrors.codeTaken();
      }
      const student = await this.repository.createStudent(
        { institutionId: auth.institutionId, personId: person.id, code: dto.code ?? null },
        tx,
      );
      await this.record(
        auth,
        client,
        'students.student.created',
        student.id,
        { personId: person.id, reusedPerson: reused },
        tx,
      );
      return student.id;
    });
    return this.get(auth, id);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateStudentDto,
    client: ClientInfo,
  ): Promise<StudentView> {
    await this.repository.transaction(async (tx) => {
      const student = await this.require(auth, id, tx);
      if (dto.person)
        await this.persons.update(
          auth.institutionId,
          student.personId,
          student.person,
          dto.person,
          tx,
        );
      if (
        dto.code &&
        dto.code !== student.code &&
        (await this.repository.findStudentByCode(auth.institutionId, dto.code, tx))
      ) {
        throw StudentErrors.codeTaken();
      }
      await this.repository.updateStudent(id, { code: dto.code, status: dto.status }, tx);
      await this.record(
        auth,
        client,
        'students.student.updated',
        id,
        {
          fields: [
            ...Object.keys(dto.person ?? {}).map((f) => `person.${f}`),
            ...Object.keys(dto).filter((k) => k !== 'person'),
          ],
          ...(dto.status &&
            dto.status !== student.status && { status: { from: student.status, to: dto.status } }),
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  // --- Acudientes del estudiante -------------------------------------------

  async linkGuardian(
    auth: AuthContext,
    studentId: string,
    dto: LinkGuardianDto,
    client: ClientInfo,
  ): Promise<StudentView> {
    if (!dto.guardianId && !dto.person) {
      throw new ValidationException([
        {
          field: 'guardianId',
          messages: ['Selecciona un acudiente registrado o ingresa los datos de uno nuevo.'],
        },
      ]);
    }
    await this.repository.transaction(async (tx) => {
      const student = await this.repository.lockStudent(auth.institutionId, studentId, tx);
      if (!student) throw StudentErrors.notFound();

      let guardianId = dto.guardianId;
      if (guardianId) {
        if (!(await this.repository.findGuardian(auth.institutionId, guardianId, tx)))
          throw StudentErrors.guardianNotFound();
      } else {
        // Acudiente nuevo, o persona existente (p. ej. una docente) que pasa a ser acudiente.
        const { person } = await this.persons.findOrCreate(auth.institutionId, dto.person!, tx);
        guardianId =
          person.guardian?.id ??
          (
            await this.repository.createGuardian(
              {
                institutionId: auth.institutionId,
                personId: person.id,
                occupation: dto.occupation ?? null,
              },
              tx,
            )
          ).id;
      }

      const guardian = await this.repository.findGuardian(auth.institutionId, guardianId, tx);
      if (guardian!.personId === student.personId) throw StudentErrors.selfLink();
      if (student.guardians.some((g) => g.guardianId === guardianId))
        throw StudentErrors.alreadyLinked();

      // El primer acudiente es el principal; marcar uno como principal desplaza al anterior.
      const isPrimary = student.guardians.length === 0 || dto.isPrimary === true;
      if (isPrimary) await this.repository.clearPrimary(studentId, tx);
      await this.repository.createLink(
        {
          studentId,
          guardianId,
          relationship: dto.relationship,
          isPrimary,
          isLegalRepresentative: dto.isLegalRepresentative ?? false,
          livesWithStudent: dto.livesWithStudent ?? false,
        },
        tx,
      );
      await this.record(
        auth,
        client,
        'students.guardian.linked',
        studentId,
        { guardianId, relationship: dto.relationship, isPrimary },
        tx,
      );
    });
    return this.get(auth, studentId);
  }

  async updateGuardianLink(
    auth: AuthContext,
    studentId: string,
    guardianId: string,
    dto: UpdateGuardianLinkDto,
    client: ClientInfo,
  ): Promise<StudentView> {
    await this.repository.transaction(async (tx) => {
      const student = await this.repository.lockStudent(auth.institutionId, studentId, tx);
      if (!student) throw StudentErrors.notFound();
      const link = student.guardians.find((g) => g.guardianId === guardianId);
      if (!link) throw StudentErrors.linkNotFound();

      if (dto.isPrimary === false && link.isPrimary) throw StudentErrors.primaryRequired();
      if (dto.isPrimary === true && !link.isPrimary)
        await this.repository.clearPrimary(studentId, tx);
      await this.repository.updateLink(studentId, guardianId, dto, tx);
      await this.record(
        auth,
        client,
        'students.guardian.link_updated',
        studentId,
        { guardianId, ...dto },
        tx,
      );
    });
    return this.get(auth, studentId);
  }

  async unlinkGuardian(
    auth: AuthContext,
    studentId: string,
    guardianId: string,
    client: ClientInfo,
  ): Promise<StudentView> {
    await this.repository.transaction(async (tx) => {
      const student = await this.repository.lockStudent(auth.institutionId, studentId, tx);
      if (!student) throw StudentErrors.notFound();
      const link = student.guardians.find((g) => g.guardianId === guardianId);
      if (!link) throw StudentErrors.linkNotFound();
      if (link.isPrimary && student.guardians.length > 1) throw StudentErrors.primaryRequired();
      await this.repository.deleteLink(studentId, guardianId, tx);
      await this.record(
        auth,
        client,
        'students.guardian.unlinked',
        studentId,
        { guardianId, relationship: link.relationship, wasPrimary: link.isPrimary },
        tx,
      );
    });
    return this.get(auth, studentId);
  }

  /** Da acceso al portal al estudiante (rol Estudiante) y envía la activación. */
  async grantAccess(
    auth: AuthContext,
    id: string,
    email: string,
    client: ClientInfo,
  ): Promise<StudentView> {
    const student = await this.require(auth, id);
    await this.users.grantAccessToPerson(
      auth,
      student.personId,
      email,
      [SYSTEM_ROLES.STUDENT],
      client,
    );
    return this.get(auth, id);
  }
}

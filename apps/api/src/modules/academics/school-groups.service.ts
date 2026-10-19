import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService, diffChanges } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { AcademicErrors } from './academics.errors';
import { AcademicsRepository, type SchoolGroupRecord } from './academics.repository';
import {
  type CreateSchoolGroupDto,
  type ListSchoolGroupsQueryDto,
  type SchoolGroupViewDto,
  type UpdateSchoolGroupDto,
} from './dto/academics.dto';

type Tx = Prisma.TransactionClient;

function groupView(g: SchoolGroupRecord): SchoolGroupViewDto {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    capacity: g.capacity,
    status: g.status,
    academicYearId: g.academicYearId,
    academicYear: g.academicYear.year,
    gradeId: g.gradeId,
    gradeName: g.grade.name,
    campusId: g.campusId,
    campusName: g.campus.name,
    shiftId: g.shiftId,
    shiftName: g.shift.name,
  };
}

const GROUP_FIELDS = [
  'code',
  'name',
  'capacity',
  'status',
  'gradeId',
  'campusId',
  'shiftId',
] as const;

/** Grupos (cursos) de un año lectivo: grado + sede + jornada. */
@Injectable()
export class SchoolGroupsService {
  constructor(
    private readonly repository: AcademicsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, query: ListSchoolGroupsQueryDto): Promise<SchoolGroupViewDto[]> {
    return (await this.repository.listGroups(auth.institutionId, query)).map(groupView);
  }

  async get(auth: AuthContext, id: string): Promise<SchoolGroupViewDto> {
    const group = await this.repository.findGroup(auth.institutionId, id);
    if (!group) throw AcademicErrors.notFound('El grupo');
    return groupView(group);
  }

  /** Grado, sede y jornada deben existir en la institución y estar activos. */
  private async validateReferences(
    auth: AuthContext,
    refs: { gradeId?: string; campusId?: string; shiftId?: string },
    tx: Tx,
  ): Promise<void> {
    if (refs.gradeId) {
      const grade = await this.repository.findGrade(auth.institutionId, refs.gradeId, tx);
      if (!grade) throw AcademicErrors.notFound('El grado');
      if (grade.status !== 'ACTIVE') throw AcademicErrors.inactiveReference('El grado');
    }
    if (refs.campusId) {
      const campus = await this.repository.findCampus(auth.institutionId, refs.campusId, tx);
      if (!campus) throw AcademicErrors.notFound('La sede');
      if (campus.status !== 'ACTIVE') throw AcademicErrors.inactiveReference('La sede');
    }
    if (refs.shiftId) {
      const shift = await this.repository.findShift(auth.institutionId, refs.shiftId, tx);
      if (!shift) throw AcademicErrors.notFound('La jornada');
      if (shift.status !== 'ACTIVE') throw AcademicErrors.inactiveReference('La jornada');
    }
  }

  async create(
    auth: AuthContext,
    dto: CreateSchoolGroupDto,
    client: ClientInfo,
  ): Promise<SchoolGroupViewDto> {
    const group = await this.repository.transaction(async (tx) => {
      const year = await this.repository.findYear(auth.institutionId, dto.academicYearId, tx);
      if (!year) throw AcademicErrors.notFound('El año lectivo');
      if (year.status === 'CLOSED') throw AcademicErrors.yearClosed();
      await this.validateReferences(auth, dto, tx);
      if (
        await this.repository.findGroupByCode(
          auth.institutionId,
          dto.academicYearId,
          dto.campusId,
          dto.code,
          tx,
        )
      ) {
        throw AcademicErrors.codeTaken('un grupo en esta sede y año');
      }

      const created = await this.repository.createGroup(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'academics.group.created',
          entityType: 'school_group',
          entityId: created.id,
          changes: diffChanges(null, created, GROUP_FIELDS),
          metadata: { academicYearId: dto.academicYearId },
          context: client,
        },
        tx,
      );
      return created;
    });
    return groupView(group);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateSchoolGroupDto,
    client: ClientInfo,
  ): Promise<SchoolGroupViewDto> {
    const group = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findGroup(auth.institutionId, id, tx);
      if (!before) throw AcademicErrors.notFound('El grupo');
      // El historial de un año cerrado no se modifica.
      if (before.academicYear.status === 'CLOSED') throw AcademicErrors.yearClosed();

      await this.validateReferences(
        auth,
        {
          gradeId: dto.gradeId !== before.gradeId ? dto.gradeId : undefined,
          campusId: dto.campusId !== before.campusId ? dto.campusId : undefined,
          shiftId: dto.shiftId !== before.shiftId ? dto.shiftId : undefined,
        },
        tx,
      );
      const code = dto.code ?? before.code;
      const campusId = dto.campusId ?? before.campusId;
      if (code !== before.code || campusId !== before.campusId) {
        const other = await this.repository.findGroupByCode(
          auth.institutionId,
          before.academicYearId,
          campusId,
          code,
          tx,
        );
        if (other && other.id !== id) throw AcademicErrors.codeTaken('un grupo en esta sede y año');
      }

      const after = await this.repository.updateGroup(id, dto, tx);
      const changes = diffChanges(before, after, GROUP_FIELDS);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            action: 'academics.group.updated',
            entityType: 'school_group',
            entityId: id,
            changes,
            context: client,
          },
          tx,
        );
      }
      return after;
    });
    return groupView(group);
  }
}

import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService, diffChanges } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { AcademicErrors } from './academics.errors';
import { AcademicsRepository } from './academics.repository';
import {
  type CatalogItemViewDto,
  type CreateEducationLevelDto,
  type CreateGradeDto,
  type CreateSubjectAreaDto,
  type CreateSubjectDto,
  type EducationLevelViewDto,
  type GradeViewDto,
  type SubjectViewDto,
  type UpdateEducationLevelDto,
  type UpdateGradeDto,
  type UpdateSubjectAreaDto,
  type UpdateSubjectDto,
} from './dto/academics.dto';

type Tx = Prisma.TransactionClient;

interface CatalogRecord {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const view = (r: CatalogRecord): CatalogItemViewDto => ({
  id: r.id,
  code: r.code,
  name: r.name,
  status: r.status,
});

/**
 * Catálogos académicos: niveles, grados, áreas y asignaturas. No se borran
 * (se desactivan) porque el historial académico los referencia.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly repository: AcademicsRepository,
    private readonly audit: AuditService,
  ) {}

  private async audited(
    auth: AuthContext,
    client: ClientInfo,
    action: string,
    entityType: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> & { id: string },
    fields: readonly string[],
    tx: Tx,
  ): Promise<void> {
    const changes = diffChanges<Record<string, unknown>>(before, after, fields);
    if (Object.keys(changes).length === 0) return;
    await this.audit.record(
      {
        institutionId: auth.institutionId,
        actorUserId: auth.userId,
        action,
        entityType,
        entityId: after.id,
        changes,
        context: client,
      },
      tx,
    );
  }

  // --- Niveles --------------------------------------------------------------

  async listLevels(auth: AuthContext): Promise<EducationLevelViewDto[]> {
    return (await this.repository.listLevels(auth.institutionId)).map((l) => ({
      ...view(l),
      sortOrder: l.sortOrder,
    }));
  }

  async createLevel(
    auth: AuthContext,
    dto: CreateEducationLevelDto,
    client: ClientInfo,
  ): Promise<EducationLevelViewDto> {
    const level = await this.repository.transaction(async (tx) => {
      if (await this.repository.findLevelByCode(auth.institutionId, dto.code, tx))
        throw AcademicErrors.codeTaken('un nivel');
      const created = await this.repository.createLevel(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.audited(
        auth,
        client,
        'academics.level.created',
        'education_level',
        null,
        created,
        ['code', 'name', 'sortOrder'],
        tx,
      );
      return created;
    });
    return { ...view(level), sortOrder: level.sortOrder };
  }

  async updateLevel(
    auth: AuthContext,
    id: string,
    dto: UpdateEducationLevelDto,
    client: ClientInfo,
  ): Promise<EducationLevelViewDto> {
    const level = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findLevel(auth.institutionId, id, tx);
      if (!before) throw AcademicErrors.notFound('El nivel');
      if (
        dto.code &&
        dto.code !== before.code &&
        (await this.repository.findLevelByCode(auth.institutionId, dto.code, tx))
      ) {
        throw AcademicErrors.codeTaken('un nivel');
      }
      if (dto.status === 'INACTIVE' && before.status === 'ACTIVE') {
        const grades = await this.repository.countActiveGradesOfLevel(id, tx);
        if (grades > 0) throw AcademicErrors.inUse('el nivel', 'grado(s)', grades);
      }
      const after = await this.repository.updateLevel(id, dto, tx);
      await this.audited(
        auth,
        client,
        'academics.level.updated',
        'education_level',
        before,
        after,
        ['code', 'name', 'sortOrder', 'status'],
        tx,
      );
      return after;
    });
    return { ...view(level), sortOrder: level.sortOrder };
  }

  // --- Grados ---------------------------------------------------------------

  private gradeView(
    g: CatalogRecord & {
      sortOrder: number;
      educationLevelId: string;
      educationLevel: { name: string };
    },
  ): GradeViewDto {
    return {
      ...view(g),
      sortOrder: g.sortOrder,
      educationLevelId: g.educationLevelId,
      educationLevelName: g.educationLevel.name,
    };
  }

  private async requireActiveLevel(auth: AuthContext, id: string, tx: Tx) {
    const level = await this.repository.findLevel(auth.institutionId, id, tx);
    if (!level) throw AcademicErrors.notFound('El nivel');
    if (level.status !== 'ACTIVE') throw AcademicErrors.inactiveReference('El nivel');
    return level;
  }

  async listGrades(auth: AuthContext, educationLevelId?: string): Promise<GradeViewDto[]> {
    return (await this.repository.listGrades(auth.institutionId, educationLevelId)).map((g) =>
      this.gradeView(g),
    );
  }

  async createGrade(
    auth: AuthContext,
    dto: CreateGradeDto,
    client: ClientInfo,
  ): Promise<GradeViewDto> {
    const grade = await this.repository.transaction(async (tx) => {
      await this.requireActiveLevel(auth, dto.educationLevelId, tx);
      if (await this.repository.findGradeByCode(auth.institutionId, dto.code, tx))
        throw AcademicErrors.codeTaken('un grado');
      const created = await this.repository.createGrade(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.audited(
        auth,
        client,
        'academics.grade.created',
        'grade',
        null,
        created,
        ['code', 'name', 'sortOrder', 'educationLevelId'],
        tx,
      );
      return created;
    });
    return this.gradeView(grade);
  }

  async updateGrade(
    auth: AuthContext,
    id: string,
    dto: UpdateGradeDto,
    client: ClientInfo,
  ): Promise<GradeViewDto> {
    const grade = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findGrade(auth.institutionId, id, tx);
      if (!before) throw AcademicErrors.notFound('El grado');
      if (dto.educationLevelId && dto.educationLevelId !== before.educationLevelId) {
        await this.requireActiveLevel(auth, dto.educationLevelId, tx);
      }
      if (
        dto.code &&
        dto.code !== before.code &&
        (await this.repository.findGradeByCode(auth.institutionId, dto.code, tx))
      ) {
        throw AcademicErrors.codeTaken('un grado');
      }
      if (dto.status === 'INACTIVE' && before.status === 'ACTIVE') {
        const groups = await this.repository.countOpenGroupsOfGrade(id, tx);
        if (groups > 0)
          throw AcademicErrors.inUse('el grado', 'grupo(s) en años no cerrados', groups);
      }
      const after = await this.repository.updateGrade(id, dto, tx);
      await this.audited(
        auth,
        client,
        'academics.grade.updated',
        'grade',
        before,
        after,
        ['code', 'name', 'sortOrder', 'educationLevelId', 'status'],
        tx,
      );
      return after;
    });
    return this.gradeView(grade);
  }

  // --- Áreas ----------------------------------------------------------------

  async listAreas(auth: AuthContext): Promise<CatalogItemViewDto[]> {
    return (await this.repository.listAreas(auth.institutionId)).map(view);
  }

  async createArea(
    auth: AuthContext,
    dto: CreateSubjectAreaDto,
    client: ClientInfo,
  ): Promise<CatalogItemViewDto> {
    const area = await this.repository.transaction(async (tx) => {
      if (await this.repository.findAreaByCode(auth.institutionId, dto.code, tx))
        throw AcademicErrors.codeTaken('un área');
      const created = await this.repository.createArea(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.audited(
        auth,
        client,
        'academics.area.created',
        'subject_area',
        null,
        created,
        ['code', 'name'],
        tx,
      );
      return created;
    });
    return view(area);
  }

  async updateArea(
    auth: AuthContext,
    id: string,
    dto: UpdateSubjectAreaDto,
    client: ClientInfo,
  ): Promise<CatalogItemViewDto> {
    const area = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findArea(auth.institutionId, id, tx);
      if (!before) throw AcademicErrors.notFound('El área');
      if (
        dto.code &&
        dto.code !== before.code &&
        (await this.repository.findAreaByCode(auth.institutionId, dto.code, tx))
      ) {
        throw AcademicErrors.codeTaken('un área');
      }
      if (dto.status === 'INACTIVE' && before.status === 'ACTIVE') {
        const subjects = await this.repository.countActiveSubjectsOfArea(id, tx);
        if (subjects > 0) throw AcademicErrors.inUse('el área', 'asignatura(s)', subjects);
      }
      const after = await this.repository.updateArea(id, dto, tx);
      await this.audited(
        auth,
        client,
        'academics.area.updated',
        'subject_area',
        before,
        after,
        ['code', 'name', 'status'],
        tx,
      );
      return after;
    });
    return view(area);
  }

  // --- Asignaturas ----------------------------------------------------------

  private subjectView(
    s: CatalogRecord & { subjectAreaId: string; subjectArea: { name: string } },
  ): SubjectViewDto {
    return { ...view(s), subjectAreaId: s.subjectAreaId, subjectAreaName: s.subjectArea.name };
  }

  private async requireActiveArea(auth: AuthContext, id: string, tx: Tx) {
    const area = await this.repository.findArea(auth.institutionId, id, tx);
    if (!area) throw AcademicErrors.notFound('El área');
    if (area.status !== 'ACTIVE') throw AcademicErrors.inactiveReference('El área');
    return area;
  }

  async listSubjects(auth: AuthContext, subjectAreaId?: string): Promise<SubjectViewDto[]> {
    return (await this.repository.listSubjects(auth.institutionId, subjectAreaId)).map((s) =>
      this.subjectView(s),
    );
  }

  async createSubject(
    auth: AuthContext,
    dto: CreateSubjectDto,
    client: ClientInfo,
  ): Promise<SubjectViewDto> {
    const subject = await this.repository.transaction(async (tx) => {
      await this.requireActiveArea(auth, dto.subjectAreaId, tx);
      if (await this.repository.findSubjectByCode(auth.institutionId, dto.code, tx))
        throw AcademicErrors.codeTaken('una asignatura');
      const created = await this.repository.createSubject(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.audited(
        auth,
        client,
        'academics.subject.created',
        'subject',
        null,
        created,
        ['code', 'name', 'subjectAreaId'],
        tx,
      );
      return created;
    });
    return this.subjectView(subject);
  }

  async updateSubject(
    auth: AuthContext,
    id: string,
    dto: UpdateSubjectDto,
    client: ClientInfo,
  ): Promise<SubjectViewDto> {
    const subject = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findSubject(auth.institutionId, id, tx);
      if (!before) throw AcademicErrors.notFound('La asignatura');
      if (dto.subjectAreaId && dto.subjectAreaId !== before.subjectAreaId) {
        await this.requireActiveArea(auth, dto.subjectAreaId, tx);
      }
      if (
        dto.code &&
        dto.code !== before.code &&
        (await this.repository.findSubjectByCode(auth.institutionId, dto.code, tx))
      ) {
        throw AcademicErrors.codeTaken('una asignatura');
      }
      const after = await this.repository.updateSubject(id, dto, tx);
      await this.audited(
        auth,
        client,
        'academics.subject.updated',
        'subject',
        before,
        after,
        ['code', 'name', 'subjectAreaId', 'status'],
        tx,
      );
      return after;
    });
    return this.subjectView(subject);
  }
}

import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import {
  type CopyCurriculumDto,
  type CreateCurriculumSubjectDto,
  type ListCurriculumQueryDto,
  type UpdateCurriculumSubjectDto,
} from './teaching.dto';
import { TeachingErrors } from './teaching.errors';
import { type CurriculumRecord, TeachingRepository } from './teaching.repository';

type Tx = Prisma.TransactionClient;

export function curriculumView(c: CurriculumRecord) {
  return {
    id: c.id,
    academicYearId: c.academicYearId,
    grade: c.grade,
    subject: {
      id: c.subject.id,
      code: c.subject.code,
      name: c.subject.name,
      status: c.subject.status,
      area: c.subject.subjectArea,
    },
    weeklyHours: c.weeklyHours,
  };
}

export type CurriculumView = ReturnType<typeof curriculumView>;

/**
 * Plan de estudios por año lectivo y grado: qué asignaturas se dictan y con
 * qué intensidad horaria semanal. Un año cerrado no se modifica.
 */
@Injectable()
export class CurriculumService {
  constructor(
    private readonly repository: TeachingRepository,
    private readonly audit: AuditService,
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
        entityType: 'curriculum_subject',
        entityId,
        metadata,
        context: client,
      },
      tx,
    );
  }

  private async openYear(auth: AuthContext, id: string, tx: Tx) {
    const year = await this.repository.findYear(auth.institutionId, id, tx);
    if (!year) throw TeachingErrors.notFound('El año lectivo');
    if (year.status === 'CLOSED') throw TeachingErrors.yearClosed();
    return year;
  }

  async list(auth: AuthContext, query: ListCurriculumQueryDto): Promise<CurriculumView[]> {
    const year = await this.repository.findYear(auth.institutionId, query.academicYearId);
    if (!year) throw TeachingErrors.notFound('El año lectivo');
    const entries = await this.repository.listCurriculum(
      auth.institutionId,
      query.academicYearId,
      query.gradeId,
    );
    return entries.map(curriculumView);
  }

  async create(
    auth: AuthContext,
    dto: CreateCurriculumSubjectDto,
    client: ClientInfo,
  ): Promise<CurriculumView> {
    const entry = await this.repository.transaction(async (tx) => {
      await this.openYear(auth, dto.academicYearId, tx);
      const grade = await this.repository.findGrade(auth.institutionId, dto.gradeId, tx);
      if (!grade) throw TeachingErrors.notFound('El grado');
      if (grade.status !== 'ACTIVE') throw TeachingErrors.inactive('El grado');
      const subject = await this.repository.findSubject(auth.institutionId, dto.subjectId, tx);
      if (!subject) throw TeachingErrors.notFound('La asignatura');
      if (subject.status !== 'ACTIVE') throw TeachingErrors.inactive('La asignatura');
      if (
        await this.repository.findCurriculumByKey(
          auth.institutionId,
          dto.academicYearId,
          dto.gradeId,
          dto.subjectId,
          tx,
        )
      ) {
        throw TeachingErrors.curriculumExists();
      }

      const created = await this.repository.createCurriculumEntry(
        { ...dto, institutionId: auth.institutionId },
        tx,
      );
      await this.record(auth, client, 'academics.curriculum.added', created.id, { ...dto }, tx);
      return created;
    });
    return curriculumView(entry);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateCurriculumSubjectDto,
    client: ClientInfo,
  ): Promise<CurriculumView> {
    const entry = await this.repository.transaction(async (tx) => {
      const before = await this.repository.findCurriculumEntry(auth.institutionId, id, tx);
      if (!before) throw TeachingErrors.notFound('La asignatura del plan');
      await this.openYear(auth, before.academicYearId, tx);
      const after = await this.repository.updateCurriculumEntry(id, dto.weeklyHours, tx);
      if (after.weeklyHours !== before.weeklyHours) {
        await this.record(
          auth,
          client,
          'academics.curriculum.updated',
          id,
          { weeklyHours: { from: before.weeklyHours, to: after.weeklyHours } },
          tx,
        );
      }
      return after;
    });
    return curriculumView(entry);
  }

  /**
   * Quita una asignatura del plan. Solo si nunca se asignó un docente para ella
   * en ese grado y año: si ya hubo asignaciones, el plan forma parte del
   * historial académico y se conserva.
   */
  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const entry = await this.repository.findCurriculumEntry(auth.institutionId, id, tx);
      if (!entry) throw TeachingErrors.notFound('La asignatura del plan');
      await this.openYear(auth, entry.academicYearId, tx);
      const used = await this.repository.countAssignmentsForCurriculum(
        entry.academicYearId,
        entry.gradeId,
        entry.subjectId,
        tx,
      );
      if (used > 0) throw TeachingErrors.curriculumInUse(used);
      await this.repository.deleteCurriculumEntry(id, tx);
      await this.record(
        auth,
        client,
        'academics.curriculum.removed',
        id,
        {
          academicYearId: entry.academicYearId,
          gradeId: entry.gradeId,
          subjectId: entry.subjectId,
          weeklyHours: entry.weeklyHours,
        },
        tx,
      );
    });
  }

  /**
   * Copia el plan de un año a otro. Solo agrega lo que falta (se puede repetir
   * sin duplicar) y omite grados o asignaturas que hoy están inactivos.
   */
  async copy(
    auth: AuthContext,
    dto: CopyCurriculumDto,
    client: ClientInfo,
  ): Promise<{ created: number; skipped: number }> {
    if (dto.fromAcademicYearId === dto.toAcademicYearId) {
      throw TeachingErrors.invalid('toAcademicYearId', 'Elige un año lectivo distinto.');
    }
    return this.repository.transaction(async (tx) => {
      const from = await this.repository.findYear(auth.institutionId, dto.fromAcademicYearId, tx);
      if (!from) throw TeachingErrors.notFound('El año lectivo de origen');
      await this.openYear(auth, dto.toAcademicYearId, tx);

      const source = await this.repository.curriculumOfYear(
        auth.institutionId,
        dto.fromAcademicYearId,
        tx,
      );
      const existing = await this.repository.curriculumOfYear(
        auth.institutionId,
        dto.toAcademicYearId,
        tx,
      );
      const taken = new Set(existing.map((e) => `${e.gradeId}:${e.subjectId}`));

      let created = 0;
      for (const entry of source) {
        if (taken.has(`${entry.gradeId}:${entry.subjectId}`)) continue;
        if (entry.grade.status !== 'ACTIVE' || entry.subject.status !== 'ACTIVE') continue;
        await this.repository.createCurriculumEntry(
          {
            institutionId: auth.institutionId,
            academicYearId: dto.toAcademicYearId,
            gradeId: entry.gradeId,
            subjectId: entry.subjectId,
            weeklyHours: entry.weeklyHours,
          },
          tx,
        );
        created++;
      }
      const result = { created, skipped: source.length - created };
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'academics.curriculum.copied',
          entityType: 'academic_year',
          entityId: dto.toAcademicYearId,
          metadata: { fromAcademicYearId: dto.fromAcademicYearId, ...result },
          context: client,
        },
        tx,
      );
      return result;
    });
  }
}

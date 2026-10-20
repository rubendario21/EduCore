import {
  computePeriodScore,
  isOnScale,
  isPassing,
  levelFor,
  PERMISSIONS,
  type PermissionCode,
  type RoundingMode,
} from '@educore/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';
import { fromDateOnly, toDateOnly } from '../../common/validation/colombia';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { scopesOf } from '../access-control/authorization';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { TeachingRepository } from '../teaching/teaching.repository';
import {
  type CreateAssessmentDto,
  type GradebookQueryDto,
  type SaveGradesDto,
  type UpdateAssessmentDto,
} from './gradebook.dto';

type Tx = Prisma.TransactionClient;
const CURRENT = ['PRE_ENROLLED', 'ACTIVE'] as const;
const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value.toString());

export const GradebookErrors = {
  notFound: (what: string) =>
    new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} no existe.`),
  assessmentNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'ASSESSMENT_NOT_FOUND', 'La actividad no existe.'),
  periodMismatch: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'PERIOD_MISMATCH',
      'El período no pertenece al año lectivo del grupo.',
    ),
  notInCurriculum: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'SUBJECT_NOT_IN_CURRICULUM',
      'La asignatura no está en el plan de estudios del grado del grupo para ese año.',
    ),
  schemeMissing: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'GRADING_SCHEME_NOT_DEFINED',
      'El año lectivo no tiene SIEE configurado.',
    ),
  periodNotOpen: (status: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'PERIOD_NOT_OPEN',
      'El período no está abierto: no admite actividades ni cambios de notas.',
      { status },
    ),
  componentMismatch: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'COMPONENT_MISMATCH',
      'El componente no pertenece al SIEE del año.',
    ),
  hasGrades: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ASSESSMENT_HAS_GRADES',
      'La actividad ya tiene notas: no se puede eliminar ni cambiar de componente.',
    ),
  invalidGrades: (problems: Array<{ field: string; messages: string[] }>) =>
    new ValidationException(problems),
};

interface Context {
  group: { id: string; code: string; name: string; gradeId: string; academicYearId: string };
  subject: { id: string; code: string; name: string };
  period: { id: string; number: number; name: string; status: string };
  scheme: {
    minScore: number;
    maxScore: number;
    decimals: number;
    passingScore: number;
    rounding: RoundingMode;
    levels: Array<{ code: string; name: string; minScore: number; maxScore: number }>;
    components: Array<{ id: string; code: string; name: string; weightPercent: number }>;
  };
}

/**
 * Planilla de notas: actividades evaluativas y notas de una asignatura en un
 * grupo y período. El cálculo de la nota parcial es el del SIEE
 * (`computePeriodScore`, compartido con la web).
 *
 * Alcance ASSIGNED: el docente solo ve y registra las de sus asignaciones
 * vigentes. Fuera del alcance, la asignatura del grupo se trata como inexistente.
 */
@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly teaching: TeachingRepository,
  ) {}

  // --- Alcance y contexto ----------------------------------------------------

  /** ¿El usuario alcanza la asignatura del grupo con este permiso? */
  private async inScope(
    auth: AuthContext,
    code: PermissionCode,
    schoolGroupId: string,
    subjectId: string,
  ): Promise<boolean> {
    const scopes = scopesOf(auth, code);
    if (scopes.has('ALL')) return true;
    if (!scopes.has('ASSIGNED')) return false;
    const staff = await this.teaching.staffOfMembership(auth.membershipId);
    if (!staff || staff.status !== 'ACTIVE') return false;
    const assignment = await this.prisma.teachingAssignment.findFirst({
      where: { schoolGroupId, subjectId, staffMemberId: staff.id, toDate: null },
      select: { id: true },
    });
    return assignment !== null;
  }

  private async requireScope(
    auth: AuthContext,
    code: PermissionCode,
    schoolGroupId: string,
    subjectId: string,
  ) {
    if (!(await this.inScope(auth, code, schoolGroupId, subjectId))) {
      throw GradebookErrors.notFound('La asignatura del grupo');
    }
  }

  private async loadContext(
    auth: AuthContext,
    q: GradebookQueryDto,
    db: Tx = this.prisma,
  ): Promise<Context> {
    const group = await db.schoolGroup.findFirst({
      where: { id: q.schoolGroupId, institutionId: auth.institutionId },
      select: { id: true, code: true, name: true, gradeId: true, academicYearId: true },
    });
    if (!group) throw GradebookErrors.notFound('El grupo');
    const subject = await db.subject.findFirst({
      where: { id: q.subjectId, institutionId: auth.institutionId },
      select: { id: true, code: true, name: true },
    });
    if (!subject) throw GradebookErrors.notFound('La asignatura');
    const period = await db.academicPeriod.findFirst({
      where: { id: q.periodId, academicYear: { institutionId: auth.institutionId } },
      select: { id: true, number: true, name: true, status: true, academicYearId: true },
    });
    if (!period) throw GradebookErrors.notFound('El período');
    if (period.academicYearId !== group.academicYearId) throw GradebookErrors.periodMismatch();
    const inPlan = await db.curriculumSubject.findFirst({
      where: {
        academicYearId: group.academicYearId,
        gradeId: group.gradeId,
        subjectId: subject.id,
      },
      select: { id: true },
    });
    if (!inPlan) throw GradebookErrors.notInCurriculum();
    const scheme = await db.gradingScheme.findFirst({
      where: { academicYearId: group.academicYearId },
      include: {
        levels: { orderBy: { minScore: 'asc' } },
        components: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!scheme) throw GradebookErrors.schemeMissing();
    return {
      group,
      subject,
      period,
      scheme: {
        minScore: num(scheme.minScore)!,
        maxScore: num(scheme.maxScore)!,
        decimals: scheme.decimals,
        passingScore: num(scheme.passingScore)!,
        rounding: scheme.rounding,
        levels: scheme.levels.map((l) => ({
          code: l.code,
          name: l.name,
          minScore: num(l.minScore)!,
          maxScore: num(l.maxScore)!,
        })),
        components: scheme.components.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          weightPercent: num(c.weightPercent)!,
        })),
      },
    };
  }

  /** Estudiantes con matrícula vigente ubicados hoy en el grupo. */
  private currentRoster(schoolGroupId: string, db: Tx = this.prisma) {
    return db.groupPlacement.findMany({
      where: { schoolGroupId, toDate: null, enrollment: { status: { in: [...CURRENT] } } },
      select: {
        enrollment: {
          select: {
            id: true,
            student: {
              select: {
                id: true,
                code: true,
                person: {
                  select: {
                    firstNames: true,
                    lastNames: true,
                    documentType: true,
                    documentNumber: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  // --- Planilla --------------------------------------------------------------

  async gradebook(auth: AuthContext, q: GradebookQueryDto) {
    await this.requireScope(auth, PERMISSIONS.GRADES_READ, q.schoolGroupId, q.subjectId);
    const ctx = await this.loadContext(auth, q);
    const [roster, assessments] = await Promise.all([
      this.currentRoster(ctx.group.id),
      this.prisma.assessment.findMany({
        where: { schoolGroupId: ctx.group.id, subjectId: ctx.subject.id, periodId: ctx.period.id },
        include: { grades: { select: { enrollmentId: true, score: true, comment: true } } },
        orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    // Estudiantes que tienen notas aquí pero ya no están en el grupo (cambio de grupo, retiro).
    const inGroup = new Set(roster.map((r) => r.enrollment.id));
    const gradedElsewhere = [
      ...new Set(assessments.flatMap((a) => a.grades.map((g) => g.enrollmentId))),
    ].filter((id) => !inGroup.has(id));
    const former = gradedElsewhere.length
      ? await this.prisma.enrollment.findMany({
          where: { id: { in: gradedElsewhere } },
          select: {
            id: true,
            student: {
              select: {
                id: true,
                code: true,
                person: {
                  select: {
                    firstNames: true,
                    lastNames: true,
                    documentType: true,
                    documentNumber: true,
                  },
                },
              },
            },
          },
        })
      : [];

    const students = [
      ...roster.map((r) => ({ enrollment: r.enrollment, inGroup: true })),
      ...former.map((enrollment) => ({ enrollment, inGroup: false })),
    ].sort((a, b) =>
      `${a.enrollment.student.person.lastNames} ${a.enrollment.student.person.firstNames}`.localeCompare(
        `${b.enrollment.student.person.lastNames} ${b.enrollment.student.person.firstNames}`,
        'es',
      ),
    );

    const { scheme } = ctx;
    const rows = students.map(({ enrollment, inGroup: active }) => {
      const grades: Record<string, number | null> = {};
      const comments: Record<string, string | null> = {};
      for (const a of assessments) {
        const g = a.grades.find((x) => x.enrollmentId === enrollment.id);
        grades[a.id] = g ? num(g.score) : null;
        if (g?.comment) comments[a.id] = g.comment;
      }
      const perComponent = scheme.components.map((c) => ({
        componentId: c.id,
        weightPercent: c.weightPercent,
        scores: assessments
          .filter((a) => a.componentId === c.id)
          .map((a) => grades[a.id])
          .filter((s): s is number => s !== null),
      }));
      const { score } = computePeriodScore(perComponent, scheme);
      const level = score === null ? null : levelFor(score, scheme.levels, scheme.decimals);
      return {
        enrollmentId: enrollment.id,
        studentId: enrollment.student.id,
        code: enrollment.student.code,
        ...enrollment.student.person,
        inGroup: active,
        grades,
        comments,
        componentAverages: Object.fromEntries(
          perComponent.map((c) => [
            c.componentId,
            c.scores.length
              ? computePeriodScore([{ weightPercent: 100, scores: c.scores }], scheme).score
              : null,
          ]),
        ),
        periodScore: score,
        level: level ? { code: level.code, name: level.name } : null,
        passing: score === null ? null : isPassing(score, scheme),
      };
    });

    const canEdit =
      ctx.period.status === 'OPEN' &&
      (await this.inScope(auth, PERMISSIONS.GRADES_MANAGE, ctx.group.id, ctx.subject.id));
    return {
      group: { id: ctx.group.id, code: ctx.group.code, name: ctx.group.name },
      subject: ctx.subject,
      period: ctx.period,
      scheme,
      assessments: assessments.map((a) => ({
        id: a.id,
        componentId: a.componentId,
        title: a.title,
        description: a.description,
        dueOn: a.dueOn ? fromDateOnly(a.dueOn) : null,
        gradedCount: a.grades.filter((g) => g.score !== null).length,
      })),
      students: rows,
      canEdit,
    };
  }

  // --- Actividades -----------------------------------------------------------

  private async requireWritable(auth: AuthContext, q: GradebookQueryDto, tx: Tx) {
    await this.requireScope(auth, PERMISSIONS.GRADES_MANAGE, q.schoolGroupId, q.subjectId);
    // El período bloqueado serializa las escrituras frente a su cierre (3C).
    await tx.$executeRaw`SELECT 1 FROM academic_period WHERE id = ${q.periodId}::uuid FOR SHARE`;
    const ctx = await this.loadContext(auth, q, tx);
    if (ctx.period.status !== 'OPEN') throw GradebookErrors.periodNotOpen(ctx.period.status);
    return ctx;
  }

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
        entityType: 'assessment',
        entityId,
        metadata,
        context: client,
      },
      tx,
    );
  }

  async createAssessment(auth: AuthContext, dto: CreateAssessmentDto, client: ClientInfo) {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.requireWritable(auth, dto, tx);
      if (!ctx.scheme.components.some((c) => c.id === dto.componentId))
        throw GradebookErrors.componentMismatch();
      const created = await tx.assessment.create({
        data: {
          institutionId: auth.institutionId,
          schoolGroupId: dto.schoolGroupId,
          subjectId: dto.subjectId,
          periodId: dto.periodId,
          componentId: dto.componentId,
          title: dto.title,
          description: dto.description ?? null,
          dueOn: dto.dueOn ? toDateOnly(dto.dueOn) : null,
          createdByUserId: auth.userId,
        },
      });
      await this.record(auth, client, 'grades.assessment.created', created.id, { ...dto }, tx);
      return { id: created.id };
    });
  }

  private async lockAssessment(auth: AuthContext, id: string, tx: Tx) {
    await tx.$executeRaw`SELECT 1 FROM assessment WHERE id = ${id}::uuid AND institution_id = ${auth.institutionId}::uuid FOR UPDATE`;
    const assessment = await tx.assessment.findFirst({
      where: { id, institutionId: auth.institutionId },
      include: { _count: { select: { grades: true } } },
    });
    if (!assessment) throw GradebookErrors.assessmentNotFound();
    return assessment;
  }

  async updateAssessment(
    auth: AuthContext,
    id: string,
    dto: UpdateAssessmentDto,
    client: ClientInfo,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await this.lockAssessment(auth, id, tx);
      const ctx = await this.requireWritable(auth, assessment, tx);
      if (dto.componentId && dto.componentId !== assessment.componentId) {
        if (!ctx.scheme.components.some((c) => c.id === dto.componentId))
          throw GradebookErrors.componentMismatch();
        if (assessment._count.grades > 0) throw GradebookErrors.hasGrades();
      }
      await tx.assessment.update({
        where: { id },
        data: {
          componentId: dto.componentId,
          title: dto.title,
          description: dto.description,
          dueOn: dto.dueOn === undefined ? undefined : dto.dueOn ? toDateOnly(dto.dueOn) : null,
        },
      });
      await this.record(
        auth,
        client,
        'grades.assessment.updated',
        id,
        { fields: Object.keys(dto) },
        tx,
      );
      return { id };
    });
  }

  async deleteAssessment(auth: AuthContext, id: string, client: ClientInfo) {
    await this.prisma.$transaction(async (tx) => {
      const assessment = await this.lockAssessment(auth, id, tx);
      await this.requireWritable(auth, assessment, tx);
      if (assessment._count.grades > 0) throw GradebookErrors.hasGrades();
      await tx.assessment.delete({ where: { id } });
      await this.record(
        auth,
        client,
        'grades.assessment.deleted',
        id,
        { title: assessment.title, periodId: assessment.periodId },
        tx,
      );
    });
  }

  // --- Notas -------------------------------------------------------------------

  /**
   * Registra o cambia notas de una actividad (todo o nada). Cada cambio real
   * queda en el historial con el valor anterior, el nuevo, el autor y el motivo.
   */
  async saveGrades(auth: AuthContext, id: string, dto: SaveGradesDto, client: ClientInfo) {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await this.lockAssessment(auth, id, tx);
      const ctx = await this.requireWritable(auth, assessment, tx);
      const roster = new Set(
        (await this.currentRoster(ctx.group.id, tx)).map((r) => r.enrollment.id),
      );

      const problems: Array<{ field: string; messages: string[] }> = [];
      const seen = new Set<string>();
      dto.grades.forEach((g, index) => {
        const field = `grades.${index}`;
        if (seen.has(g.enrollmentId))
          problems.push({ field, messages: ['El estudiante está repetido.'] });
        seen.add(g.enrollmentId);
        if (!roster.has(g.enrollmentId))
          problems.push({ field, messages: ['El estudiante no está ubicado en este grupo.'] });
        if (g.score !== null && g.score !== undefined && !isOnScale(g.score, ctx.scheme)) {
          problems.push({
            field,
            messages: [
              `La nota debe estar entre ${ctx.scheme.minScore} y ${ctx.scheme.maxScore}, con hasta ${ctx.scheme.decimals} decimal(es).`,
            ],
          });
        }
      });
      if (problems.length > 0) throw GradebookErrors.invalidGrades(problems);

      const existing = await tx.gradeRecord.findMany({
        where: { assessmentId: id, enrollmentId: { in: dto.grades.map((g) => g.enrollmentId) } },
      });
      let changed = 0;
      for (const entry of dto.grades) {
        const score = entry.score ?? null;
        const comment = entry.comment ?? null;
        const current = existing.find((r) => r.enrollmentId === entry.enrollmentId);
        const previous = current ? num(current.score) : null;
        if (!current && score === null) continue;
        if (current && previous === score && (current.comment ?? null) === comment) continue;

        const record = current
          ? await tx.gradeRecord.update({
              where: { id: current.id },
              data: { score, comment, updatedByUserId: auth.userId, version: { increment: 1 } },
            })
          : await tx.gradeRecord.create({
              data: {
                assessmentId: id,
                enrollmentId: entry.enrollmentId,
                score,
                comment,
                updatedByUserId: auth.userId,
              },
            });
        if (previous !== score) {
          await tx.gradeRecordChange.create({
            data: {
              gradeRecordId: record.id,
              previousScore: previous,
              newScore: score,
              reason: dto.reason ?? null,
              changedByUserId: auth.userId,
            },
          });
        }
        changed++;
      }
      if (changed > 0) {
        await this.record(
          auth,
          client,
          'grades.assessment.graded',
          id,
          { changed, reason: dto.reason ?? null },
          tx,
        );
      }
      return { changed };
    });
  }

  /** Historial de la nota de un estudiante en una actividad. */
  async history(auth: AuthContext, id: string, enrollmentId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id, institutionId: auth.institutionId },
    });
    if (!assessment) throw GradebookErrors.assessmentNotFound();
    await this.requireScope(
      auth,
      PERMISSIONS.GRADES_READ,
      assessment.schoolGroupId,
      assessment.subjectId,
    );
    const record = await this.prisma.gradeRecord.findUnique({
      where: { assessmentId_enrollmentId: { assessmentId: id, enrollmentId } },
      include: { changes: { orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] } },
    });
    return (record?.changes ?? []).map((c) => ({
      previousScore: num(c.previousScore),
      newScore: num(c.newScore),
      reason: c.reason,
      changedByUserId: c.changedByUserId,
      changedAt: c.changedAt.toISOString(),
    }));
  }
}

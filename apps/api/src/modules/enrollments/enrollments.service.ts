import { PERMISSIONS } from '@educore/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';
import { paginated, type Paginated, toPrismaPage } from '../../common/pagination/pagination';
import { fromDateOnly, toDateOnly } from '../../common/validation/colombia';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { todayIn } from '../dashboard/dashboard.service';
import { TeachingScope } from '../teaching/teaching-scope.service';
import {
  type ChangePlacementDto,
  type CreateEnrollmentDto,
  type ListEnrollmentsQueryDto,
  type RenewEnrollmentsDto,
  type TransferEnrollmentDto,
  type WithdrawEnrollmentDto,
} from './enrollments.dto';
import {
  CURRENT_STATUSES,
  type EnrollmentRecord,
  EnrollmentsRepository,
} from './enrollments.repository';

type Tx = Prisma.TransactionClient;

export const EnrollmentErrors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'ENROLLMENT_NOT_FOUND', 'La matrícula no existe.'),
  studentNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'STUDENT_NOT_FOUND', 'El estudiante no existe.'),
  yearNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'El año lectivo no existe.'),
  gradeNotFound: () => new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'El grado no existe.'),
  groupNotFound: () => new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'El grupo no existe.'),
  graduated: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'STUDENT_NOT_ENROLLABLE',
      'El estudiante figura como egresado y no puede matricularse.',
    ),
  alreadyCurrent: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ENROLLMENT_ALREADY_CURRENT',
      'El estudiante ya tiene una matrícula vigente en ese año lectivo.',
    ),
  yearClosed: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_CLOSED',
      'El año lectivo está cerrado y no admite cambios.',
    ),
  inactive: (what: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'INACTIVE_REFERENCE',
      `${what} está inactivo(a) y no puede usarse.`,
    ),
  groupMismatch: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'GROUP_MISMATCH',
      'El grupo debe pertenecer al mismo año lectivo y grado de la matrícula.',
    ),
  groupFull: (capacity: number) =>
    new AppException(
      HttpStatus.CONFLICT,
      'GROUP_FULL',
      `El grupo ya completó su cupo (${capacity}).`,
      { capacity },
    ),
  sameGroup: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'SAME_GROUP',
      'El estudiante ya está ubicado en ese grupo.',
    ),
  notCurrent: (status: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'INVALID_STATUS_TRANSITION',
      'La operación solo es posible en matrículas vigentes (prematrícula o matriculado).',
      { status },
    ),
  invalidDate: (message: string) =>
    new ValidationException([{ field: 'date', messages: [message] }]),
};

export function enrollmentView(e: EnrollmentRecord) {
  const current = e.placements.find((p) => p.toDate === null);
  return {
    id: e.id,
    status: e.status,
    enrolledOn: fromDateOnly(e.enrolledOn),
    endedOn: e.endedOn ? fromDateOnly(e.endedOn) : null,
    withdrawalReason: e.withdrawalReason,
    endDetail: e.endDetail,
    student: {
      id: e.student.id,
      code: e.student.code,
      status: e.student.status,
      ...e.student.person,
    },
    academicYear: e.academicYear,
    grade: e.grade,
    currentGroup: current ? current.schoolGroup : null,
    placements: e.placements.map((p) => ({
      id: p.id,
      group: p.schoolGroup,
      fromDate: fromDateOnly(p.fromDate),
      toDate: p.toDate ? fromDateOnly(p.toDate) : null,
      reason: p.reason,
    })),
    previousEnrollmentId: e.previousEnrollmentId,
    createdAt: e.createdAt.toISOString(),
  };
}

export type EnrollmentView = ReturnType<typeof enrollmentView>;

export interface RenewalReport {
  dryRun: boolean;
  created: Array<{ studentId: string; name: string; fromGrade: string; toGrade: string }>;
  skipped: Array<{
    studentId: string;
    name: string;
    reason: 'ALREADY_ENROLLED' | 'LAST_GRADE' | 'STUDENT_NOT_ACTIVE';
  }>;
}

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly repository: EnrollmentsRepository,
    private readonly audit: AuditService,
    private readonly scope: TeachingScope,
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
        entityType: 'enrollment',
        entityId,
        metadata,
        context: client,
      },
      tx,
    );
  }

  private async today(auth: AuthContext): Promise<string> {
    const settings = await this.repository.institutionTimezone(auth.institutionId);
    return todayIn(settings?.timezone ?? 'America/Bogota');
  }

  private async requireCurrent(auth: AuthContext, id: string, tx: Tx): Promise<EnrollmentRecord> {
    const enrollment = await this.repository.lock(auth.institutionId, id, tx);
    if (!enrollment) throw EnrollmentErrors.notFound();
    if (enrollment.academicYear.status === 'CLOSED') throw EnrollmentErrors.yearClosed();
    if (!CURRENT_STATUSES.includes(enrollment.status))
      throw EnrollmentErrors.notCurrent(enrollment.status);
    return enrollment;
  }

  /** Grupo válido para la matrícula: mismo año y grado, activo y con cupo (bloqueado). */
  private async reserveGroup(
    auth: AuthContext,
    groupId: string,
    academicYearId: string,
    gradeId: string,
    tx: Tx,
  ) {
    const result = await this.repository.lockGroupWithOccupancy(auth.institutionId, groupId, tx);
    if (!result) throw EnrollmentErrors.groupNotFound();
    const { group, occupied } = result;
    if (group.academicYearId !== academicYearId || group.gradeId !== gradeId)
      throw EnrollmentErrors.groupMismatch();
    if (group.status !== 'ACTIVE') throw EnrollmentErrors.inactive('El grupo');
    if (group.capacity !== null && occupied >= group.capacity)
      throw EnrollmentErrors.groupFull(group.capacity);
    return group;
  }

  // --- Consultas -------------------------------------------------------------

  async list(
    auth: AuthContext,
    query: ListEnrollmentsQueryDto,
  ): Promise<Paginated<EnrollmentView>> {
    const { items, total } = await this.repository.list(auth.institutionId, {
      ...query,
      scope: await this.scope.enrollmentWhere(auth, PERMISSIONS.ENROLLMENTS_READ),
      ...toPrismaPage(query),
    });
    return paginated(items.map(enrollmentView), total, query);
  }

  async get(auth: AuthContext, id: string): Promise<EnrollmentView> {
    const enrollment = await this.repository.findVisible(
      auth.institutionId,
      id,
      await this.scope.enrollmentWhere(auth, PERMISSIONS.ENROLLMENTS_READ),
    );
    if (!enrollment) throw EnrollmentErrors.notFound();
    return enrollmentView(enrollment);
  }

  /** Resultado de una operación de gestión (no depende del alcance de lectura). */
  private async view(auth: AuthContext, id: string): Promise<EnrollmentView> {
    const enrollment = await this.repository.find(auth.institutionId, id);
    if (!enrollment) throw EnrollmentErrors.notFound();
    return enrollmentView(enrollment);
  }

  // --- Matricular ----------------------------------------------------------

  async create(
    auth: AuthContext,
    dto: CreateEnrollmentDto,
    client: ClientInfo,
  ): Promise<EnrollmentView> {
    const id = await this.repository.transaction((tx) => this.createWithin(auth, dto, client, tx));
    return this.view(auth, id);
  }

  /** Matricula dentro de una transacción existente (p. ej. al matricular un admitido). */
  async createWithin(
    auth: AuthContext,
    dto: CreateEnrollmentDto,
    client: ClientInfo,
    tx: Tx,
  ): Promise<string> {
    const enrolledOn = dto.enrolledOn ?? (await this.today(auth));
    const student = await this.repository.lockStudent(auth.institutionId, dto.studentId, tx);
    if (!student) throw EnrollmentErrors.studentNotFound();
    if (student.status === 'GRADUATED') throw EnrollmentErrors.graduated();

    const year = await this.repository.findYear(auth.institutionId, dto.academicYearId, tx);
    if (!year) throw EnrollmentErrors.yearNotFound();
    if (year.status === 'CLOSED') throw EnrollmentErrors.yearClosed();
    const grade = await this.repository.findGrade(auth.institutionId, dto.gradeId, tx);
    if (!grade) throw EnrollmentErrors.gradeNotFound();
    if (grade.status !== 'ACTIVE') throw EnrollmentErrors.inactive('El grado');

    if (await this.repository.findCurrent(dto.studentId, dto.academicYearId, tx))
      throw EnrollmentErrors.alreadyCurrent();
    if (dto.schoolGroupId)
      await this.reserveGroup(auth, dto.schoolGroupId, dto.academicYearId, dto.gradeId, tx);

    const enrollment = await this.repository.create(
      {
        institutionId: auth.institutionId,
        studentId: dto.studentId,
        academicYearId: dto.academicYearId,
        gradeId: dto.gradeId,
        status: dto.status ?? 'ACTIVE',
        enrolledOn: toDateOnly(enrolledOn),
      },
      tx,
    );
    if (dto.schoolGroupId) {
      await this.repository.createPlacement(
        {
          enrollmentId: enrollment.id,
          schoolGroupId: dto.schoolGroupId,
          fromDate: toDateOnly(enrolledOn),
        },
        tx,
      );
    }
    // Reingreso: un estudiante retirado vuelve a quedar activo al matricularse.
    if (student.status === 'WITHDRAWN')
      await this.repository.setStudentStatus(student.id, 'ACTIVE', tx);

    await this.record(
      auth,
      client,
      'enrollments.enrollment.created',
      enrollment.id,
      {
        studentId: dto.studentId,
        academicYearId: dto.academicYearId,
        gradeId: dto.gradeId,
        schoolGroupId: dto.schoolGroupId ?? null,
        status: enrollment.status,
        readmission: student.status === 'WITHDRAWN',
      },
      tx,
    );
    return enrollment.id;
  }

  async activate(auth: AuthContext, id: string, client: ClientInfo): Promise<EnrollmentView> {
    await this.repository.transaction(async (tx) => {
      const enrollment = await this.requireCurrent(auth, id, tx);
      if (enrollment.status !== 'PRE_ENROLLED')
        throw EnrollmentErrors.notCurrent(enrollment.status);
      await this.repository.update(id, { status: 'ACTIVE' }, tx);
      await this.record(
        auth,
        client,
        'enrollments.enrollment.activated',
        id,
        { from: 'PRE_ENROLLED', to: 'ACTIVE' },
        tx,
      );
    });
    return this.view(auth, id);
  }

  /** Anula una prematrícula registrada por error (se conserva, no se borra). */
  async cancel(auth: AuthContext, id: string, client: ClientInfo): Promise<EnrollmentView> {
    await this.repository.transaction(async (tx) => {
      const enrollment = await this.requireCurrent(auth, id, tx);
      if (enrollment.status !== 'PRE_ENROLLED')
        throw EnrollmentErrors.notCurrent(enrollment.status);
      const today = await this.today(auth);
      await this.closeOpenPlacement(enrollment, today, tx);
      await this.repository.update(id, { status: 'CANCELLED' }, tx);
      await this.record(auth, client, 'enrollments.enrollment.cancelled', id, {}, tx);
    });
    return this.view(auth, id);
  }

  // --- Ubicación en grupo ----------------------------------------------------

  /**
   * Ubica o cambia de grupo. El cambio cierra la ubicación vigente y abre una
   * nueva desde la fecha indicada (el historial se conserva). Si la fecha es
   * la misma en que empezó la ubicación vigente, se trata como corrección.
   */
  async changePlacement(
    auth: AuthContext,
    id: string,
    dto: ChangePlacementDto,
    client: ClientInfo,
  ): Promise<EnrollmentView> {
    const effective = dto.effectiveDate ?? (await this.today(auth));
    await this.repository.transaction(async (tx) => {
      const enrollment = await this.requireCurrent(auth, id, tx);
      const current = enrollment.placements.find((p) => p.toDate === null);
      if (current?.schoolGroupId === dto.schoolGroupId) throw EnrollmentErrors.sameGroup();
      if (effective < fromDateOnly(enrollment.enrolledOn)) {
        throw EnrollmentErrors.invalidDate(
          'El cambio no puede ser anterior a la fecha de matrícula.',
        );
      }
      if (current && effective < fromDateOnly(current.fromDate)) {
        throw EnrollmentErrors.invalidDate(
          'El cambio no puede ser anterior al inicio de la ubicación vigente.',
        );
      }
      await this.reserveGroup(
        auth,
        dto.schoolGroupId,
        enrollment.academicYearId,
        enrollment.gradeId,
        tx,
      );

      const correction = current !== undefined && fromDateOnly(current.fromDate) === effective;
      if (correction) {
        await this.repository.updatePlacement(
          current.id,
          { schoolGroupId: dto.schoolGroupId, reason: dto.reason ?? current.reason },
          tx,
        );
      } else {
        if (current)
          await this.repository.updatePlacement(current.id, { toDate: toDateOnly(effective) }, tx);
        await this.repository.createPlacement(
          {
            enrollmentId: id,
            schoolGroupId: dto.schoolGroupId,
            fromDate: toDateOnly(effective),
            reason: dto.reason ?? null,
          },
          tx,
        );
      }
      await this.record(
        auth,
        client,
        'enrollments.placement.changed',
        id,
        {
          fromGroupId: current?.schoolGroupId ?? null,
          toGroupId: dto.schoolGroupId,
          effectiveDate: effective,
          correction,
          reason: dto.reason ?? null,
        },
        tx,
      );
    });
    return this.view(auth, id);
  }

  private async closeOpenPlacement(enrollment: EnrollmentRecord, date: string, tx: Tx) {
    const current = enrollment.placements.find((p) => p.toDate === null);
    if (!current) return;
    // Nunca antes de su inicio (p. ej. retiro el mismo día de la ubicación).
    const to = date < fromDateOnly(current.fromDate) ? fromDateOnly(current.fromDate) : date;
    await this.repository.updatePlacement(current.id, { toDate: toDateOnly(to) }, tx);
  }

  // --- Retiro y traslado -----------------------------------------------------

  private async end(
    auth: AuthContext,
    id: string,
    params: {
      status: 'WITHDRAWN' | 'TRANSFERRED';
      date: string;
      reason: Prisma.EnrollmentUncheckedUpdateInput['withdrawalReason'];
      detail: string | null;
    },
    client: ClientInfo,
  ): Promise<EnrollmentView> {
    await this.repository.transaction(async (tx) => {
      const enrollment = await this.requireCurrent(auth, id, tx);
      if (params.date < fromDateOnly(enrollment.enrolledOn)) {
        throw EnrollmentErrors.invalidDate(
          'La fecha no puede ser anterior a la fecha de matrícula.',
        );
      }
      await this.closeOpenPlacement(enrollment, params.date, tx);
      await this.repository.update(
        id,
        {
          status: params.status,
          endedOn: toDateOnly(params.date),
          withdrawalReason: params.reason,
          endDetail: params.detail,
        },
        tx,
      );
      // El estudiante deja la institución: queda retirado (puede reingresar después).
      await this.repository.setStudentStatus(enrollment.studentId, 'WITHDRAWN', tx);
      await this.record(
        auth,
        client,
        params.status === 'WITHDRAWN'
          ? 'enrollments.enrollment.withdrawn'
          : 'enrollments.enrollment.transferred',
        id,
        {
          date: params.date,
          reason: params.reason ?? null,
          detail: params.detail,
          from: enrollment.status,
        },
        tx,
      );
    });
    return this.view(auth, id);
  }

  withdraw(auth: AuthContext, id: string, dto: WithdrawEnrollmentDto, client: ClientInfo) {
    return this.end(
      auth,
      id,
      { status: 'WITHDRAWN', date: dto.date, reason: dto.reason, detail: dto.detail ?? null },
      client,
    );
  }

  transfer(auth: AuthContext, id: string, dto: TransferEnrollmentDto, client: ClientInfo) {
    const detail = [`Destino: ${dto.destination}`, dto.detail].filter(Boolean).join('. ');
    return this.end(
      auth,
      id,
      { status: 'TRANSFERRED', date: dto.date, reason: 'RELOCATION', detail: detail.slice(0, 500) },
      client,
    );
  }

  // --- Renovación ------------------------------------------------------------

  /**
   * Crea prematrículas en el año destino a partir de las matrículas activas o
   * finalizadas del año origen, en el siguiente grado o en el mismo. Es
   * idempotente: quien ya tiene matrícula vigente en el destino se omite.
   * La promoción real (según el SIEE de la institución) llega en la Fase 3.
   */
  async renew(
    auth: AuthContext,
    dto: RenewEnrollmentsDto,
    client: ClientInfo,
  ): Promise<RenewalReport> {
    if (dto.fromAcademicYearId === dto.toAcademicYearId) {
      throw new ValidationException([
        {
          field: 'toAcademicYearId',
          messages: ['El año destino debe ser distinto del año origen.'],
        },
      ]);
    }
    const today = await this.today(auth);

    return this.repository.transaction(async (tx) => {
      const from = await this.repository.findYear(auth.institutionId, dto.fromAcademicYearId, tx);
      const to = await this.repository.findYear(auth.institutionId, dto.toAcademicYearId, tx);
      if (!from || !to) throw EnrollmentErrors.yearNotFound();
      if (to.status === 'CLOSED') throw EnrollmentErrors.yearClosed();

      const source = await this.repository.renewable(
        auth.institutionId,
        from.id,
        dto.studentIds,
        tx,
      );
      const grades = await this.repository.orderedGrades(auth.institutionId, tx);
      const already = new Set(
        (
          await this.repository.studentsWithCurrentEnrollment(
            to.id,
            source.map((e) => e.studentId),
            tx,
          )
        ).map((e) => e.studentId),
      );

      const report: RenewalReport = { dryRun: dto.dryRun === true, created: [], skipped: [] };
      for (const enrollment of source) {
        const name = `${enrollment.student.person.firstNames} ${enrollment.student.person.lastNames}`;
        const base = { studentId: enrollment.studentId, name };
        if (enrollment.student.status !== 'ACTIVE') {
          report.skipped.push({ ...base, reason: 'STUDENT_NOT_ACTIVE' });
          continue;
        }
        if (already.has(enrollment.studentId)) {
          report.skipped.push({ ...base, reason: 'ALREADY_ENROLLED' });
          continue;
        }
        const index = grades.findIndex((g) => g.id === enrollment.gradeId);
        const target = dto.gradeStrategy === 'SAME' ? grades[index] : grades[index + 1];
        if (!target) {
          report.skipped.push({ ...base, reason: 'LAST_GRADE' });
          continue;
        }
        report.created.push({ ...base, fromGrade: enrollment.grade.name, toGrade: target.name });
        if (!report.dryRun) {
          await this.repository.create(
            {
              institutionId: auth.institutionId,
              studentId: enrollment.studentId,
              academicYearId: to.id,
              gradeId: target.id,
              status: 'PRE_ENROLLED',
              enrolledOn: toDateOnly(today),
              previousEnrollmentId: enrollment.id,
            },
            tx,
          );
        }
      }

      if (!report.dryRun) {
        await this.audit.record(
          {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            action: 'enrollments.renewal.completed',
            entityType: 'academic_year',
            entityId: to.id,
            metadata: {
              fromAcademicYearId: from.id,
              gradeStrategy: dto.gradeStrategy,
              created: report.created.length,
              skipped: report.skipped.length,
            },
            context: client,
          },
          tx,
        );
      }
      return report;
    });
  }
}

import { PERMISSIONS } from '@educore/shared';
import { Injectable } from '@nestjs/common';
import { fromDateOnly, toDateOnly } from '../../common/validation/colombia';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { todayIn } from '../dashboard/dashboard.service';
import { TeachingScope } from './teaching-scope.service';
import {
  type CreateAssignmentDto,
  type EndAssignmentDto,
  type ListAssignmentsQueryDto,
  type ReplaceAssignmentDto,
} from './teaching.dto';
import { TeachingErrors } from './teaching.errors';
import { type AssignmentRecord, TeachingRepository } from './teaching.repository';

type Tx = Prisma.TransactionClient;
type Group = NonNullable<Awaited<ReturnType<TeachingRepository['lockGroup']>>>;

export function assignmentView(a: AssignmentRecord) {
  const { schoolGroup: g, staffMember: t } = a;
  return {
    id: a.id,
    academicYear: g.academicYear,
    group: { id: g.id, code: g.code, name: g.name, gradeId: g.gradeId, gradeName: g.grade.name },
    subject: a.subject,
    teacher: { id: t.id, status: t.status, ...t.person },
    fromDate: fromDateOnly(a.fromDate),
    toDate: a.toDate ? fromDateOnly(a.toDate) : null,
    current: a.toDate === null,
  };
}

export type AssignmentView = ReturnType<typeof assignmentView>;

/**
 * Asignación académica: qué docente dicta cada asignatura en cada grupo.
 *
 * - Solo se asignan docentes activos, y solo asignaturas del plan de estudios
 *   del grado del grupo para ese año.
 * - Una asignatura de un grupo tiene un único docente vigente (también lo
 *   garantiza un índice único parcial en la base de datos).
 * - Los reemplazos y finalizaciones conservan el historial con fechas.
 */
@Injectable()
export class TeachingAssignmentsService {
  constructor(
    private readonly repository: TeachingRepository,
    private readonly scope: TeachingScope,
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
        entityType: 'teaching_assignment',
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

  // --- Consultas -------------------------------------------------------------

  async list(auth: AuthContext, query: ListAssignmentsQueryDto): Promise<AssignmentView[]> {
    const own = await this.scope.staffFilter(auth, PERMISSIONS.TEACHING_READ);
    if (own === 'NONE') return [];
    if (own && query.staffMemberId && query.staffMemberId !== own) return [];
    const items = await this.repository.listAssignments(auth.institutionId, {
      academicYearId: query.academicYearId,
      schoolGroupId: query.schoolGroupId,
      subjectId: query.subjectId,
      staffMemberId: own ?? query.staffMemberId,
      includeEnded: query.includeEnded === 'true',
    });
    return items.map(assignmentView);
  }

  /** Una asignación visible para el usuario (con ASSIGNED, solo las propias). */
  private async requireVisible(auth: AuthContext, id: string): Promise<AssignmentRecord> {
    const assignment = await this.repository.findAssignment(auth.institutionId, id);
    if (!assignment) throw TeachingErrors.notFound('La asignación');
    const own = await this.scope.staffFilter(auth, PERMISSIONS.TEACHING_READ);
    if (own !== null && assignment.staffMemberId !== own) {
      throw TeachingErrors.notFound('La asignación');
    }
    return assignment;
  }

  async get(auth: AuthContext, id: string): Promise<AssignmentView> {
    return assignmentView(await this.requireVisible(auth, id));
  }

  /** Lista de clase del grupo de la asignación (estudiantes ubicados hoy). */
  async roster(auth: AuthContext, id: string) {
    const assignment = await this.requireVisible(auth, id);
    const rows = await this.repository.roster(assignment.schoolGroupId);
    return {
      assignment: assignmentView(assignment),
      students: rows.map(({ fromDate, enrollment: { student, ...enrollment } }) => ({
        studentId: student.id,
        code: student.code,
        ...student.person,
        enrollmentId: enrollment.id,
        enrollmentStatus: enrollment.status,
        inGroupSince: fromDateOnly(fromDate),
      })),
    };
  }

  // --- Validaciones ----------------------------------------------------------

  private async requireOpenGroup(auth: AuthContext, groupId: string, tx: Tx): Promise<Group> {
    const group = await this.repository.lockGroup(auth.institutionId, groupId, tx);
    if (!group) throw TeachingErrors.notFound('El grupo');
    if (group.academicYear.status === 'CLOSED') throw TeachingErrors.yearClosed();
    return group;
  }

  private async requireTeacher(auth: AuthContext, staffMemberId: string, tx: Tx) {
    const staff = await this.repository.lockStaffShared(auth.institutionId, staffMemberId, tx);
    if (!staff) throw TeachingErrors.notFound('El docente');
    if (staff.staffType !== 'TEACHER') throw TeachingErrors.notATeacher();
    if (staff.status !== 'ACTIVE') throw TeachingErrors.inactive('El docente');
    return staff;
  }

  /** La fecha debe caer dentro del año lectivo del grupo. */
  private checkWithinYear(field: string, date: string, group: Group) {
    const starts = fromDateOnly(group.academicYear.startsOn);
    const ends = fromDateOnly(group.academicYear.endsOn);
    if (date < starts || date > ends) {
      throw TeachingErrors.invalid(
        field,
        `La fecha debe estar dentro del año lectivo (${starts} a ${ends}).`,
      );
    }
  }

  /** Por defecto, hoy; si el año aún no empieza, su fecha de inicio. */
  private async defaultDate(auth: AuthContext, group: Group): Promise<string> {
    const today = await this.today(auth);
    const starts = fromDateOnly(group.academicYear.startsOn);
    return today < starts ? starts : today;
  }

  // --- Operaciones -----------------------------------------------------------

  async create(
    auth: AuthContext,
    dto: CreateAssignmentDto,
    client: ClientInfo,
  ): Promise<AssignmentView> {
    const id = await this.repository.transaction(async (tx) => {
      const group = await this.requireOpenGroup(auth, dto.schoolGroupId, tx);
      if (group.status !== 'ACTIVE') throw TeachingErrors.inactive('El grupo');
      const subject = await this.repository.findSubject(auth.institutionId, dto.subjectId, tx);
      if (!subject) throw TeachingErrors.notFound('La asignatura');
      if (subject.status !== 'ACTIVE') throw TeachingErrors.inactive('La asignatura');
      const inPlan = await this.repository.findCurriculumByKey(
        auth.institutionId,
        group.academicYearId,
        group.gradeId,
        dto.subjectId,
        tx,
      );
      if (!inPlan) throw TeachingErrors.notInCurriculum();
      await this.requireTeacher(auth, dto.staffMemberId, tx);
      if (await this.repository.findCurrentAssignment(group.id, dto.subjectId, tx)) {
        throw TeachingErrors.alreadyAssigned();
      }

      const fromDate = dto.fromDate ?? (await this.defaultDate(auth, group));
      this.checkWithinYear('fromDate', fromDate, group);

      const created = await this.repository.createAssignment(
        {
          institutionId: auth.institutionId,
          schoolGroupId: group.id,
          subjectId: dto.subjectId,
          staffMemberId: dto.staffMemberId,
          fromDate: toDateOnly(fromDate),
        },
        tx,
      );
      await this.record(
        auth,
        client,
        'teaching.assignment.created',
        created.id,
        {
          schoolGroupId: group.id,
          subjectId: dto.subjectId,
          staffMemberId: dto.staffMemberId,
          fromDate,
        },
        tx,
      );
      return created.id;
    });
    return this.view(auth, id);
  }

  /**
   * Reemplaza al docente: cierra la asignación vigente y abre otra desde la
   * fecha indicada. Si la fecha es la misma en que empezó la vigente, se trata
   * como corrección (se cambia el docente sin crear historial).
   */
  async replace(
    auth: AuthContext,
    id: string,
    dto: ReplaceAssignmentDto,
    client: ClientInfo,
  ): Promise<AssignmentView> {
    const newId = await this.repository.transaction(async (tx) => {
      const { current, group } = await this.lockCurrent(auth, id, tx);
      if (current.staffMemberId === dto.staffMemberId) throw TeachingErrors.sameTeacher();
      await this.requireTeacher(auth, dto.staffMemberId, tx);

      const effective = dto.effectiveDate ?? (await this.defaultDate(auth, group));
      const startedOn = fromDateOnly(current.fromDate);
      if (effective < startedOn) {
        throw TeachingErrors.invalid(
          'effectiveDate',
          `La fecha no puede ser anterior al inicio de la asignación actual (${startedOn}).`,
        );
      }
      this.checkWithinYear('effectiveDate', effective, group);

      let resultId: string;
      if (effective === startedOn) {
        await this.repository.updateAssignment(id, { staffMemberId: dto.staffMemberId }, tx);
        resultId = id;
      } else {
        await this.repository.updateAssignment(id, { toDate: toDateOnly(effective) }, tx);
        const created = await this.repository.createAssignment(
          {
            institutionId: auth.institutionId,
            schoolGroupId: current.schoolGroupId,
            subjectId: current.subjectId,
            staffMemberId: dto.staffMemberId,
            fromDate: toDateOnly(effective),
          },
          tx,
        );
        resultId = created.id;
      }
      await this.record(
        auth,
        client,
        'teaching.assignment.replaced',
        resultId,
        {
          previousAssignmentId: id,
          fromStaffMemberId: current.staffMemberId,
          toStaffMemberId: dto.staffMemberId,
          effectiveDate: effective,
          correction: effective === startedOn,
        },
        tx,
      );
      return resultId;
    });
    return this.view(auth, newId);
  }

  /** Finaliza la asignación (la asignatura queda sin docente vigente en el grupo). */
  async end(
    auth: AuthContext,
    id: string,
    dto: EndAssignmentDto,
    client: ClientInfo,
  ): Promise<AssignmentView> {
    await this.repository.transaction(async (tx) => {
      const { current, group } = await this.lockCurrent(auth, id, tx);
      const date = dto.date ?? (await this.defaultDate(auth, group));
      const startedOn = fromDateOnly(current.fromDate);
      if (date < startedOn) {
        throw TeachingErrors.invalid(
          'date',
          `La fecha no puede ser anterior al inicio de la asignación (${startedOn}).`,
        );
      }
      await this.repository.updateAssignment(id, { toDate: toDateOnly(date) }, tx);
      await this.record(auth, client, 'teaching.assignment.ended', id, { date }, tx);
    });
    return this.view(auth, id);
  }

  /**
   * Asignación vigente con su grupo bloqueado. Se vuelve a leer después del
   * bloqueo para no actuar sobre un estado que otra operación ya cambió.
   */
  private async lockCurrent(auth: AuthContext, id: string, tx: Tx) {
    const found = await this.repository.findAssignment(auth.institutionId, id, tx);
    if (!found) throw TeachingErrors.notFound('La asignación');
    const group = await this.requireOpenGroup(auth, found.schoolGroupId, tx);
    const current = await this.repository.findAssignment(auth.institutionId, id, tx);
    if (!current || current.toDate !== null) throw TeachingErrors.assignmentEnded();
    return { current, group };
  }

  /** Resultado de una operación de gestión (no depende del alcance de lectura). */
  private async view(auth: AuthContext, id: string): Promise<AssignmentView> {
    const assignment = await this.repository.findAssignment(auth.institutionId, id);
    if (!assignment) throw TeachingErrors.notFound('La asignación');
    return assignmentView(assignment);
  }
}

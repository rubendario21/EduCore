import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

export const curriculumInclude = {
  grade: { select: { id: true, code: true, name: true } },
  subject: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      subjectArea: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CurriculumSubjectInclude;

export type CurriculumRecord = Prisma.CurriculumSubjectGetPayload<{
  include: typeof curriculumInclude;
}>;

export const assignmentInclude = {
  schoolGroup: {
    select: {
      id: true,
      code: true,
      name: true,
      gradeId: true,
      grade: { select: { name: true } },
      academicYear: { select: { id: true, year: true, status: true } },
    },
  },
  subject: { select: { id: true, code: true, name: true } },
  staffMember: {
    select: {
      id: true,
      status: true,
      person: {
        select: { firstNames: true, lastNames: true, documentType: true, documentNumber: true },
      },
    },
  },
} satisfies Prisma.TeachingAssignmentInclude;

export type AssignmentRecord = Prisma.TeachingAssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

/** Matrículas vigentes: ocupan un lugar en el grupo. */
const CURRENT_ENROLLMENT = { status: { in: ['PRE_ENROLLED' as const, 'ACTIVE' as const] } };

/** Consultas del plan de estudios y la asignación académica; siempre por institución. */
@Injectable()
export class TeachingRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30_000 });
  }

  institutionTimezone(institutionId: string) {
    return this.prisma.institutionSettings.findUnique({
      where: { institutionId },
      select: { timezone: true },
    });
  }

  findYear(institutionId: string, id: string, db: Db = this.prisma) {
    return db.academicYear.findFirst({ where: { id, institutionId } });
  }

  findGrade(institutionId: string, id: string, db: Db = this.prisma) {
    return db.grade.findFirst({ where: { id, institutionId } });
  }

  findSubject(institutionId: string, id: string, db: Db = this.prisma) {
    return db.subject.findFirst({ where: { id, institutionId } });
  }

  /**
   * Docente con bloqueo compartido: impide que se desactive mientras se le
   * asigna una asignatura (la desactivación toma el bloqueo exclusivo).
   */
  async lockStaffShared(institutionId: string, id: string, db: Db) {
    await db.$executeRaw`SELECT 1 FROM staff_member WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR SHARE`;
    return db.staffMember.findFirst({ where: { id, institutionId } });
  }

  /** Bloqueo exclusivo del miembro del personal (antes de desactivarlo o cambiar su tipo). */
  async lockStaff(id: string, db: Db) {
    await db.$executeRaw`SELECT 1 FROM staff_member WHERE id = ${id}::uuid FOR UPDATE`;
  }

  // --- Plan de estudios ------------------------------------------------------

  listCurriculum(institutionId: string, academicYearId: string, gradeId?: string) {
    return this.prisma.curriculumSubject.findMany({
      where: { institutionId, academicYearId, ...(gradeId && { gradeId }) },
      include: curriculumInclude,
      orderBy: [
        { grade: { educationLevel: { sortOrder: 'asc' } } },
        { grade: { sortOrder: 'asc' } },
        { subject: { subjectArea: { name: 'asc' } } },
        { subject: { name: 'asc' } },
      ],
    });
  }

  findCurriculumEntry(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<CurriculumRecord | null> {
    return db.curriculumSubject.findFirst({
      where: { id, institutionId },
      include: curriculumInclude,
    });
  }

  findCurriculumByKey(
    institutionId: string,
    academicYearId: string,
    gradeId: string,
    subjectId: string,
    db: Db,
  ) {
    return db.curriculumSubject.findUnique({
      where: {
        institutionId_academicYearId_gradeId_subjectId: {
          institutionId,
          academicYearId,
          gradeId,
          subjectId,
        },
      },
    });
  }

  curriculumOfYear(institutionId: string, academicYearId: string, db: Db) {
    return db.curriculumSubject.findMany({
      where: { institutionId, academicYearId },
      include: {
        grade: { select: { status: true } },
        subject: { select: { status: true } },
      },
    });
  }

  createCurriculumEntry(data: Prisma.CurriculumSubjectUncheckedCreateInput, db: Db) {
    return db.curriculumSubject.create({ data, include: curriculumInclude });
  }

  updateCurriculumEntry(id: string, weeklyHours: number, db: Db) {
    return db.curriculumSubject.update({
      where: { id },
      data: { weeklyHours },
      include: curriculumInclude,
    });
  }

  deleteCurriculumEntry(id: string, db: Db) {
    return db.curriculumSubject.delete({ where: { id } });
  }

  /** Asignaciones (vigentes o históricas) de la asignatura en grupos de ese año y grado. */
  countAssignmentsForCurriculum(
    academicYearId: string,
    gradeId: string,
    subjectId: string,
    db: Db,
  ) {
    return db.teachingAssignment.count({
      where: { subjectId, schoolGroup: { academicYearId, gradeId } },
    });
  }

  // --- Asignación académica --------------------------------------------------

  listAssignments(
    institutionId: string,
    filter: {
      academicYearId?: string;
      schoolGroupId?: string;
      staffMemberId?: string;
      subjectId?: string;
      includeEnded: boolean;
    },
  ) {
    return this.prisma.teachingAssignment.findMany({
      where: {
        institutionId,
        ...(filter.schoolGroupId && { schoolGroupId: filter.schoolGroupId }),
        ...(filter.staffMemberId && { staffMemberId: filter.staffMemberId }),
        ...(filter.subjectId && { subjectId: filter.subjectId }),
        ...(filter.academicYearId && {
          schoolGroup: { academicYearId: filter.academicYearId },
        }),
        ...(!filter.includeEnded && { toDate: null }),
      },
      include: assignmentInclude,
      orderBy: [
        { schoolGroup: { academicYear: { year: 'desc' } } },
        { schoolGroup: { grade: { sortOrder: 'asc' } } },
        { schoolGroup: { code: 'asc' } },
        { subject: { name: 'asc' } },
        { fromDate: 'asc' },
      ],
    });
  }

  findAssignment(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<AssignmentRecord | null> {
    return db.teachingAssignment.findFirst({
      where: { id, institutionId },
      include: assignmentInclude,
    });
  }

  /** Bloquea el grupo: serializa las asignaciones de sus asignaturas. */
  async lockGroup(institutionId: string, id: string, db: Db) {
    await db.$executeRaw`SELECT 1 FROM school_group WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return db.schoolGroup.findFirst({
      where: { id, institutionId },
      include: { academicYear: true },
    });
  }

  findCurrentAssignment(schoolGroupId: string, subjectId: string, db: Db) {
    return db.teachingAssignment.findFirst({ where: { schoolGroupId, subjectId, toDate: null } });
  }

  createAssignment(data: Prisma.TeachingAssignmentUncheckedCreateInput, db: Db) {
    return db.teachingAssignment.create({ data });
  }

  updateAssignment(id: string, data: Prisma.TeachingAssignmentUncheckedUpdateInput, db: Db) {
    return db.teachingAssignment.update({ where: { id }, data });
  }

  /** Lista de clase: estudiantes con matrícula vigente ubicados hoy en el grupo. */
  roster(schoolGroupId: string) {
    return this.prisma.groupPlacement.findMany({
      where: { schoolGroupId, toDate: null, enrollment: CURRENT_ENROLLMENT },
      select: {
        fromDate: true,
        enrollment: {
          select: {
            id: true,
            status: true,
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
      orderBy: [
        { enrollment: { student: { person: { lastNames: 'asc' } } } },
        { enrollment: { student: { person: { firstNames: 'asc' } } } },
      ],
    });
  }

  // --- Alcance ASSIGNED ------------------------------------------------------

  /** Perfil de personal de la persona dueña de la membresía (si existe). */
  async staffOfMembership(membershipId: string) {
    const membership = await this.prisma.userInstitution.findUnique({
      where: { id: membershipId },
      select: { person: { select: { staff: { select: { id: true, status: true } } } } },
    });
    return membership?.person?.staff ?? null;
  }

  /** Grupos con asignación vigente del docente en años no cerrados. */
  async assignedGroupIds(staffMemberId: string): Promise<string[]> {
    const rows = await this.prisma.teachingAssignment.findMany({
      where: {
        staffMemberId,
        toDate: null,
        schoolGroup: { academicYear: { status: { not: 'CLOSED' } } },
      },
      select: { schoolGroupId: true },
      distinct: ['schoolGroupId'],
    });
    return rows.map((r) => r.schoolGroupId);
  }

  countCurrentAssignmentsOfStaff(staffMemberId: string, db: Db) {
    return db.teachingAssignment.count({ where: { staffMemberId, toDate: null } });
  }
}

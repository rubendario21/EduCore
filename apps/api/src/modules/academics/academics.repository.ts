import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

const schoolGroupInclude = {
  academicYear: { select: { year: true, status: true } },
  grade: { select: { name: true } },
  campus: { select: { name: true } },
  shift: { select: { name: true } },
} satisfies Prisma.SchoolGroupInclude;

export type SchoolGroupRecord = Prisma.SchoolGroupGetPayload<{
  include: typeof schoolGroupInclude;
}>;

const yearInclude = {
  periods: { orderBy: { number: 'asc' } },
} satisfies Prisma.AcademicYearInclude;

export type AcademicYearRecord = Prisma.AcademicYearGetPayload<{ include: typeof yearInclude }>;

/**
 * Consultas de la estructura académica. Toda búsqueda por id incluye la
 * institución: un id de otra institución se trata como inexistente.
 */
@Injectable()
export class AcademicsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  // --- Niveles --------------------------------------------------------------

  listLevels(institutionId: string) {
    return this.prisma.educationLevel.findMany({
      where: { institutionId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findLevel(institutionId: string, id: string, db: Db = this.prisma) {
    return db.educationLevel.findFirst({ where: { id, institutionId } });
  }

  findLevelByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.educationLevel.findUnique({ where: { institutionId_code: { institutionId, code } } });
  }

  createLevel(data: Prisma.EducationLevelUncheckedCreateInput, db: Db) {
    return db.educationLevel.create({ data });
  }

  updateLevel(id: string, data: Prisma.EducationLevelUncheckedUpdateInput, db: Db) {
    return db.educationLevel.update({ where: { id }, data });
  }

  countActiveGradesOfLevel(educationLevelId: string, db: Db) {
    return db.grade.count({ where: { educationLevelId, status: 'ACTIVE' } });
  }

  // --- Grados ---------------------------------------------------------------

  listGrades(institutionId: string, educationLevelId?: string) {
    return this.prisma.grade.findMany({
      where: { institutionId, ...(educationLevelId && { educationLevelId }) },
      include: { educationLevel: { select: { name: true, sortOrder: true } } },
      orderBy: [{ educationLevel: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findGrade(institutionId: string, id: string, db: Db = this.prisma) {
    return db.grade.findFirst({
      where: { id, institutionId },
      include: { educationLevel: { select: { name: true, sortOrder: true } } },
    });
  }

  findGradeByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.grade.findUnique({ where: { institutionId_code: { institutionId, code } } });
  }

  createGrade(data: Prisma.GradeUncheckedCreateInput, db: Db) {
    return db.grade.create({
      data,
      include: { educationLevel: { select: { name: true, sortOrder: true } } },
    });
  }

  updateGrade(id: string, data: Prisma.GradeUncheckedUpdateInput, db: Db) {
    return db.grade.update({
      where: { id },
      data,
      include: { educationLevel: { select: { name: true, sortOrder: true } } },
    });
  }

  // --- Áreas ----------------------------------------------------------------

  listAreas(institutionId: string) {
    return this.prisma.subjectArea.findMany({ where: { institutionId }, orderBy: { name: 'asc' } });
  }

  findArea(institutionId: string, id: string, db: Db = this.prisma) {
    return db.subjectArea.findFirst({ where: { id, institutionId } });
  }

  findAreaByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.subjectArea.findUnique({ where: { institutionId_code: { institutionId, code } } });
  }

  createArea(data: Prisma.SubjectAreaUncheckedCreateInput, db: Db) {
    return db.subjectArea.create({ data });
  }

  updateArea(id: string, data: Prisma.SubjectAreaUncheckedUpdateInput, db: Db) {
    return db.subjectArea.update({ where: { id }, data });
  }

  countActiveSubjectsOfArea(subjectAreaId: string, db: Db) {
    return db.subject.count({ where: { subjectAreaId, status: 'ACTIVE' } });
  }

  // --- Asignaturas ----------------------------------------------------------

  listSubjects(institutionId: string, subjectAreaId?: string) {
    return this.prisma.subject.findMany({
      where: { institutionId, ...(subjectAreaId && { subjectAreaId }) },
      include: { subjectArea: { select: { name: true } } },
      orderBy: [{ subjectArea: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  findSubject(institutionId: string, id: string, db: Db = this.prisma) {
    return db.subject.findFirst({
      where: { id, institutionId },
      include: { subjectArea: { select: { name: true } } },
    });
  }

  findSubjectByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.subject.findUnique({ where: { institutionId_code: { institutionId, code } } });
  }

  createSubject(data: Prisma.SubjectUncheckedCreateInput, db: Db) {
    return db.subject.create({ data, include: { subjectArea: { select: { name: true } } } });
  }

  updateSubject(id: string, data: Prisma.SubjectUncheckedUpdateInput, db: Db) {
    return db.subject.update({
      where: { id },
      data,
      include: { subjectArea: { select: { name: true } } },
    });
  }

  // --- Años y períodos ------------------------------------------------------

  listYears(institutionId: string) {
    return this.prisma.academicYear.findMany({
      where: { institutionId },
      include: yearInclude,
      orderBy: { year: 'desc' },
    });
  }

  findYear(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<AcademicYearRecord | null> {
    return db.academicYear.findFirst({ where: { id, institutionId }, include: yearInclude });
  }

  /** Bloquea la fila del año durante la transacción (cambios de períodos y de estado). */
  async lockYear(institutionId: string, id: string, db: Db): Promise<AcademicYearRecord | null> {
    await db.$executeRaw`SELECT 1 FROM academic_year WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return this.findYear(institutionId, id, db);
  }

  findYearByNumber(institutionId: string, year: number, db: Db = this.prisma) {
    return db.academicYear.findUnique({ where: { institutionId_year: { institutionId, year } } });
  }

  findActiveYear(institutionId: string, db: Db = this.prisma) {
    return db.academicYear.findFirst({ where: { institutionId, status: 'ACTIVE' } });
  }

  createYear(data: Prisma.AcademicYearUncheckedCreateInput, db: Db) {
    return db.academicYear.create({ data });
  }

  updateYear(id: string, data: Prisma.AcademicYearUncheckedUpdateInput, db: Db) {
    return db.academicYear.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }

  /** Cambia el estado solo si sigue siendo el esperado (control de concurrencia). */
  async transitionYear(
    id: string,
    from: Prisma.AcademicYearWhereInput['status'],
    to: 'ACTIVE' | 'CLOSED',
    db: Db,
  ): Promise<boolean> {
    const { count } = await db.academicYear.updateMany({
      where: { id, status: from },
      data: { status: to, version: { increment: 1 } },
    });
    return count === 1;
  }

  findPeriod(institutionId: string, id: string, db: Db = this.prisma) {
    return db.academicPeriod.findFirst({ where: { id, academicYear: { institutionId } } });
  }

  createPeriod(data: Prisma.AcademicPeriodUncheckedCreateInput, db: Db) {
    return db.academicPeriod.create({ data });
  }

  updatePeriod(id: string, data: Prisma.AcademicPeriodUncheckedUpdateInput, db: Db) {
    return db.academicPeriod.update({ where: { id }, data });
  }

  deletePeriod(id: string, db: Db) {
    return db.academicPeriod.delete({ where: { id } });
  }

  // --- Grupos ---------------------------------------------------------------

  listGroups(
    institutionId: string,
    filter: { academicYearId?: string; gradeId?: string; campusId?: string },
  ) {
    return this.prisma.schoolGroup.findMany({
      where: { institutionId, ...filter },
      include: schoolGroupInclude,
      orderBy: [
        { academicYear: { year: 'desc' } },
        { grade: { sortOrder: 'asc' } },
        { code: 'asc' },
      ],
    });
  }

  findGroup(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<SchoolGroupRecord | null> {
    return db.schoolGroup.findFirst({ where: { id, institutionId }, include: schoolGroupInclude });
  }

  findGroupByCode(
    institutionId: string,
    academicYearId: string,
    campusId: string,
    code: string,
    db: Db,
  ) {
    return db.schoolGroup.findUnique({
      where: {
        institutionId_academicYearId_campusId_code: {
          institutionId,
          academicYearId,
          campusId,
          code,
        },
      },
    });
  }

  findCampus(institutionId: string, id: string, db: Db) {
    return db.campus.findFirst({ where: { id, institutionId } });
  }

  findShift(institutionId: string, id: string, db: Db) {
    return db.shift.findFirst({ where: { id, institutionId } });
  }

  createGroup(data: Prisma.SchoolGroupUncheckedCreateInput, db: Db) {
    return db.schoolGroup.create({ data, include: schoolGroupInclude });
  }

  updateGroup(id: string, data: Prisma.SchoolGroupUncheckedUpdateInput, db: Db) {
    return db.schoolGroup.update({ where: { id }, data, include: schoolGroupInclude });
  }

  /** Estudiantes ubicados hoy en el grupo con matrícula vigente. */
  countCurrentPlacements(schoolGroupId: string, db: Db) {
    return db.groupPlacement.count({
      where: {
        schoolGroupId,
        toDate: null,
        enrollment: { status: { in: ['PRE_ENROLLED', 'ACTIVE'] } },
      },
    });
  }

  /** Asignaturas del grupo con docente vigente. */
  countCurrentAssignments(schoolGroupId: string, db: Db) {
    return db.teachingAssignment.count({ where: { schoolGroupId, toDate: null } });
  }

  countOpenGroupsOfGrade(gradeId: string, db: Db) {
    return db.schoolGroup.count({
      where: { gradeId, status: 'ACTIVE', academicYear: { status: { not: 'CLOSED' } } },
    });
  }
}

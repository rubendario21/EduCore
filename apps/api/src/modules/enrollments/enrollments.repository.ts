import { Injectable } from '@nestjs/common';
import { normalizeSearch } from '../../common/search';
import { type EnrollmentStatus, type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

/** Estados en los que la matrícula está vigente (ocupa cupo). */
export const CURRENT_STATUSES: EnrollmentStatus[] = ['PRE_ENROLLED', 'ACTIVE'];

export const enrollmentInclude = {
  student: {
    select: {
      id: true,
      code: true,
      status: true,
      person: {
        select: { firstNames: true, lastNames: true, documentType: true, documentNumber: true },
      },
    },
  },
  academicYear: { select: { id: true, year: true, name: true, status: true } },
  grade: { select: { id: true, name: true } },
  placements: {
    include: { schoolGroup: { select: { id: true, code: true, name: true } } },
    orderBy: { fromDate: 'asc' },
  },
} satisfies Prisma.EnrollmentInclude;

export type EnrollmentRecord = Prisma.EnrollmentGetPayload<{ include: typeof enrollmentInclude }>;

/** Consultas de matrícula; siempre por institución. */
@Injectable()
export class EnrollmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30_000 });
  }

  async list(
    institutionId: string,
    filter: {
      academicYearId?: string;
      gradeId?: string;
      schoolGroupId?: string;
      studentId?: string;
      status?: EnrollmentStatus;
      search?: string;
      /** Restricción de alcance (ASSIGNED); sin ella, toda la institución. */
      scope?: Prisma.EnrollmentWhereInput;
      skip: number;
      take: number;
    },
  ) {
    const where: Prisma.EnrollmentWhereInput = {
      institutionId,
      ...(filter.scope && { AND: [filter.scope] }),
      ...(filter.academicYearId && { academicYearId: filter.academicYearId }),
      ...(filter.gradeId && { gradeId: filter.gradeId }),
      ...(filter.studentId && { studentId: filter.studentId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.schoolGroupId && {
        placements: { some: { schoolGroupId: filter.schoolGroupId, toDate: null } },
      }),
      ...(filter.search && {
        student: {
          OR: [
            { person: { searchText: { contains: normalizeSearch(filter.search) } } },
            { code: { contains: filter.search, mode: 'insensitive' } },
          ],
        },
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.enrollment.findMany({
        where,
        include: enrollmentInclude,
        orderBy: [
          { student: { person: { lastNames: 'asc' } } },
          { student: { person: { firstNames: 'asc' } } },
        ],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.enrollment.count({ where }),
    ]);
    return { items, total };
  }

  /** Matrícula dentro del alcance del usuario (fuera de él se trata como inexistente). */
  findVisible(institutionId: string, id: string, scope?: Prisma.EnrollmentWhereInput) {
    return this.prisma.enrollment.findFirst({
      where: { id, institutionId, ...(scope && { AND: [scope] }) },
      include: enrollmentInclude,
    });
  }

  find(institutionId: string, id: string, db: Db = this.prisma): Promise<EnrollmentRecord | null> {
    return db.enrollment.findFirst({ where: { id, institutionId }, include: enrollmentInclude });
  }

  /** Bloquea la matrícula durante la transacción. */
  async lock(institutionId: string, id: string, db: Db): Promise<EnrollmentRecord | null> {
    await db.$executeRaw`SELECT 1 FROM enrollment WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return this.find(institutionId, id, db);
  }

  findStudent(institutionId: string, id: string, db: Db) {
    return db.student.findFirst({
      where: { id, institutionId },
      select: { id: true, status: true },
    });
  }

  /** Bloquea al estudiante: serializa la creación de matrículas del mismo estudiante. */
  async lockStudent(institutionId: string, id: string, db: Db) {
    await db.$executeRaw`SELECT 1 FROM student WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return this.findStudent(institutionId, id, db);
  }

  setStudentStatus(id: string, status: 'ACTIVE' | 'WITHDRAWN', db: Db) {
    return db.student.update({ where: { id }, data: { status } });
  }

  findYear(institutionId: string, id: string, db: Db) {
    return db.academicYear.findFirst({ where: { id, institutionId } });
  }

  findGrade(institutionId: string, id: string, db: Db) {
    return db.grade.findFirst({ where: { id, institutionId } });
  }

  /** Grados activos en orden académico (nivel y grado). */
  orderedGrades(institutionId: string, db: Db) {
    return db.grade.findMany({
      where: { institutionId, status: 'ACTIVE' },
      orderBy: [{ educationLevel: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
  }

  findCurrent(studentId: string, academicYearId: string, db: Db) {
    return db.enrollment.findFirst({
      where: { studentId, academicYearId, status: { in: CURRENT_STATUSES } },
      select: { id: true },
    });
  }

  /**
   * Bloquea el grupo y cuenta su ocupación vigente: así dos matrículas
   * simultáneas no pueden superar el cupo.
   */
  async lockGroupWithOccupancy(institutionId: string, groupId: string, db: Db) {
    await db.$executeRaw`SELECT 1 FROM school_group WHERE id = ${groupId}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    const group = await db.schoolGroup.findFirst({ where: { id: groupId, institutionId } });
    if (!group) return null;
    const occupied = await db.groupPlacement.count({
      where: {
        schoolGroupId: groupId,
        toDate: null,
        enrollment: { status: { in: CURRENT_STATUSES } },
      },
    });
    return { group, occupied };
  }

  create(data: Prisma.EnrollmentUncheckedCreateInput, db: Db) {
    return db.enrollment.create({ data });
  }

  update(id: string, data: Prisma.EnrollmentUncheckedUpdateInput, db: Db) {
    return db.enrollment.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }

  createPlacement(data: Prisma.GroupPlacementUncheckedCreateInput, db: Db) {
    return db.groupPlacement.create({ data });
  }

  updatePlacement(id: string, data: Prisma.GroupPlacementUncheckedUpdateInput, db: Db) {
    return db.groupPlacement.update({ where: { id }, data });
  }

  /** Matrículas de un año que pueden renovarse (vigentes o finalizadas). */
  renewable(
    institutionId: string,
    academicYearId: string,
    studentIds: string[] | undefined,
    db: Db,
  ) {
    return db.enrollment.findMany({
      where: {
        institutionId,
        academicYearId,
        status: { in: ['ACTIVE', 'COMPLETED'] },
        ...(studentIds && { studentId: { in: studentIds } }),
      },
      include: {
        student: {
          select: {
            id: true,
            status: true,
            person: { select: { firstNames: true, lastNames: true } },
          },
        },
        grade: { select: { id: true, name: true } },
      },
    });
  }

  studentsWithCurrentEnrollment(academicYearId: string, studentIds: string[], db: Db) {
    return db.enrollment.findMany({
      where: { academicYearId, studentId: { in: studentIds }, status: { in: CURRENT_STATUSES } },
      select: { studentId: true },
    });
  }

  institutionTimezone(institutionId: string) {
    return this.prisma.institutionSettings.findUnique({
      where: { institutionId },
      select: { timezone: true },
    });
  }
}

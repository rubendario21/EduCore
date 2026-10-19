import { Injectable } from '@nestjs/common';
import { type DocumentType, type Prisma } from '../../generated/prisma/client';
import { normalizeSearch } from '../../common/search';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

const personSelect = {
  id: true,
  documentType: true,
  documentNumber: true,
  firstNames: true,
  lastNames: true,
  birthDate: true,
  email: true,
  phone: true,
  address: true,
  membership: { select: { id: true, userId: true, status: true } },
} satisfies Prisma.PersonSelect;

export const studentInclude = {
  person: { select: personSelect },
  guardians: {
    include: { guardian: { include: { person: { select: personSelect } } } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.StudentInclude;

export const guardianInclude = {
  person: { select: personSelect },
  students: {
    include: { student: { include: { person: { select: personSelect } } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.GuardianInclude;

export const staffInclude = {
  person: { select: personSelect },
} satisfies Prisma.StaffMemberInclude;

export type StudentRecord = Prisma.StudentGetPayload<{ include: typeof studentInclude }>;
export type GuardianRecord = Prisma.GuardianGetPayload<{ include: typeof guardianInclude }>;
export type StaffRecord = Prisma.StaffMemberGetPayload<{ include: typeof staffInclude }>;
export type PersonRecord = Prisma.PersonGetPayload<{ select: typeof personSelect }>;

const contains = (search: string) => ({ contains: search, mode: 'insensitive' as const });

/** Búsqueda por nombres, apellidos o documento, sin distinguir mayúsculas ni tildes. */
function personSearch(search?: string): Prisma.PersonWhereInput | undefined {
  if (!search) return undefined;
  return { searchText: { contains: normalizeSearch(search) } };
}

/** Consultas de estudiantes, acudientes y personal; siempre por institución. */
@Injectable()
export class PeopleRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  // --- Personas -------------------------------------------------------------

  findPersonByDocument(
    institutionId: string,
    documentType: DocumentType,
    documentNumber: string,
    db: Db = this.prisma,
  ) {
    return db.person.findUnique({
      where: {
        institutionId_documentType_documentNumber: { institutionId, documentType, documentNumber },
      },
      select: {
        ...personSelect,
        student: { select: { id: true } },
        guardian: { select: { id: true } },
        staff: { select: { id: true } },
      },
    });
  }

  createPerson(data: Prisma.PersonUncheckedCreateInput, db: Db) {
    return db.person.create({ data, select: personSelect });
  }

  updatePerson(id: string, data: Prisma.PersonUncheckedUpdateInput, db: Db) {
    return db.person.update({ where: { id }, data, select: personSelect });
  }

  // --- Estudiantes ----------------------------------------------------------

  async listStudents(
    institutionId: string,
    filter: {
      search?: string;
      status?: Prisma.StudentWhereInput['status'];
      skip: number;
      take: number;
    },
  ) {
    const where: Prisma.StudentWhereInput = {
      institutionId,
      ...(filter.status && { status: filter.status }),
      ...(filter.search && {
        OR: [{ person: personSearch(filter.search) }, { code: contains(filter.search) }],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        include: studentInclude,
        orderBy: [{ person: { lastNames: 'asc' } }, { person: { firstNames: 'asc' } }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.student.count({ where }),
    ]);
    return { items, total };
  }

  findStudent(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<StudentRecord | null> {
    return db.student.findFirst({ where: { id, institutionId }, include: studentInclude });
  }

  /** Bloquea el estudiante durante la transacción (cambios en sus vínculos). */
  async lockStudent(institutionId: string, id: string, db: Db): Promise<StudentRecord | null> {
    await db.$executeRaw`SELECT 1 FROM student WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return this.findStudent(institutionId, id, db);
  }

  findStudentByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.student.findUnique({
      where: { institutionId_code: { institutionId, code } },
      select: { id: true },
    });
  }

  createStudent(data: Prisma.StudentUncheckedCreateInput, db: Db) {
    return db.student.create({ data });
  }

  updateStudent(id: string, data: Prisma.StudentUncheckedUpdateInput, db: Db) {
    return db.student.update({ where: { id }, data });
  }

  // --- Vínculos -------------------------------------------------------------

  createLink(data: Prisma.StudentGuardianUncheckedCreateInput, db: Db) {
    return db.studentGuardian.create({ data });
  }

  updateLink(
    studentId: string,
    guardianId: string,
    data: Prisma.StudentGuardianUncheckedUpdateInput,
    db: Db,
  ) {
    return db.studentGuardian.update({
      where: { studentId_guardianId: { studentId, guardianId } },
      data,
    });
  }

  clearPrimary(studentId: string, db: Db) {
    return db.studentGuardian.updateMany({
      where: { studentId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  deleteLink(studentId: string, guardianId: string, db: Db) {
    return db.studentGuardian.delete({
      where: { studentId_guardianId: { studentId, guardianId } },
    });
  }

  // --- Acudientes -----------------------------------------------------------

  async listGuardians(
    institutionId: string,
    filter: { search?: string; skip: number; take: number },
  ) {
    const where: Prisma.GuardianWhereInput = {
      institutionId,
      ...(filter.search && { person: personSearch(filter.search) }),
    };
    const [items, total] = await Promise.all([
      this.prisma.guardian.findMany({
        where,
        include: guardianInclude,
        orderBy: [{ person: { lastNames: 'asc' } }, { person: { firstNames: 'asc' } }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.guardian.count({ where }),
    ]);
    return { items, total };
  }

  findGuardian(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<GuardianRecord | null> {
    return db.guardian.findFirst({ where: { id, institutionId }, include: guardianInclude });
  }

  createGuardian(data: Prisma.GuardianUncheckedCreateInput, db: Db) {
    return db.guardian.create({ data });
  }

  updateGuardian(id: string, data: Prisma.GuardianUncheckedUpdateInput, db: Db) {
    return db.guardian.update({ where: { id }, data });
  }

  // --- Personal -------------------------------------------------------------

  async listStaff(
    institutionId: string,
    filter: {
      search?: string;
      staffType?: Prisma.StaffMemberWhereInput['staffType'];
      status?: Prisma.StaffMemberWhereInput['status'];
      skip: number;
      take: number;
    },
  ) {
    const where: Prisma.StaffMemberWhereInput = {
      institutionId,
      ...(filter.staffType && { staffType: filter.staffType }),
      ...(filter.status && { status: filter.status }),
      ...(filter.search && { person: personSearch(filter.search) }),
    };
    const [items, total] = await Promise.all([
      this.prisma.staffMember.findMany({
        where,
        include: staffInclude,
        orderBy: [{ person: { lastNames: 'asc' } }, { person: { firstNames: 'asc' } }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.staffMember.count({ where }),
    ]);
    return { items, total };
  }

  findStaff(institutionId: string, id: string, db: Db = this.prisma): Promise<StaffRecord | null> {
    return db.staffMember.findFirst({ where: { id, institutionId }, include: staffInclude });
  }

  createStaff(data: Prisma.StaffMemberUncheckedCreateInput, db: Db) {
    return db.staffMember.create({ data });
  }

  updateStaff(id: string, data: Prisma.StaffMemberUncheckedUpdateInput, db: Db) {
    return db.staffMember.update({ where: { id }, data });
  }
}

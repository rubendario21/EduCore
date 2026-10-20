import { Injectable } from '@nestjs/common';
import {
  type AdmissionStatus,
  type DocumentType,
  type Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

/** Estados que ya no bloquean una nueva solicitud del mismo aspirante para el año. */
export const CLOSED_WITHOUT_ADMISSION: AdmissionStatus[] = ['REJECTED', 'WITHDRAWN'];

export const admissionInclude = {
  academicYear: { select: { id: true, year: true, name: true, status: true } },
  grade: { select: { id: true, name: true } },
} satisfies Prisma.AdmissionApplicationInclude;

export const admissionDetailInclude = {
  ...admissionInclude,
  documents: {
    where: { removedAt: null },
    include: {
      storedFile: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  history: { orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.AdmissionApplicationInclude;

export type AdmissionRecord = Prisma.AdmissionApplicationGetPayload<{
  include: typeof admissionInclude;
}>;
export type AdmissionDetailRecord = Prisma.AdmissionApplicationGetPayload<{
  include: typeof admissionDetailInclude;
}>;

/** Consultas de admisiones; siempre por institución. */
@Injectable()
export class AdmissionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30_000 });
  }

  async list(
    institutionId: string,
    filter: {
      academicYearId?: string;
      gradeId?: string;
      status?: AdmissionStatus;
      search?: string;
      skip: number;
      take: number;
    },
  ) {
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const where: Prisma.AdmissionApplicationWhereInput = {
      institutionId,
      ...(filter.academicYearId && { academicYearId: filter.academicYearId }),
      ...(filter.gradeId && { gradeId: filter.gradeId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.search && {
        OR: [
          { applicantFirstNames: contains(filter.search) },
          { applicantLastNames: contains(filter.search) },
          { applicantDocumentNumber: contains(filter.search) },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.admissionApplication.findMany({
        where,
        include: admissionInclude,
        orderBy: [{ academicYear: { year: 'desc' } }, { number: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.admissionApplication.count({ where }),
    ]);
    return { items, total };
  }

  find(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<AdmissionDetailRecord | null> {
    return db.admissionApplication.findFirst({
      where: { id, institutionId },
      include: admissionDetailInclude,
    });
  }

  /** Bloquea la solicitud durante la transacción (transiciones y ediciones). */
  async lock(institutionId: string, id: string, db: Db): Promise<AdmissionDetailRecord | null> {
    await db.$executeRaw`SELECT 1 FROM admission_application WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return this.find(institutionId, id, db);
  }

  /**
   * Bloquea el año lectivo: serializa la numeración de solicitudes y la
   * verificación de solicitudes abiertas duplicadas.
   */
  async lockYear(institutionId: string, id: string, db: Db) {
    await db.$executeRaw`SELECT 1 FROM academic_year WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return db.academicYear.findFirst({ where: { id, institutionId } });
  }

  findGrade(institutionId: string, id: string, db: Db) {
    return db.grade.findFirst({ where: { id, institutionId } });
  }

  async nextNumber(academicYearId: string, db: Db): Promise<number> {
    const { _max } = await db.admissionApplication.aggregate({
      where: { academicYearId },
      _max: { number: true },
    });
    return (_max.number ?? 0) + 1;
  }

  /** Otra solicitud que sigue en curso (o ya admitida) para el mismo aspirante y año. */
  findOpenForApplicant(
    academicYearId: string,
    documentType: DocumentType,
    documentNumber: string,
    excludeId: string | null,
    db: Db,
  ) {
    return db.admissionApplication.findFirst({
      where: {
        academicYearId,
        applicantDocumentType: documentType,
        applicantDocumentNumber: documentNumber,
        status: { notIn: CLOSED_WITHOUT_ADMISSION },
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true, number: true, status: true },
    });
  }

  create(data: Prisma.AdmissionApplicationUncheckedCreateInput, db: Db) {
    return db.admissionApplication.create({ data });
  }

  update(id: string, data: Prisma.AdmissionApplicationUncheckedUpdateInput, db: Db) {
    return db.admissionApplication.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
    });
  }

  recordStatus(data: Prisma.AdmissionStatusChangeUncheckedCreateInput, db: Db) {
    return db.admissionStatusChange.create({ data });
  }

  // --- Documentos ------------------------------------------------------------

  createDocument(data: Prisma.AdmissionDocumentUncheckedCreateInput, db: Db) {
    return db.admissionDocument.create({ data });
  }

  findDocument(
    institutionId: string,
    applicationId: string,
    documentId: string,
    db: Db = this.prisma,
  ) {
    return db.admissionDocument.findFirst({
      where: {
        id: documentId,
        applicationId,
        removedAt: null,
        application: { institutionId },
      },
      include: { storedFile: true },
    });
  }

  removeDocument(id: string, db: Db) {
    return db.admissionDocument.update({ where: { id }, data: { removedAt: new Date() } });
  }

  // --- Matrícula del admitido ------------------------------------------------

  isGuardianLinked(studentId: string, guardianId: string, db: Db) {
    return db.studentGuardian.findFirst({
      where: { studentId, guardianId },
      select: { guardianId: true },
    });
  }
}

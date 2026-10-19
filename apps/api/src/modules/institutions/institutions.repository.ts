import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

/** Consultas de la institución, sus sedes y jornadas (siempre por institución). */
@Injectable()
export class InstitutionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  findInstitution(id: string, db: Db = this.prisma) {
    return db.institution.findUnique({ where: { id }, include: { settings: true } });
  }

  /**
   * La institución que se presenta en la pantalla pública (inicio de sesión).
   * En la v1 hay una sola; en multi-tenant se resolverá por dominio.
   */
  findPublicInstitution() {
    return this.prisma.institution.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      include: { settings: true },
    });
  }

  updateInstitution(id: string, data: Prisma.InstitutionUpdateInput, db: Db) {
    return db.institution.update({ where: { id }, data });
  }

  upsertSettings(
    institutionId: string,
    data: Omit<Prisma.InstitutionSettingsUncheckedCreateInput, 'institutionId'>,
    db: Db,
  ) {
    return db.institutionSettings.upsert({
      where: { institutionId },
      create: { institutionId, ...data },
      update: data,
    });
  }

  setLogo(institutionId: string, logoFileId: string | null, db: Db) {
    return db.institutionSettings.upsert({
      where: { institutionId },
      create: { institutionId, logoFileId },
      update: { logoFileId },
    });
  }

  findStoredFile(institutionId: string, id: string) {
    return this.prisma.storedFile.findFirst({ where: { id, institutionId } });
  }

  // --- Sedes ----------------------------------------------------------------

  listCampuses(institutionId: string) {
    return this.prisma.campus.findMany({
      where: { institutionId },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
    });
  }

  findCampus(institutionId: string, id: string, db: Db = this.prisma) {
    return db.campus.findFirst({ where: { id, institutionId } });
  }

  findCampusByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.campus.findUnique({ where: { institutionId_code: { institutionId, code } } });
  }

  countActiveCampuses(institutionId: string, db: Db) {
    return db.campus.count({ where: { institutionId, status: 'ACTIVE' } });
  }

  clearMainCampus(institutionId: string, db: Db) {
    return db.campus.updateMany({
      where: { institutionId, isMain: true },
      data: { isMain: false },
    });
  }

  createCampus(data: Prisma.CampusUncheckedCreateInput, db: Db) {
    return db.campus.create({ data });
  }

  updateCampus(id: string, data: Prisma.CampusUncheckedUpdateInput, db: Db) {
    return db.campus.update({ where: { id }, data });
  }

  // --- Jornadas -------------------------------------------------------------

  listShifts(institutionId: string) {
    return this.prisma.shift.findMany({ where: { institutionId }, orderBy: { name: 'asc' } });
  }

  findShift(institutionId: string, id: string, db: Db = this.prisma) {
    return db.shift.findFirst({ where: { id, institutionId } });
  }

  findShiftByCode(institutionId: string, code: string, db: Db = this.prisma) {
    return db.shift.findUnique({ where: { institutionId_code: { institutionId, code } } });
  }

  countActiveShifts(institutionId: string, db: Db) {
    return db.shift.count({ where: { institutionId, status: 'ACTIVE' } });
  }

  createShift(data: Prisma.ShiftUncheckedCreateInput, db: Db) {
    return db.shift.create({ data });
  }

  updateShift(id: string, data: Prisma.ShiftUncheckedUpdateInput, db: Db) {
    return db.shift.update({ where: { id }, data });
  }

  /** Grupos activos de años no cerrados que usan la sede o jornada. */
  countOpenGroupsUsing(where: { campusId?: string; shiftId?: string }, db: Db) {
    return db.schoolGroup.count({
      where: { ...where, status: 'ACTIVE', academicYear: { status: { not: 'CLOSED' } } },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient;

export const policyInclude = {
  purposes: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] },
} satisfies Prisma.DataPolicyInclude;

export type PolicyRecord = Prisma.DataPolicyGetPayload<{ include: typeof policyInclude }>;

const personName = {
  select: {
    id: true,
    firstNames: true,
    lastNames: true,
    documentType: true,
    documentNumber: true,
  },
} as const;

export const consentInclude = {
  policy: { select: { id: true, version: true, title: true } },
  student: { select: { id: true, code: true, person: personName } },
  authorizer: personName,
  evidenceFile: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
  decisions: {
    include: { purpose: { select: { id: true, code: true, name: true, required: true } } },
    orderBy: { purpose: { sortOrder: 'asc' } },
  },
} satisfies Prisma.DataConsentInclude;

export type ConsentRecord = Prisma.DataConsentGetPayload<{ include: typeof consentInclude }>;

/** Consultas de políticas y autorizaciones de tratamiento; siempre por institución. */
@Injectable()
export class PrivacyRepository {
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

  // --- Políticas -------------------------------------------------------------

  listPolicies(institutionId: string) {
    return this.prisma.dataPolicy.findMany({
      where: { institutionId },
      include: policyInclude,
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findPolicy(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<PolicyRecord | null> {
    return db.dataPolicy.findFirst({ where: { id, institutionId }, include: policyInclude });
  }

  async lockPolicy(institutionId: string, id: string, db: Db): Promise<PolicyRecord | null> {
    await db.$executeRaw`SELECT 1 FROM data_policy WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return this.findPolicy(institutionId, id, db);
  }

  /** Versión vigente: la publicada más reciente que ya entró en vigor. */
  findCurrentPolicy(institutionId: string, today: Date) {
    return this.prisma.dataPolicy.findFirst({
      where: { institutionId, status: 'PUBLISHED', effectiveFrom: { lte: today } },
      include: policyInclude,
      orderBy: [{ effectiveFrom: 'desc' }, { publishedAt: 'desc' }],
    });
  }

  findPolicyByVersion(institutionId: string, version: string, db: Db) {
    return db.dataPolicy.findUnique({
      where: { institutionId_version: { institutionId, version } },
    });
  }

  createPolicy(data: Prisma.DataPolicyUncheckedCreateInput, db: Db) {
    return db.dataPolicy.create({ data });
  }

  updatePolicy(id: string, data: Prisma.DataPolicyUncheckedUpdateInput, db: Db) {
    return db.dataPolicy.update({ where: { id }, data });
  }

  async replacePurposes(
    policyId: string,
    purposes: Array<{
      code: string;
      name: string;
      description?: string | null;
      required?: boolean;
    }>,
    db: Db,
  ) {
    await db.dataPolicyPurpose.deleteMany({ where: { policyId } });
    await db.dataPolicyPurpose.createMany({
      data: purposes.map((p, index) => ({
        policyId,
        code: p.code,
        name: p.name,
        description: p.description ?? null,
        required: p.required ?? false,
        sortOrder: index,
      })),
    });
  }

  // --- Autorizaciones --------------------------------------------------------

  async listConsents(
    institutionId: string,
    filter: {
      studentId?: string;
      policyId?: string;
      status?: 'ACTIVE' | 'REVOKED';
      skip: number;
      take: number;
    },
  ) {
    const where: Prisma.DataConsentWhereInput = {
      institutionId,
      ...(filter.studentId && { studentId: filter.studentId }),
      ...(filter.policyId && { policyId: filter.policyId }),
      ...(filter.status === 'ACTIVE' && { revokedAt: null }),
      ...(filter.status === 'REVOKED' && { revokedAt: { not: null } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.dataConsent.findMany({
        where,
        include: consentInclude,
        orderBy: [{ consentedOn: 'desc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.dataConsent.count({ where }),
    ]);
    return { items, total };
  }

  findConsent(
    institutionId: string,
    id: string,
    db: Db = this.prisma,
  ): Promise<ConsentRecord | null> {
    return db.dataConsent.findFirst({ where: { id, institutionId }, include: consentInclude });
  }

  async lockConsent(institutionId: string, id: string, db: Db): Promise<ConsentRecord | null> {
    await db.$executeRaw`SELECT 1 FROM data_consent WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return this.findConsent(institutionId, id, db);
  }

  /** Estudiante bloqueado (serializa sus autorizaciones) con sus acudientes. */
  async lockStudent(institutionId: string, id: string, db: Db) {
    await db.$executeRaw`SELECT 1 FROM student WHERE id = ${id}::uuid AND institution_id = ${institutionId}::uuid FOR UPDATE`;
    return db.student.findFirst({
      where: { id, institutionId },
      include: {
        person: { select: { id: true, birthDate: true } },
        guardians: { include: { guardian: { select: { personId: true } } } },
      },
    });
  }

  findActiveConsent(studentId: string, policyId: string, db: Db) {
    return db.dataConsent.findFirst({ where: { studentId, policyId, revokedAt: null } });
  }

  createConsent(data: Prisma.DataConsentUncheckedCreateInput, db: Db) {
    return db.dataConsent.create({ data });
  }

  createDecisions(data: Prisma.DataConsentDecisionCreateManyInput[], db: Db) {
    return db.dataConsentDecision.createMany({ data });
  }

  updateConsent(id: string, data: Prisma.DataConsentUncheckedUpdateInput, db: Db) {
    return db.dataConsent.update({ where: { id }, data });
  }

  // --- Cobertura -------------------------------------------------------------

  /** Estudiantes activos sin autorización vigente para la política. */
  async studentsWithoutConsent(
    institutionId: string,
    policyId: string,
    page: { skip: number; take: number },
  ) {
    const where: Prisma.StudentWhereInput = {
      institutionId,
      status: 'ACTIVE',
      dataConsents: { none: { policyId, revokedAt: null } },
    };
    const [items, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        select: { id: true, code: true, person: personName },
        orderBy: [{ person: { lastNames: 'asc' } }, { person: { firstNames: 'asc' } }],
        ...page,
      }),
      this.prisma.student.count({ where }),
    ]);
    return { items, total };
  }

  async coverageTotals(institutionId: string, policyId: string) {
    const active = { institutionId, status: 'ACTIVE' as const };
    const [activeStudents, withConsent, requiredDenied] = await Promise.all([
      this.prisma.student.count({ where: active }),
      this.prisma.student.count({
        where: { ...active, dataConsents: { some: { policyId, revokedAt: null } } },
      }),
      // Autorizaciones vigentes que niegan alguna finalidad necesaria para el servicio.
      this.prisma.student.count({
        where: {
          ...active,
          dataConsents: {
            some: {
              policyId,
              revokedAt: null,
              decisions: { some: { granted: false, purpose: { required: true } } },
            },
          },
        },
      }),
    ]);
    return {
      activeStudents,
      withConsent,
      withoutConsent: activeStudents - withConsent,
      requiredDenied,
    };
  }
}

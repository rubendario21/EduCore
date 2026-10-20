import {
  DEFAULT_COMPONENTS,
  type EvaluationComponentInput,
  validateComponents,
  validateGradingScheme,
} from '@educore/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { type GradingSchemeInputDto } from './grading.dto';

type Tx = Prisma.TransactionClient;

const schemeInclude = {
  levels: { orderBy: [{ minScore: 'asc' }] },
  components: { orderBy: [{ sortOrder: 'asc' }] },
  academicYear: { select: { id: true, year: true, name: true, status: true } },
} satisfies Prisma.GradingSchemeInclude;

type SchemeRecord = Prisma.GradingSchemeGetPayload<{ include: typeof schemeInclude }>;

export const GradingErrors = {
  yearNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'El año lectivo no existe.'),
  notDefined: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'GRADING_SCHEME_NOT_DEFINED',
      'El año lectivo aún no tiene SIEE configurado.',
    ),
  alreadyDefined: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'GRADING_SCHEME_ALREADY_DEFINED',
      'El año lectivo ya tiene SIEE. Edítalo en lugar de copiarlo.',
    ),
  yearClosed: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_CLOSED',
      'El año lectivo está cerrado: su SIEE ya no se modifica.',
    ),
  locked: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'GRADING_SCHEME_LOCKED',
      'El año ya tiene notas registradas: su escala, niveles de desempeño y componentes ya no cambian. Solo se pueden editar los nombres, las reglas de promoción y los criterios.',
    ),
  componentInUse: (name: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'COMPONENT_IN_USE',
      `El componente "${name}" tiene actividades evaluativas y no se puede quitar.`,
    ),
  invalid: (problems: string[]) =>
    new ValidationException(problems.map((message) => ({ field: 'levels', messages: [message] }))),
};

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value.toString());

export function schemeView(s: SchemeRecord) {
  return {
    id: s.id,
    academicYear: s.academicYear,
    minScore: num(s.minScore)!,
    maxScore: num(s.maxScore)!,
    decimals: s.decimals,
    passingScore: num(s.passingScore)!,
    rounding: s.rounding,
    promotionUnit: s.promotionUnit,
    maxFailedForPromotion: s.maxFailedForPromotion,
    minAttendancePercent: num(s.minAttendancePercent),
    notes: s.notes,
    levels: s.levels.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      minScore: num(l.minScore)!,
      maxScore: num(l.maxScore)!,
    })),
    components: s.components.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      weightPercent: num(c.weightPercent)!,
    })),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type SchemeView = ReturnType<typeof schemeView>;

/**
 * SIEE por año lectivo (Decreto 1290 de 2009): escala, niveles de desempeño,
 * aprobación y reglas de promoción. Ningún valor está fijo en el código; la
 * validación de los rangos es la misma que usa la web (`@educore/shared`).
 */
@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private find(institutionId: string, academicYearId: string, db: Tx = this.prisma) {
    return db.gradingScheme.findFirst({
      where: { institutionId, academicYearId },
      include: schemeInclude,
    });
  }

  /** Año de la institución bloqueado (serializa los cambios de su SIEE). */
  private async lockYear(auth: AuthContext, academicYearId: string, tx: Tx) {
    await tx.$executeRaw`SELECT 1 FROM academic_year WHERE id = ${academicYearId}::uuid AND institution_id = ${auth.institutionId}::uuid FOR UPDATE`;
    const year = await tx.academicYear.findFirst({
      where: { id: academicYearId, institutionId: auth.institutionId },
    });
    if (!year) throw GradingErrors.yearNotFound();
    return year;
  }

  async get(auth: AuthContext, academicYearId: string): Promise<SchemeView> {
    const year = await this.prisma.academicYear.findFirst({
      where: { id: academicYearId, institutionId: auth.institutionId },
    });
    if (!year) throw GradingErrors.yearNotFound();
    const scheme = await this.find(auth.institutionId, academicYearId);
    if (!scheme) throw GradingErrors.notDefined();
    return schemeView(scheme);
  }

  /** ¿El año ya tiene notas? Entonces su escala, niveles y componentes quedan fijos. */
  private async hasGrades(academicYearId: string, tx: Tx): Promise<boolean> {
    const count = await tx.gradeRecord.count({
      where: { assessment: { period: { academicYearId } } },
    });
    return count > 0;
  }

  /** Crea o reemplaza el SIEE del año (con sus niveles y componentes). */
  async save(
    auth: AuthContext,
    academicYearId: string,
    dto: GradingSchemeInputDto,
    client: ClientInfo,
  ): Promise<SchemeView> {
    const components = dto.components ?? null;
    const problems = [
      ...validateGradingScheme(dto, dto.levels),
      ...(components ? validateComponents(components) : []),
    ];
    if (problems.length > 0) throw GradingErrors.invalid(problems);

    await this.prisma.$transaction(async (tx) => {
      const year = await this.lockYear(auth, academicYearId, tx);
      if (year.status === 'CLOSED') throw GradingErrors.yearClosed();
      const existing = await this.find(auth.institutionId, academicYearId, tx);
      const finalComponents =
        components ?? (existing ? schemeView(existing).components : DEFAULT_COMPONENTS);
      if (existing && (await this.hasGrades(academicYearId, tx))) {
        const before = schemeView(existing);
        if (scaleSignature(before, before.components) !== scaleSignature(dto, finalComponents)) {
          throw GradingErrors.locked();
        }
      }
      await this.write(
        auth,
        academicYearId,
        existing?.id ?? null,
        { ...dto, components: finalComponents },
        tx,
      );
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: existing
            ? 'academics.grading_scheme.updated'
            : 'academics.grading_scheme.created',
          entityType: 'grading_scheme',
          entityId: academicYearId,
          metadata: {
            academicYearId,
            scale: {
              min: dto.minScore,
              max: dto.maxScore,
              decimals: dto.decimals,
              passing: dto.passingScore,
            },
            levels: dto.levels.map((l) => `${l.code}:${l.minScore}-${l.maxScore}`),
            components: finalComponents.map((c) => `${c.code}:${c.weightPercent}%`),
            ...(existing && {
              previous: {
                min: num(existing.minScore),
                max: num(existing.maxScore),
                passing: num(existing.passingScore),
                levels: existing.levels.map(
                  (l) => `${l.code}:${num(l.minScore)}-${num(l.maxScore)}`,
                ),
                components: existing.components.map((c) => `${c.code}:${num(c.weightPercent)}%`),
              },
            }),
          },
          context: client,
        },
        tx,
      );
    });
    return this.get(auth, academicYearId);
  }

  /** Copia el SIEE de otro año a un año que aún no lo tiene. */
  async copy(
    auth: AuthContext,
    academicYearId: string,
    fromAcademicYearId: string,
    client: ClientInfo,
  ): Promise<SchemeView> {
    await this.prisma.$transaction(async (tx) => {
      const year = await this.lockYear(auth, academicYearId, tx);
      if (year.status === 'CLOSED') throw GradingErrors.yearClosed();
      if (await this.find(auth.institutionId, academicYearId, tx))
        throw GradingErrors.alreadyDefined();
      const source = await this.find(auth.institutionId, fromAcademicYearId, tx);
      if (!source) throw GradingErrors.notDefined();
      await this.write(auth, academicYearId, null, schemeView(source), tx);
      await this.audit.record(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          action: 'academics.grading_scheme.copied',
          entityType: 'grading_scheme',
          entityId: academicYearId,
          metadata: { fromAcademicYearId, fromYear: source.academicYear.year },
          context: client,
        },
        tx,
      );
    });
    return this.get(auth, academicYearId);
  }

  private async write(
    auth: AuthContext,
    academicYearId: string,
    existingId: string | null,
    input: SchemeWrite,
    tx: Tx,
  ) {
    const data = {
      minScore: input.minScore,
      maxScore: input.maxScore,
      decimals: input.decimals,
      passingScore: input.passingScore,
      rounding: input.rounding,
      promotionUnit: input.promotionUnit,
      maxFailedForPromotion: input.maxFailedForPromotion ?? null,
      minAttendancePercent: input.minAttendancePercent ?? null,
      notes: input.notes ?? null,
    };
    const levels = [...input.levels]
      .sort((a, b) => a.minScore - b.minScore)
      .map((l, index) => ({
        code: l.code.toUpperCase(),
        name: l.name,
        minScore: l.minScore,
        maxScore: l.maxScore,
        sortOrder: index,
      }));
    const components = input.components.map((c, index) => ({
      code: c.code.toUpperCase(),
      name: c.name,
      weightPercent: c.weightPercent,
      sortOrder: index,
    }));

    if (!existingId) {
      await tx.gradingScheme.create({
        data: {
          ...data,
          institutionId: auth.institutionId,
          academicYearId,
          levels: { create: levels },
          components: { create: components },
        },
      });
      return;
    }

    await tx.performanceLevel.deleteMany({ where: { schemeId: existingId } });
    await tx.gradingScheme.update({
      where: { id: existingId },
      data: { ...data, version: { increment: 1 }, levels: { create: levels } },
    });
    // Los componentes se actualizan por código: las actividades ya creadas
    // conservan su componente. Uno con actividades no se puede quitar.
    const current = await tx.evaluationComponent.findMany({
      where: { schemeId: existingId },
      include: { _count: { select: { assessments: true } } },
    });
    const wanted = new Set(components.map((c) => c.code));
    for (const old of current.filter((c) => !wanted.has(c.code))) {
      if (old._count.assessments > 0) throw GradingErrors.componentInUse(old.name);
      await tx.evaluationComponent.delete({ where: { id: old.id } });
    }
    for (const component of components) {
      await tx.evaluationComponent.upsert({
        where: { schemeId_code: { schemeId: existingId, code: component.code } },
        create: { ...component, schemeId: existingId },
        update: {
          name: component.name,
          weightPercent: component.weightPercent,
          sortOrder: component.sortOrder,
        },
      });
    }
  }
}

type SchemeWrite = Omit<GradingSchemeInputDto, 'levels' | 'components'> & {
  levels: Array<{ code: string; name: string; minScore: number; maxScore: number }>;
  components: EvaluationComponentInput[];
};

/** Lo que no puede cambiar con notas registradas: escala, rangos y pesos. */
function scaleSignature(
  s: Pick<
    SchemeWrite,
    'minScore' | 'maxScore' | 'decimals' | 'passingScore' | 'rounding' | 'levels'
  >,
  components: readonly EvaluationComponentInput[],
): string {
  return JSON.stringify([
    s.minScore,
    s.maxScore,
    s.decimals,
    s.passingScore,
    s.rounding,
    [...s.levels].map((l) => [l.code.toUpperCase(), l.minScore, l.maxScore]).sort(),
    [...components].map((c) => [c.code.toUpperCase(), c.weightPercent]).sort(),
  ]);
}

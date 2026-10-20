import { Injectable } from '@nestjs/common';
import { type FieldError, ValidationException } from '../../common/errors/app.exception';
import { fromDateOnly, toDateOnly } from '../../common/validation/colombia';
import { type AcademicPeriod, type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { AcademicErrors } from './academics.errors';
import { type AcademicYearRecord, AcademicsRepository } from './academics.repository';
import {
  type AcademicPeriodViewDto,
  type AcademicYearViewDto,
  type CreateAcademicPeriodDto,
  type CreateAcademicYearDto,
  type UpdateAcademicPeriodDto,
  type UpdateAcademicYearDto,
} from './dto/academics.dto';

type Tx = Prisma.TransactionClient;

/** Duración máxima de un año lectivo (calendarios A y B caben holgadamente). */
const MAX_YEAR_DAYS = 548;

/** Los pesos se comparan en centésimas para evitar errores de coma flotante. */
const toCents = (value: Prisma.Decimal | number) => Math.round(Number(value) * 100);

function periodView(p: AcademicPeriod): AcademicPeriodViewDto {
  return {
    id: p.id,
    academicYearId: p.academicYearId,
    number: p.number,
    name: p.name,
    startsOn: fromDateOnly(p.startsOn),
    endsOn: fromDateOnly(p.endsOn),
    weightPercent: Number(p.weightPercent),
    status: p.status,
  };
}

function yearView(y: AcademicYearRecord): AcademicYearViewDto {
  return {
    id: y.id,
    year: y.year,
    name: y.name,
    startsOn: fromDateOnly(y.startsOn),
    endsOn: fromDateOnly(y.endsOn),
    status: y.status,
    totalWeightPercent: y.periods.reduce((sum, p) => sum + toCents(p.weightPercent), 0) / 100,
    periods: y.periods.map(periodView),
  };
}

const daysBetween = (a: string, b: string) =>
  (toDateOnly(b).getTime() - toDateOnly(a).getTime()) / 86_400_000;

@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly repository: AcademicsRepository,
    private readonly audit: AuditService,
  ) {}

  private record(
    auth: AuthContext,
    client: ClientInfo,
    action: string,
    entityType: string,
    entityId: string,
    tx: Tx,
    extra: {
      changes?: Record<string, { from: unknown; to: unknown }>;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    return this.audit.record(
      {
        institutionId: auth.institutionId,
        actorUserId: auth.userId,
        action,
        entityType,
        entityId,
        ...extra,
        context: client,
      },
      tx,
    );
  }

  private validateYearDates(startsOn: string, endsOn: string): void {
    const days = daysBetween(startsOn, endsOn);
    if (days <= 0)
      throw new ValidationException([
        { field: 'endsOn', messages: ['La fecha de fin debe ser posterior a la de inicio.'] },
      ]);
    if (days > MAX_YEAR_DAYS) {
      throw new ValidationException([
        { field: 'endsOn', messages: ['Un año lectivo no puede durar más de 18 meses.'] },
      ]);
    }
  }

  private async requireYear(auth: AuthContext, id: string, tx: Tx): Promise<AcademicYearRecord> {
    const year = await this.repository.lockYear(auth.institutionId, id, tx);
    if (!year) throw AcademicErrors.notFound('El año lectivo');
    return year;
  }

  // --- Años -----------------------------------------------------------------

  async list(auth: AuthContext): Promise<AcademicYearViewDto[]> {
    return (await this.repository.listYears(auth.institutionId)).map(yearView);
  }

  async get(auth: AuthContext, id: string): Promise<AcademicYearViewDto> {
    const year = await this.repository.findYear(auth.institutionId, id);
    if (!year) throw AcademicErrors.notFound('El año lectivo');
    return yearView(year);
  }

  async create(
    auth: AuthContext,
    dto: CreateAcademicYearDto,
    client: ClientInfo,
  ): Promise<AcademicYearViewDto> {
    this.validateYearDates(dto.startsOn, dto.endsOn);
    const id = await this.repository.transaction(async (tx) => {
      if (await this.repository.findYearByNumber(auth.institutionId, dto.year, tx))
        throw AcademicErrors.yearTaken();
      const year = await this.repository.createYear(
        {
          institutionId: auth.institutionId,
          year: dto.year,
          name: dto.name,
          startsOn: toDateOnly(dto.startsOn),
          endsOn: toDateOnly(dto.endsOn),
        },
        tx,
      );
      await this.record(auth, client, 'academics.year.created', 'academic_year', year.id, tx, {
        metadata: { year: dto.year, startsOn: dto.startsOn, endsOn: dto.endsOn },
      });
      return year.id;
    });
    return this.get(auth, id);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateAcademicYearDto,
    client: ClientInfo,
  ): Promise<AcademicYearViewDto> {
    await this.repository.transaction(async (tx) => {
      const year = await this.requireYear(auth, id, tx);
      if (year.status === 'CLOSED') throw AcademicErrors.yearClosed();

      const startsOn = dto.startsOn ?? fromDateOnly(year.startsOn);
      const endsOn = dto.endsOn ?? fromDateOnly(year.endsOn);
      const datesChanged =
        startsOn !== fromDateOnly(year.startsOn) || endsOn !== fromDateOnly(year.endsOn);
      if (datesChanged) {
        if (year.status === 'ACTIVE') throw AcademicErrors.yearActiveLocked();
        this.validateYearDates(startsOn, endsOn);
        const outside = year.periods.filter(
          (p) => fromDateOnly(p.startsOn) < startsOn || fromDateOnly(p.endsOn) > endsOn,
        );
        if (outside.length > 0) {
          throw new ValidationException([
            {
              field: 'startsOn',
              messages: [
                `Las nuevas fechas dejan fuera los períodos ${outside.map((p) => p.number).join(', ')}.`,
              ],
            },
          ]);
        }
      }

      await this.repository.updateYear(
        id,
        { name: dto.name, startsOn: toDateOnly(startsOn), endsOn: toDateOnly(endsOn) },
        tx,
      );
      const changes = {
        ...(dto.name && dto.name !== year.name && { name: { from: year.name, to: dto.name } }),
        ...(startsOn !== fromDateOnly(year.startsOn) && {
          startsOn: { from: fromDateOnly(year.startsOn), to: startsOn },
        }),
        ...(endsOn !== fromDateOnly(year.endsOn) && {
          endsOn: { from: fromDateOnly(year.endsOn), to: endsOn },
        }),
      };
      if (Object.keys(changes).length > 0) {
        await this.record(auth, client, 'academics.year.updated', 'academic_year', id, tx, {
          changes,
        });
      }
    });
    return this.get(auth, id);
  }

  /**
   * Activa el año: debe estar en planeación, no puede haber otro activo y sus
   * períodos deben existir y sumar exactamente 100 %.
   */
  async activate(auth: AuthContext, id: string, client: ClientInfo): Promise<AcademicYearViewDto> {
    await this.repository.transaction(async (tx) => {
      const year = await this.requireYear(auth, id, tx);
      if (year.status !== 'PLANNING') throw AcademicErrors.invalidTransition(year.status, 'ACTIVE');

      const active = await this.repository.findActiveYear(auth.institutionId, tx);
      if (active) throw AcademicErrors.anotherYearActive(active.year);

      const problems: string[] = [];
      if (year.periods.length === 0) problems.push('Debe tener al menos un período.');
      const total = year.periods.reduce((sum, p) => sum + toCents(p.weightPercent), 0);
      if (year.periods.length > 0 && total !== 10_000) {
        problems.push(`Los pesos de los períodos suman ${total / 100} % y deben sumar 100 %.`);
      }
      const numbers = year.periods.map((p) => p.number);
      const expected = numbers.map((_, i) => i + 1);
      if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
        problems.push('Los períodos deben estar numerados consecutivamente desde 1.');
      }
      if (problems.length > 0) throw AcademicErrors.notReadyToActivate(problems);

      if (!(await this.repository.transitionYear(id, 'PLANNING', 'ACTIVE', tx)))
        throw AcademicErrors.concurrentChange();
      await this.record(auth, client, 'academics.year.activated', 'academic_year', id, tx, {
        changes: { status: { from: 'PLANNING', to: 'ACTIVE' } },
      });
    });
    return this.get(auth, id);
  }

  /**
   * Cierra el año (queda de solo lectura). En la Fase 3 exigirá además que sus
   * períodos estén cerrados y las notas publicadas.
   */
  async close(auth: AuthContext, id: string, client: ClientInfo): Promise<AcademicYearViewDto> {
    await this.repository.transaction(async (tx) => {
      const year = await this.requireYear(auth, id, tx);
      if (year.status !== 'ACTIVE') throw AcademicErrors.invalidTransition(year.status, 'CLOSED');
      if (!(await this.repository.transitionYear(id, 'ACTIVE', 'CLOSED', tx)))
        throw AcademicErrors.concurrentChange();
      await this.record(auth, client, 'academics.year.closed', 'academic_year', id, tx, {
        changes: { status: { from: 'ACTIVE', to: 'CLOSED' } },
      });
    });
    return this.get(auth, id);
  }

  // --- Períodos -------------------------------------------------------------

  /** Valida fechas, número, solapamiento y suma de pesos de un período dentro de su año. */
  private validatePeriod(
    year: AcademicYearRecord,
    candidate: { number: number; startsOn: string; endsOn: string; weightPercent: number },
    excludeId?: string,
  ): void {
    const problems: FieldError[] = [];
    const yearStart = fromDateOnly(year.startsOn);
    const yearEnd = fromDateOnly(year.endsOn);
    const others = year.periods.filter((p) => p.id !== excludeId);

    if (candidate.endsOn < candidate.startsOn) {
      problems.push({
        field: 'endsOn',
        messages: ['La fecha de fin no puede ser anterior a la de inicio.'],
      });
    }
    if (candidate.startsOn < yearStart || candidate.endsOn > yearEnd) {
      problems.push({
        field: 'startsOn',
        messages: [`El período debe estar dentro del año lectivo (${yearStart} a ${yearEnd}).`],
      });
    }
    if (others.some((p) => p.number === candidate.number)) {
      problems.push({
        field: 'number',
        messages: [`Ya existe el período ${candidate.number} en este año.`],
      });
    }
    const overlapping = others.find(
      (p) =>
        candidate.startsOn <= fromDateOnly(p.endsOn) &&
        candidate.endsOn >= fromDateOnly(p.startsOn),
    );
    if (overlapping) {
      problems.push({
        field: 'startsOn',
        messages: [
          `Las fechas se cruzan con el período ${overlapping.number} (${fromDateOnly(overlapping.startsOn)} a ${fromDateOnly(overlapping.endsOn)}).`,
        ],
      });
    }
    const total =
      others.reduce((sum, p) => sum + toCents(p.weightPercent), 0) +
      toCents(candidate.weightPercent);
    if (total > 10_000) {
      problems.push({
        field: 'weightPercent',
        messages: [`Con este peso los períodos sumarían ${total / 100} %; el máximo es 100 %.`],
      });
    }
    if (problems.length > 0) throw new ValidationException(problems);
  }

  async createPeriod(
    auth: AuthContext,
    yearId: string,
    dto: CreateAcademicPeriodDto,
    client: ClientInfo,
  ): Promise<AcademicYearViewDto> {
    await this.repository.transaction(async (tx) => {
      const year = await this.requireYear(auth, yearId, tx);
      if (year.status === 'CLOSED') throw AcademicErrors.yearClosed();
      if (year.status === 'ACTIVE') throw AcademicErrors.yearActiveLocked();
      this.validatePeriod(year, dto);

      const period = await this.repository.createPeriod(
        {
          academicYearId: yearId,
          number: dto.number,
          name: dto.name,
          startsOn: toDateOnly(dto.startsOn),
          endsOn: toDateOnly(dto.endsOn),
          weightPercent: dto.weightPercent,
        },
        tx,
      );
      await this.record(
        auth,
        client,
        'academics.period.created',
        'academic_period',
        period.id,
        tx,
        {
          metadata: { academicYearId: yearId, ...dto },
        },
      );
    });
    return this.get(auth, yearId);
  }

  async updatePeriod(
    auth: AuthContext,
    periodId: string,
    dto: UpdateAcademicPeriodDto,
    client: ClientInfo,
  ): Promise<AcademicYearViewDto> {
    const period = await this.repository.findPeriod(auth.institutionId, periodId);
    if (!period) throw AcademicErrors.notFound('El período');

    await this.repository.transaction(async (tx) => {
      const year = await this.requireYear(auth, period.academicYearId, tx);
      const current = year.periods.find((p) => p.id === periodId);
      if (!current) throw AcademicErrors.notFound('El período');
      if (year.status === 'CLOSED') throw AcademicErrors.yearClosed();

      const next = {
        number: dto.number ?? current.number,
        name: dto.name ?? current.name,
        startsOn: dto.startsOn ?? fromDateOnly(current.startsOn),
        endsOn: dto.endsOn ?? fromDateOnly(current.endsOn),
        weightPercent: dto.weightPercent ?? Number(current.weightPercent),
      };
      const before = periodView(current);
      const structural =
        next.number !== before.number ||
        next.startsOn !== before.startsOn ||
        next.endsOn !== before.endsOn ||
        toCents(next.weightPercent) !== toCents(before.weightPercent);
      if (year.status === 'ACTIVE' && structural) throw AcademicErrors.yearActiveLocked();
      this.validatePeriod(year, next, periodId);

      await this.repository.updatePeriod(
        periodId,
        {
          number: next.number,
          name: next.name,
          startsOn: toDateOnly(next.startsOn),
          endsOn: toDateOnly(next.endsOn),
          weightPercent: next.weightPercent,
        },
        tx,
      );
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['number', 'name', 'startsOn', 'endsOn', 'weightPercent'] as const) {
        if (before[key] !== next[key]) changes[key] = { from: before[key], to: next[key] };
      }
      if (Object.keys(changes).length > 0) {
        await this.record(
          auth,
          client,
          'academics.period.updated',
          'academic_period',
          periodId,
          tx,
          { changes },
        );
      }
    });
    return this.get(auth, period.academicYearId);
  }

  /**
   * Abre un período para registrar actividades y notas. El año debe estar
   * activo y tener SIEE (sin escala no hay cómo validar una nota). El cierre y
   * la publicación se hacen en el módulo de evaluación (Fase 3C).
   */
  async openPeriod(
    auth: AuthContext,
    periodId: string,
    client: ClientInfo,
  ): Promise<AcademicYearViewDto> {
    const period = await this.repository.findPeriod(auth.institutionId, periodId);
    if (!period) throw AcademicErrors.notFound('El período');

    await this.repository.transaction(async (tx) => {
      const year = await this.requireYear(auth, period.academicYearId, tx);
      if (year.status !== 'ACTIVE') throw AcademicErrors.yearNotActive();
      const current = year.periods.find((p) => p.id === periodId)!;
      if (current.status !== 'PLANNED')
        throw AcademicErrors.invalidTransition(current.status, 'OPEN');
      if (!(await tx.gradingScheme.findFirst({ where: { academicYearId: year.id } }))) {
        throw AcademicErrors.gradingSchemeRequired();
      }
      await this.repository.updatePeriod(periodId, { status: 'OPEN' }, tx);
      await this.record(auth, client, 'academics.period.opened', 'academic_period', periodId, tx, {
        metadata: { academicYearId: year.id, number: current.number },
      });
    });
    return this.get(auth, period.academicYearId);
  }

  async deletePeriod(
    auth: AuthContext,
    periodId: string,
    client: ClientInfo,
  ): Promise<AcademicYearViewDto> {
    const period = await this.repository.findPeriod(auth.institutionId, periodId);
    if (!period) throw AcademicErrors.notFound('El período');

    await this.repository.transaction(async (tx) => {
      const year = await this.requireYear(auth, period.academicYearId, tx);
      if (year.status === 'CLOSED') throw AcademicErrors.yearClosed();
      if (year.status === 'ACTIVE') throw AcademicErrors.yearActiveLocked();
      await this.repository.deletePeriod(periodId, tx);
      await this.record(auth, client, 'academics.period.deleted', 'academic_period', periodId, tx, {
        metadata: { ...periodView(period) },
      });
    });
    return this.get(auth, period.academicYearId);
  }
}

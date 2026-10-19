import { Injectable } from '@nestjs/common';
import { fromDateOnly } from '../../common/validation/colombia';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { type AuthContext } from '../auth/auth.types';

export interface DashboardSummary {
  generatedAt: string;
  /** Fecha de hoy en la zona horaria de la institución (AAAA-MM-DD). */
  today: string;
  users: {
    active: number;
    invited: number;
    suspended: number;
    byRole: Array<{ code: string; name: string; count: number }>;
  };
  institution: { activeCampuses: number; activeShifts: number };
  academics: {
    activeGrades: number;
    activeSubjects: number;
    /** null = no hay año lectivo activo (dato ausente, no cero). */
    activeYear: {
      id: string;
      year: number;
      name: string;
      startsOn: string;
      endsOn: string;
      periodCount: number;
      /** null = hoy no cae dentro de ningún período (p. ej. vacaciones). */
      currentPeriod: { number: number; name: string; startsOn: string; endsOn: string } | null;
      /** Grupos activos del año activo. */
      activeGroups: number;
    } | null;
  };
}

/** Fecha actual en una zona horaria IANA, como AAAA-MM-DD. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

/**
 * Indicadores del tablero principal. Las fórmulas están documentadas en
 * docs/indicadores.md. Todas las cifras son de la institución del usuario.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(auth: AuthContext): Promise<DashboardSummary> {
    const institutionId = auth.institutionId;
    const settings = await this.prisma.institutionSettings.findUnique({ where: { institutionId } });
    const today = todayIn(settings?.timezone ?? 'America/Bogota');

    const [
      byStatus,
      roles,
      activeCampuses,
      activeShifts,
      activeGrades,
      activeSubjects,
      activeYear,
    ] = await Promise.all([
      this.prisma.userInstitution.groupBy({
        by: ['status'],
        where: { institutionId },
        _count: { _all: true },
      }),
      this.prisma.role.findMany({
        where: { institutionId },
        select: {
          code: true,
          name: true,
          _count: { select: { memberships: { where: { membership: { status: 'ACTIVE' } } } } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.campus.count({ where: { institutionId, status: 'ACTIVE' } }),
      this.prisma.shift.count({ where: { institutionId, status: 'ACTIVE' } }),
      this.prisma.grade.count({ where: { institutionId, status: 'ACTIVE' } }),
      this.prisma.subject.count({ where: { institutionId, status: 'ACTIVE' } }),
      this.prisma.academicYear.findFirst({
        where: { institutionId, status: 'ACTIVE' },
        include: {
          periods: { orderBy: { number: 'asc' } },
          _count: { select: { schoolGroups: { where: { status: 'ACTIVE' } } } },
        },
      }),
    ]);

    const countOf = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;
    const current = activeYear?.periods.find(
      (p) => fromDateOnly(p.startsOn) <= today && today <= fromDateOnly(p.endsOn),
    );

    return {
      generatedAt: new Date().toISOString(),
      today,
      users: {
        active: countOf('ACTIVE'),
        invited: countOf('INVITED'),
        suspended: countOf('SUSPENDED'),
        byRole: roles
          .map((r) => ({ code: r.code, name: r.name, count: r._count.memberships }))
          .filter((r) => r.count > 0)
          .sort((a, b) => b.count - a.count),
      },
      institution: { activeCampuses, activeShifts },
      academics: {
        activeGrades,
        activeSubjects,
        activeYear: activeYear
          ? {
              id: activeYear.id,
              year: activeYear.year,
              name: activeYear.name,
              startsOn: fromDateOnly(activeYear.startsOn),
              endsOn: fromDateOnly(activeYear.endsOn),
              periodCount: activeYear.periods.length,
              currentPeriod: current
                ? {
                    number: current.number,
                    name: current.name,
                    startsOn: fromDateOnly(current.startsOn),
                    endsOn: fromDateOnly(current.endsOn),
                  }
                : null,
              activeGroups: activeYear._count.schoolGroups,
            }
          : null,
      },
    };
  }
}

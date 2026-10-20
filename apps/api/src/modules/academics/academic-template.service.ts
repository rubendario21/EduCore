import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { AcademicsRepository } from './academics.repository';
import { COLOMBIAN_AREAS, COLOMBIAN_GRADES, COLOMBIAN_LEVELS } from './colombian-template';

type Tx = Prisma.TransactionClient;

type Section = 'levels' | 'grades' | 'areas' | 'subjects';
type Items = Record<Section, Array<{ code: string; name: string }>>;

export interface TemplateReport {
  dryRun: boolean;
  /** Lo que se creó (o se crearía, en simulación). */
  created: Items;
  /** Lo que se omitió porque ya existe un registro con ese código. */
  skipped: Items;
}

const emptyItems = (): Items => ({ levels: [], grades: [], areas: [], subjects: [] });
const item = ({ code, name }: { code: string; name: string }) => ({ code, name });

/**
 * Aplica la plantilla académica colombiana. Es idempotente: solo crea los
 * niveles, grados, áreas y asignaturas cuyo código aún no existe en la
 * institución, y nunca modifica lo que ya está.
 */
@Injectable()
export class AcademicTemplateService {
  constructor(
    private readonly repository: AcademicsRepository,
    private readonly audit: AuditService,
  ) {}

  async applyColombian(
    auth: AuthContext,
    dryRun: boolean,
    client: ClientInfo,
  ): Promise<TemplateReport> {
    return this.repository.transaction(async (tx) => {
      // Dos aplicaciones simultáneas se ejecutan una tras otra.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academic-template:${auth.institutionId}`}))`;
      const report: TemplateReport = { dryRun, created: emptyItems(), skipped: emptyItems() };
      const id = auth.institutionId;

      const levelIds = new Map<string, string | null>();
      for (const level of COLOMBIAN_LEVELS) {
        const existing = await this.repository.findLevelByCode(id, level.code, tx);
        if (existing) {
          levelIds.set(level.code, existing.id);
          report.skipped.levels.push(item(level));
          continue;
        }
        report.created.levels.push(item(level));
        levelIds.set(
          level.code,
          dryRun
            ? null
            : (await this.repository.createLevel({ ...level, institutionId: id }, tx)).id,
        );
      }

      for (const grade of COLOMBIAN_GRADES) {
        if (await this.repository.findGradeByCode(id, grade.code, tx)) {
          report.skipped.grades.push(item(grade));
          continue;
        }
        report.created.grades.push(item(grade));
        if (dryRun) continue;
        await this.repository.createGrade(
          {
            institutionId: id,
            code: grade.code,
            name: grade.name,
            sortOrder: grade.sortOrder,
            educationLevelId: levelIds.get(grade.levelCode)!,
          },
          tx,
        );
      }

      for (const area of COLOMBIAN_AREAS) {
        const existing = await this.repository.findAreaByCode(id, area.code, tx);
        let areaId = existing?.id ?? null;
        if (existing) {
          report.skipped.areas.push(item(area));
        } else {
          report.created.areas.push(item(area));
          if (!dryRun) {
            areaId = (
              await this.repository.createArea(
                { institutionId: id, code: area.code, name: area.name },
                tx,
              )
            ).id;
          }
        }
        for (const subject of area.subjects) {
          if (await this.repository.findSubjectByCode(id, subject.code, tx)) {
            report.skipped.subjects.push(item(subject));
            continue;
          }
          report.created.subjects.push(item(subject));
          if (dryRun) continue;
          await this.repository.createSubject(
            { institutionId: id, subjectAreaId: areaId!, ...subject },
            tx,
          );
        }
      }

      if (!dryRun) await this.recordApplied(auth, client, report, tx);
      return report;
    });
  }

  private recordApplied(auth: AuthContext, client: ClientInfo, report: TemplateReport, tx: Tx) {
    const count = (items: Items) =>
      Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.length]));
    return this.audit.record(
      {
        institutionId: auth.institutionId,
        actorUserId: auth.userId,
        action: 'academics.template.applied',
        entityType: 'institution',
        entityId: auth.institutionId,
        metadata: {
          template: 'CO',
          created: count(report.created),
          skipped: count(report.skipped),
        },
        context: client,
      },
      tx,
    );
  }
}

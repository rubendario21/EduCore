import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';
import { paginated, type Paginated, toPrismaPage } from '../../common/pagination/pagination';
import { fromDateOnly, toDateOnly } from '../../common/validation/colombia';
import { type Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { todayIn } from '../dashboard/dashboard.service';
import { FilesService, type IncomingFile, UPLOAD_RULES } from '../files/files.service';
import {
  type CoverageQueryDto,
  type CreateConsentDto,
  type CreatePolicyDto,
  type ListConsentsQueryDto,
  type PurposeInputDto,
  type RevokeConsentDto,
  type UpdatePolicyDto,
} from './privacy.dto';
import { type ConsentRecord, type PolicyRecord, PrivacyRepository } from './privacy.repository';

type Tx = Prisma.TransactionClient;

/** Mayoría de edad en Colombia (Ley 27 de 1977). */
export const AGE_OF_MAJORITY = 18;

export const PrivacyErrors = {
  policyNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'POLICY_NOT_FOUND', 'La política no existe.'),
  noCurrentPolicy: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'NO_CURRENT_POLICY',
      'No hay una política de tratamiento de datos publicada y vigente.',
    ),
  versionTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'POLICY_VERSION_TAKEN',
      'Ya existe una política con esa versión.',
    ),
  policyPublished: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'POLICY_PUBLISHED',
      'La política ya está publicada y no se puede modificar. Crea una nueva versión.',
    ),
  policyNotPublished: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'POLICY_NOT_PUBLISHED',
      'Solo se registran autorizaciones sobre una política publicada.',
    ),
  consentNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'CONSENT_NOT_FOUND', 'La autorización no existe.'),
  studentNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'STUDENT_NOT_FOUND', 'El estudiante no existe.'),
  authorizerNotAllowed: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'AUTHORIZER_NOT_ALLOWED',
      'Solo puede autorizar un acudiente marcado como representante legal del estudiante, o el propio estudiante si es mayor de edad.',
    ),
  alreadyActive: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'CONSENT_ALREADY_ACTIVE',
      'El estudiante ya tiene una autorización vigente para esta versión de la política. Revócala para registrar otra.',
    ),
  revoked: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'CONSENT_REVOKED',
      'La autorización fue revocada y no admite cambios.',
    ),
  evidenceExists: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'EVIDENCE_ALREADY_ATTACHED',
      'La autorización ya tiene su soporte y no se reemplaza.',
    ),
  evidenceNotFound: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'EVIDENCE_NOT_FOUND',
      'La autorización no tiene soporte.',
    ),
  invalid: (field: string, message: string) =>
    new ValidationException([{ field, messages: [message] }]),
};

/** Edad cumplida en una fecha (ambas `AAAA-MM-DD`). */
export function ageOn(birthDate: string, date: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function policyView(p: PolicyRecord) {
  return {
    id: p.id,
    version: p.version,
    title: p.title,
    content: p.content,
    effectiveFrom: fromDateOnly(p.effectiveFrom),
    status: p.status,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    purposes: p.purposes.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      description: x.description,
      required: x.required,
    })),
  };
}

export function consentView(c: ConsentRecord) {
  const { person: studentPerson, ...student } = c.student;
  return {
    id: c.id,
    status: c.revokedAt ? ('REVOKED' as const) : ('ACTIVE' as const),
    policy: c.policy,
    student: { ...student, ...studentPerson, id: student.id },
    authorizer: c.authorizer,
    authorizerRole: c.authorizerRole,
    method: c.method,
    consentedOn: fromDateOnly(c.consentedOn),
    notes: c.notes,
    decisions: c.decisions.map((d) => ({
      purposeId: d.purpose.id,
      code: d.purpose.code,
      name: d.purpose.name,
      required: d.purpose.required,
      granted: d.granted,
    })),
    evidence: c.evidenceFile
      ? {
          fileName: c.evidenceFile.originalName,
          mimeType: c.evidenceFile.mimeType,
          sizeBytes: c.evidenceFile.sizeBytes,
        }
      : null,
    recordedByUserId: c.recordedByUserId,
    createdAt: c.createdAt.toISOString(),
    revocation: c.revokedAt
      ? {
          date: fromDateOnly(c.revokedOn!),
          reason: c.revocationReason,
          revokedByUserId: c.revokedByUserId,
          recordedAt: c.revokedAt.toISOString(),
        }
      : null,
  };
}

export type PolicyView = ReturnType<typeof policyView>;
export type ConsentView = ReturnType<typeof consentView>;

/**
 * Protección de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013):
 * versiones de la política de tratamiento y autorizaciones de los titulares.
 *
 * - Una política publicada no cambia: los cambios se hacen en una versión nueva.
 * - La autorización de un menor la otorga su representante legal (art. 7); un
 *   estudiante mayor de edad se autoriza a sí mismo.
 * - Las autorizaciones no se editan ni se borran: se revocan, y queda el registro.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly repository: PrivacyRepository,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  private record(
    auth: AuthContext,
    client: ClientInfo,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
    tx: Tx,
  ) {
    return this.audit.record(
      {
        institutionId: auth.institutionId,
        actorUserId: auth.userId,
        action,
        entityType,
        entityId,
        metadata,
        context: client,
      },
      tx,
    );
  }

  private async today(auth: AuthContext): Promise<string> {
    const settings = await this.repository.institutionTimezone(auth.institutionId);
    return todayIn(settings?.timezone ?? 'America/Bogota');
  }

  // --- Políticas -------------------------------------------------------------

  async listPolicies(auth: AuthContext): Promise<PolicyView[]> {
    return (await this.repository.listPolicies(auth.institutionId)).map(policyView);
  }

  async getPolicy(auth: AuthContext, id: string): Promise<PolicyView> {
    const policy = await this.repository.findPolicy(auth.institutionId, id);
    if (!policy) throw PrivacyErrors.policyNotFound();
    return policyView(policy);
  }

  async currentPolicy(auth: AuthContext): Promise<PolicyView> {
    const today = await this.today(auth);
    const policy = await this.repository.findCurrentPolicy(auth.institutionId, toDateOnly(today));
    if (!policy) throw PrivacyErrors.noCurrentPolicy();
    return policyView(policy);
  }

  private checkPurposeCodes(purposes: PurposeInputDto[]) {
    const codes = purposes.map((p) => p.code);
    if (new Set(codes).size !== codes.length) {
      throw PrivacyErrors.invalid('purposes', 'Cada finalidad debe tener un código distinto.');
    }
  }

  async createPolicy(
    auth: AuthContext,
    dto: CreatePolicyDto,
    client: ClientInfo,
  ): Promise<PolicyView> {
    this.checkPurposeCodes(dto.purposes);
    const id = await this.repository.transaction(async (tx) => {
      if (await this.repository.findPolicyByVersion(auth.institutionId, dto.version, tx))
        throw PrivacyErrors.versionTaken();
      const policy = await this.repository.createPolicy(
        {
          institutionId: auth.institutionId,
          version: dto.version,
          title: dto.title,
          content: dto.content,
          effectiveFrom: toDateOnly(dto.effectiveFrom),
        },
        tx,
      );
      await this.repository.replacePurposes(policy.id, dto.purposes, tx);
      await this.record(
        auth,
        client,
        'privacy.policy.created',
        'data_policy',
        policy.id,
        { version: dto.version, purposes: dto.purposes.map((p) => p.code) },
        tx,
      );
      return policy.id;
    });
    return this.getPolicy(auth, id);
  }

  async updatePolicy(
    auth: AuthContext,
    id: string,
    dto: UpdatePolicyDto,
    client: ClientInfo,
  ): Promise<PolicyView> {
    if (dto.purposes) this.checkPurposeCodes(dto.purposes);
    await this.repository.transaction(async (tx) => {
      const policy = await this.repository.lockPolicy(auth.institutionId, id, tx);
      if (!policy) throw PrivacyErrors.policyNotFound();
      if (policy.status === 'PUBLISHED') throw PrivacyErrors.policyPublished();
      if (dto.version && dto.version !== policy.version) {
        if (await this.repository.findPolicyByVersion(auth.institutionId, dto.version, tx))
          throw PrivacyErrors.versionTaken();
      }
      await this.repository.updatePolicy(
        id,
        {
          version: dto.version,
          title: dto.title,
          content: dto.content,
          effectiveFrom: dto.effectiveFrom ? toDateOnly(dto.effectiveFrom) : undefined,
        },
        tx,
      );
      if (dto.purposes) await this.repository.replacePurposes(id, dto.purposes, tx);
      await this.record(
        auth,
        client,
        'privacy.policy.updated',
        'data_policy',
        id,
        { fields: Object.keys(dto) },
        tx,
      );
    });
    return this.getPolicy(auth, id);
  }

  /** Publica la versión: desde ese momento queda fija y admite autorizaciones. */
  async publishPolicy(auth: AuthContext, id: string, client: ClientInfo): Promise<PolicyView> {
    await this.repository.transaction(async (tx) => {
      const policy = await this.repository.lockPolicy(auth.institutionId, id, tx);
      if (!policy) throw PrivacyErrors.policyNotFound();
      if (policy.status === 'PUBLISHED') throw PrivacyErrors.policyPublished();
      await this.repository.updatePolicy(id, { status: 'PUBLISHED', publishedAt: new Date() }, tx);
      await this.record(
        auth,
        client,
        'privacy.policy.published',
        'data_policy',
        id,
        { version: policy.version, effectiveFrom: fromDateOnly(policy.effectiveFrom) },
        tx,
      );
    });
    return this.getPolicy(auth, id);
  }

  // --- Autorizaciones --------------------------------------------------------

  async listConsents(
    auth: AuthContext,
    query: ListConsentsQueryDto,
  ): Promise<Paginated<ConsentView>> {
    const { items, total } = await this.repository.listConsents(auth.institutionId, {
      studentId: query.studentId,
      policyId: query.policyId,
      status: query.status,
      ...toPrismaPage(query),
    });
    return paginated(items.map(consentView), total, query);
  }

  async getConsent(auth: AuthContext, id: string): Promise<ConsentView> {
    const consent = await this.repository.findConsent(auth.institutionId, id);
    if (!consent) throw PrivacyErrors.consentNotFound();
    return consentView(consent);
  }

  async createConsent(
    auth: AuthContext,
    dto: CreateConsentDto,
    client: ClientInfo,
  ): Promise<ConsentView> {
    const today = await this.today(auth);
    if (dto.consentedOn > today) {
      throw PrivacyErrors.invalid(
        'consentedOn',
        'La fecha de la autorización no puede ser futura.',
      );
    }
    const id = await this.repository.transaction(async (tx) => {
      const student = await this.repository.lockStudent(auth.institutionId, dto.studentId, tx);
      if (!student) throw PrivacyErrors.studentNotFound();
      const policy = await this.repository.findPolicy(auth.institutionId, dto.policyId, tx);
      if (!policy) throw PrivacyErrors.policyNotFound();
      if (policy.status !== 'PUBLISHED') throw PrivacyErrors.policyNotPublished();

      // Una decisión, y solo una, por cada finalidad de la política.
      const purposeIds = new Set(policy.purposes.map((p) => p.id));
      const decided = dto.decisions.map((d) => d.purposeId);
      if (
        new Set(decided).size !== decided.length ||
        decided.length !== purposeIds.size ||
        decided.some((p) => !purposeIds.has(p))
      ) {
        throw PrivacyErrors.invalid(
          'decisions',
          'Registra una decisión (autoriza o no) para cada finalidad de la política.',
        );
      }

      const authorizerRole = this.authorizerRole(student, dto.authorizerPersonId, dto.consentedOn);
      if (await this.repository.findActiveConsent(student.id, policy.id, tx))
        throw PrivacyErrors.alreadyActive();

      const consent = await this.repository.createConsent(
        {
          institutionId: auth.institutionId,
          studentId: student.id,
          policyId: policy.id,
          authorizerPersonId: dto.authorizerPersonId,
          authorizerRole,
          method: dto.method,
          consentedOn: toDateOnly(dto.consentedOn),
          notes: dto.notes ?? null,
          recordedByUserId: auth.userId,
        },
        tx,
      );
      await this.repository.createDecisions(
        dto.decisions.map((d) => ({
          consentId: consent.id,
          purposeId: d.purposeId,
          granted: d.granted,
        })),
        tx,
      );
      const codeOf = new Map(policy.purposes.map((p) => [p.id, p.code]));
      await this.record(
        auth,
        client,
        'privacy.consent.recorded',
        'data_consent',
        consent.id,
        {
          studentId: student.id,
          policyVersion: policy.version,
          authorizerPersonId: dto.authorizerPersonId,
          authorizerRole,
          method: dto.method,
          consentedOn: dto.consentedOn,
          decisions: Object.fromEntries(
            dto.decisions.map((d) => [codeOf.get(d.purposeId)!, d.granted]),
          ),
        },
        tx,
      );
      return consent.id;
    });
    return this.getConsent(auth, id);
  }

  /**
   * Quién puede autorizar: un acudiente vinculado y marcado como representante
   * legal, o el propio estudiante si ya era mayor de edad en la fecha.
   */
  private authorizerRole(
    student: NonNullable<Awaited<ReturnType<PrivacyRepository['lockStudent']>>>,
    personId: string,
    consentedOn: string,
  ): 'LEGAL_REPRESENTATIVE' | 'TITULAR' {
    if (personId === student.person.id) {
      const birthDate = student.person.birthDate;
      if (birthDate && ageOn(fromDateOnly(birthDate), consentedOn) >= AGE_OF_MAJORITY) {
        return 'TITULAR';
      }
      throw PrivacyErrors.authorizerNotAllowed();
    }
    const representative = student.guardians.some(
      (link) => link.guardian.personId === personId && link.isLegalRepresentative,
    );
    if (!representative) throw PrivacyErrors.authorizerNotAllowed();
    return 'LEGAL_REPRESENTATIVE';
  }

  async revokeConsent(
    auth: AuthContext,
    id: string,
    dto: RevokeConsentDto,
    client: ClientInfo,
  ): Promise<ConsentView> {
    const today = await this.today(auth);
    const date = dto.date ?? today;
    if (date > today) throw PrivacyErrors.invalid('date', 'La fecha no puede ser futura.');
    await this.repository.transaction(async (tx) => {
      const consent = await this.repository.lockConsent(auth.institutionId, id, tx);
      if (!consent) throw PrivacyErrors.consentNotFound();
      if (consent.revokedAt) throw PrivacyErrors.revoked();
      const consentedOn = fromDateOnly(consent.consentedOn);
      if (date < consentedOn) {
        throw PrivacyErrors.invalid(
          'date',
          `La revocación no puede ser anterior a la autorización (${consentedOn}).`,
        );
      }
      await this.repository.updateConsent(
        id,
        {
          revokedOn: toDateOnly(date),
          revocationReason: dto.reason,
          revokedByUserId: auth.userId,
          revokedAt: new Date(),
        },
        tx,
      );
      await this.record(
        auth,
        client,
        'privacy.consent.revoked',
        'data_consent',
        id,
        { studentId: consent.student.id, date, reason: dto.reason },
        tx,
      );
    });
    return this.getConsent(auth, id);
  }

  /** Adjunta el soporte (documento firmado, correo, etc.). Una sola vez. */
  async attachEvidence(
    auth: AuthContext,
    id: string,
    file: IncomingFile | undefined,
    client: ClientInfo,
  ): Promise<ConsentView> {
    await this.repository.transaction(async (tx) => {
      const consent = await this.repository.lockConsent(auth.institutionId, id, tx);
      if (!consent) throw PrivacyErrors.consentNotFound();
      if (consent.revokedAt) throw PrivacyErrors.revoked();
      if (consent.evidenceFile) throw PrivacyErrors.evidenceExists();
      const stored = await this.files.store(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          file,
          rule: UPLOAD_RULES.consentEvidence,
        },
        tx,
      );
      await this.repository.updateConsent(id, { evidenceFileId: stored.id }, tx);
      await this.record(
        auth,
        client,
        'privacy.consent.evidence_attached',
        'data_consent',
        id,
        { fileId: stored.id },
        tx,
      );
    });
    return this.getConsent(auth, id);
  }

  async evidenceFile(auth: AuthContext, id: string) {
    const consent = await this.repository.findConsent(auth.institutionId, id);
    if (!consent) throw PrivacyErrors.consentNotFound();
    if (!consent.evidenceFileId) throw PrivacyErrors.evidenceNotFound();
    const file = await this.files.findOwned(auth.institutionId, consent.evidenceFileId);
    return { file, stream: await this.files.open(file) };
  }

  // --- Cobertura -------------------------------------------------------------

  /**
   * Estudiantes activos con y sin autorización vigente para una versión (por
   * defecto, la vigente), con la lista paginada de los que faltan.
   */
  async coverage(auth: AuthContext, query: CoverageQueryDto) {
    const policy = query.policyId
      ? await this.repository.findPolicy(auth.institutionId, query.policyId)
      : await this.repository.findCurrentPolicy(
          auth.institutionId,
          toDateOnly(await this.today(auth)),
        );
    if (!policy)
      throw query.policyId ? PrivacyErrors.policyNotFound() : PrivacyErrors.noCurrentPolicy();

    const [totals, pending] = await Promise.all([
      this.repository.coverageTotals(auth.institutionId, policy.id),
      this.repository.studentsWithoutConsent(auth.institutionId, policy.id, toPrismaPage(query)),
    ]);
    const page = paginated(
      pending.items.map(({ person, ...student }) => ({ ...person, ...student })),
      pending.total,
      query,
    );
    return {
      policy: { id: policy.id, version: policy.version, title: policy.title },
      totals,
      pending: page.data,
      meta: page.meta,
    };
  }
}

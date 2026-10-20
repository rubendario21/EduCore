import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { paginated, type Paginated, toPrismaPage } from '../../common/pagination/pagination';
import { fromDateOnly, toDateOnly } from '../../common/validation/colombia';
import {
  type AdmissionApplication,
  type DocumentType,
  type Prisma,
} from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { FilesService, type IncomingFile, UPLOAD_RULES } from '../files/files.service';
import { PersonResolver } from '../people/person-resolver';
import { StudentsService } from '../people/students.service';
import {
  type AdmissionDocumentType,
  type AdmissionStatus,
  type CreateAdmissionDto,
  type EnrollAdmittedDto,
  type ListAdmissionsQueryDto,
  type UpdateAdmissionDto,
} from './admissions.dto';
import {
  type AdmissionDetailRecord,
  type AdmissionRecord,
  AdmissionsRepository,
} from './admissions.repository';

type Tx = Prisma.TransactionClient;

/**
 * Flujo de la solicitud:
 *
 *   DRAFT → SUBMITTED → IN_REVIEW → APPROVED → ENROLLED
 *                                 ↘ WAITLISTED → APPROVED / REJECTED
 *                                 ↘ REJECTED
 *   Cualquier estado abierto → WITHDRAWN (la familia desiste).
 *
 * REJECTED, ENROLLED y WITHDRAWN son finales.
 */
export const ADMISSION_TRANSITIONS = {
  submit: { from: ['DRAFT'], to: 'SUBMITTED' },
  review: { from: ['SUBMITTED'], to: 'IN_REVIEW' },
  waitlist: { from: ['IN_REVIEW'], to: 'WAITLISTED' },
  approve: { from: ['IN_REVIEW', 'WAITLISTED'], to: 'APPROVED' },
  reject: { from: ['IN_REVIEW', 'WAITLISTED'], to: 'REJECTED' },
  withdraw: {
    from: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'WAITLISTED', 'APPROVED'],
    to: 'WITHDRAWN',
  },
  enroll: { from: ['APPROVED'], to: 'ENROLLED' },
} as const satisfies Record<string, { from: readonly AdmissionStatus[]; to: AdmissionStatus }>;

export type AdmissionTransition = Exclude<keyof typeof ADMISSION_TRANSITIONS, 'enroll'>;

/** Estados en los que la solicitud se puede editar y recibir documentos. */
const OPEN_STATUSES: readonly AdmissionStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'WAITLISTED',
  'APPROVED',
];

const DECISIONS: readonly AdmissionTransition[] = ['waitlist', 'approve', 'reject'];

export const AdmissionErrors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'ADMISSION_NOT_FOUND', 'La solicitud no existe.'),
  documentNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'DOCUMENT_NOT_FOUND', 'El documento no existe.'),
  yearNotFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'El año lectivo no existe.'),
  gradeNotFound: () => new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'El grado no existe.'),
  yearClosed: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_CLOSED',
      'El año lectivo está cerrado y no admite cambios.',
    ),
  gradeInactive: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'INACTIVE_REFERENCE',
      'El grado está inactivo y no puede usarse.',
    ),
  alreadyOpen: (code: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'ADMISSION_ALREADY_OPEN',
      `El aspirante ya tiene la solicitud ${code} en curso para ese año.`,
      { code },
    ),
  invalidTransition: (from: AdmissionStatus, to: AdmissionStatus) =>
    new AppException(
      HttpStatus.CONFLICT,
      'INVALID_STATUS_TRANSITION',
      `No se puede pasar una solicitud de ${from} a ${to}.`,
      { from, to },
    ),
  notEditable: (status: AdmissionStatus) =>
    new AppException(
      HttpStatus.CONFLICT,
      'ADMISSION_NOT_EDITABLE',
      'La solicitud ya finalizó y no admite cambios.',
      { status },
    ),
};

export function admissionCode(year: number, number: number): string {
  return `ADM-${year}-${String(number).padStart(4, '0')}`;
}

export function admissionView(a: AdmissionRecord) {
  return {
    id: a.id,
    code: admissionCode(a.academicYear.year, a.number),
    status: a.status,
    academicYear: a.academicYear,
    grade: a.grade,
    applicant: {
      documentType: a.applicantDocumentType,
      documentNumber: a.applicantDocumentNumber,
      firstNames: a.applicantFirstNames,
      lastNames: a.applicantLastNames,
      birthDate: a.applicantBirthDate ? fromDateOnly(a.applicantBirthDate) : null,
    },
    guardian: a.guardianDocumentType
      ? {
          documentType: a.guardianDocumentType,
          documentNumber: a.guardianDocumentNumber,
          firstNames: a.guardianFirstNames,
          lastNames: a.guardianLastNames,
          relationship: a.guardianRelationship,
          email: a.guardianEmail,
          phone: a.guardianPhone,
        }
      : null,
    previousSchool: a.previousSchool,
    notes: a.notes,
    decisionNote: a.decisionNote,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    studentId: a.studentId,
    enrollmentId: a.enrollmentId,
    createdAt: a.createdAt.toISOString(),
  };
}

export function admissionDetailView(a: AdmissionDetailRecord) {
  return {
    ...admissionView(a),
    documents: a.documents.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      fileName: d.storedFile.originalName,
      mimeType: d.storedFile.mimeType,
      sizeBytes: d.storedFile.sizeBytes,
      uploadedAt: d.createdAt.toISOString(),
    })),
    history: a.history.map((h) => ({
      from: h.fromStatus,
      to: h.toStatus,
      note: h.note,
      changedByUserId: h.changedByUserId,
      changedAt: h.changedAt.toISOString(),
    })),
  };
}

export type AdmissionView = ReturnType<typeof admissionView>;
export type AdmissionDetailView = ReturnType<typeof admissionDetailView>;

/** Campos de la solicitud a partir de los datos del aspirante y del acudiente. */
function personFields(dto: Pick<UpdateAdmissionDto, 'applicant' | 'guardian'>) {
  const data: Partial<AdmissionApplication> = {};
  if (dto.applicant) {
    data.applicantDocumentType = dto.applicant.documentType;
    data.applicantDocumentNumber = dto.applicant.documentNumber;
    data.applicantFirstNames = dto.applicant.firstNames;
    data.applicantLastNames = dto.applicant.lastNames;
    data.applicantBirthDate = dto.applicant.birthDate ? toDateOnly(dto.applicant.birthDate) : null;
  }
  if (dto.guardian !== undefined) {
    const g = dto.guardian;
    data.guardianDocumentType = g?.documentType ?? null;
    data.guardianDocumentNumber = g?.documentNumber ?? null;
    data.guardianFirstNames = g?.firstNames ?? null;
    data.guardianLastNames = g?.lastNames ?? null;
    data.guardianRelationship = g?.relationship ?? null;
    data.guardianEmail = g?.email ?? null;
    data.guardianPhone = g?.phone ?? null;
  }
  return data;
}

/**
 * Admisiones: solicitudes, documentos, revisión, decisión y paso a matrícula.
 * Cada cambio de estado queda en el historial de la solicitud y en la auditoría.
 */
@Injectable()
export class AdmissionsService {
  constructor(
    private readonly repository: AdmissionsRepository,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly persons: PersonResolver,
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  private record(
    auth: AuthContext,
    client: ClientInfo,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    tx: Tx,
  ) {
    return this.audit.record(
      {
        institutionId: auth.institutionId,
        actorUserId: auth.userId,
        action,
        entityType: 'admission_application',
        entityId,
        metadata,
        context: client,
      },
      tx,
    );
  }

  // --- Consultas -------------------------------------------------------------

  async list(auth: AuthContext, query: ListAdmissionsQueryDto): Promise<Paginated<AdmissionView>> {
    const { items, total } = await this.repository.list(auth.institutionId, {
      ...query,
      ...toPrismaPage(query),
    });
    return paginated(items.map(admissionView), total, query);
  }

  async get(auth: AuthContext, id: string): Promise<AdmissionDetailView> {
    const admission = await this.repository.find(auth.institutionId, id);
    if (!admission) throw AdmissionErrors.notFound();
    return admissionDetailView(admission);
  }

  // --- Validaciones ----------------------------------------------------------

  private async requireGrade(auth: AuthContext, gradeId: string, tx: Tx) {
    const grade = await this.repository.findGrade(auth.institutionId, gradeId, tx);
    if (!grade) throw AdmissionErrors.gradeNotFound();
    if (grade.status !== 'ACTIVE') throw AdmissionErrors.gradeInactive();
  }

  /** Bloquea el año (numeración y duplicados) y exige que no esté cerrado. */
  private async lockOpenYear(auth: AuthContext, academicYearId: string, tx: Tx) {
    const year = await this.repository.lockYear(auth.institutionId, academicYearId, tx);
    if (!year) throw AdmissionErrors.yearNotFound();
    if (year.status === 'CLOSED') throw AdmissionErrors.yearClosed();
    return year;
  }

  private async checkNotDuplicated(
    year: { id: string; year: number },
    documentType: DocumentType,
    documentNumber: string,
    excludeId: string | null,
    tx: Tx,
  ) {
    const other = await this.repository.findOpenForApplicant(
      year.id,
      documentType,
      documentNumber,
      excludeId,
      tx,
    );
    if (other) throw AdmissionErrors.alreadyOpen(admissionCode(year.year, other.number));
  }

  /** Solicitud bloqueada que todavía admite cambios, con su año abierto. */
  private async lockOpen(auth: AuthContext, id: string, tx: Tx) {
    const found = await this.repository.find(auth.institutionId, id, tx);
    if (!found) throw AdmissionErrors.notFound();
    // Mismo orden de bloqueo que al crear (año → solicitud): evita interbloqueos.
    const year = await this.lockOpenYear(auth, found.academicYearId, tx);
    const admission = (await this.repository.lock(auth.institutionId, id, tx))!;
    return { admission, year };
  }

  // --- Registro y edición ----------------------------------------------------

  async create(
    auth: AuthContext,
    dto: CreateAdmissionDto,
    client: ClientInfo,
  ): Promise<AdmissionDetailView> {
    const id = await this.repository.transaction(async (tx) => {
      const year = await this.lockOpenYear(auth, dto.academicYearId, tx);
      await this.requireGrade(auth, dto.gradeId, tx);
      await this.checkNotDuplicated(
        year,
        dto.applicant.documentType,
        dto.applicant.documentNumber,
        null,
        tx,
      );

      const created = await this.repository.create(
        {
          institutionId: auth.institutionId,
          academicYearId: dto.academicYearId,
          number: await this.repository.nextNumber(dto.academicYearId, tx),
          gradeId: dto.gradeId,
          previousSchool: dto.previousSchool ?? null,
          notes: dto.notes ?? null,
          applicantDocumentType: dto.applicant.documentType,
          applicantDocumentNumber: dto.applicant.documentNumber,
          applicantFirstNames: dto.applicant.firstNames,
          applicantLastNames: dto.applicant.lastNames,
          ...personFields({ guardian: dto.guardian ?? null }),
          applicantBirthDate: dto.applicant.birthDate ? toDateOnly(dto.applicant.birthDate) : null,
        },
        tx,
      );
      await this.repository.recordStatus(
        {
          applicationId: created.id,
          fromStatus: null,
          toStatus: 'DRAFT',
          changedByUserId: auth.userId,
        },
        tx,
      );
      await this.record(
        auth,
        client,
        'admissions.application.created',
        created.id,
        { code: admissionCode(year.year, created.number), gradeId: dto.gradeId },
        tx,
      );
      return created.id;
    });
    return this.get(auth, id);
  }

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateAdmissionDto,
    client: ClientInfo,
  ): Promise<AdmissionDetailView> {
    await this.repository.transaction(async (tx) => {
      const { admission, year } = await this.lockOpen(auth, id, tx);
      if (!OPEN_STATUSES.includes(admission.status))
        throw AdmissionErrors.notEditable(admission.status);
      if (dto.gradeId && dto.gradeId !== admission.gradeId)
        await this.requireGrade(auth, dto.gradeId, tx);
      if (
        dto.applicant &&
        (dto.applicant.documentType !== admission.applicantDocumentType ||
          dto.applicant.documentNumber !== admission.applicantDocumentNumber)
      ) {
        await this.checkNotDuplicated(
          year,
          dto.applicant.documentType,
          dto.applicant.documentNumber,
          id,
          tx,
        );
      }
      await this.repository.update(
        id,
        {
          gradeId: dto.gradeId,
          previousSchool: dto.previousSchool,
          notes: dto.notes,
          ...personFields(dto),
        },
        tx,
      );
      await this.record(
        auth,
        client,
        'admissions.application.updated',
        id,
        { fields: Object.keys(dto) },
        tx,
      );
    });
    return this.get(auth, id);
  }

  // --- Transiciones ----------------------------------------------------------

  async transition(
    auth: AuthContext,
    id: string,
    action: AdmissionTransition,
    note: string | null | undefined,
    client: ClientInfo,
  ): Promise<AdmissionDetailView> {
    const { from, to } = ADMISSION_TRANSITIONS[action];
    await this.repository.transaction(async (tx) => {
      const { admission } = await this.lockOpen(auth, id, tx);
      if (!(from as readonly AdmissionStatus[]).includes(admission.status)) {
        throw AdmissionErrors.invalidTransition(admission.status, to);
      }
      const now = new Date();
      const isDecision = DECISIONS.includes(action);
      await this.repository.update(
        id,
        {
          status: to,
          ...(action === 'submit' && { submittedAt: now }),
          ...(isDecision && { decidedAt: now, decisionNote: note ?? null }),
        },
        tx,
      );
      await this.changeStatus(auth, client, admission.status, to, id, note, tx);
    });
    return this.get(auth, id);
  }

  private async changeStatus(
    auth: AuthContext,
    client: ClientInfo,
    from: AdmissionStatus,
    to: AdmissionStatus,
    id: string,
    note: string | null | undefined,
    tx: Tx,
    metadata: Record<string, unknown> = {},
  ) {
    await this.repository.recordStatus(
      {
        applicationId: id,
        fromStatus: from,
        toStatus: to,
        note: note ?? null,
        changedByUserId: auth.userId,
      },
      tx,
    );
    await this.record(
      auth,
      client,
      'admissions.application.status_changed',
      id,
      { from, to, ...(note && { note }), ...metadata },
      tx,
    );
  }

  /**
   * Matricula al admitido en una sola transacción (todo o nada):
   * 1. Registra al aspirante como estudiante, o reutiliza su perfil si ya lo
   *    era (reingreso). Una persona existente con otro nombre se rechaza.
   * 2. Vincula al acudiente de la solicitud (si no estaba vinculado).
   * 3. Crea la matrícula activa en el año y grado de la solicitud, con las
   *    reglas de la matrícula (cupo, grupo del mismo grado, una vigente…).
   */
  async enroll(
    auth: AuthContext,
    id: string,
    dto: EnrollAdmittedDto,
    client: ClientInfo,
  ): Promise<AdmissionDetailView> {
    await this.repository.transaction(async (tx) => {
      const { admission } = await this.lockOpen(auth, id, tx);
      if (admission.status !== 'APPROVED') {
        throw AdmissionErrors.invalidTransition(admission.status, 'ENROLLED');
      }

      const { person } = await this.persons.findOrCreate(
        auth.institutionId,
        {
          documentType: admission.applicantDocumentType,
          documentNumber: admission.applicantDocumentNumber,
          firstNames: admission.applicantFirstNames,
          lastNames: admission.applicantLastNames,
          birthDate: admission.applicantBirthDate
            ? fromDateOnly(admission.applicantBirthDate)
            : null,
        },
        tx,
      );
      const studentId =
        person.student?.id ??
        (await this.students.createWithin(
          auth,
          {
            person: {
              documentType: person.documentType,
              documentNumber: person.documentNumber,
              firstNames: person.firstNames,
              lastNames: person.lastNames,
            },
          },
          client,
          tx,
        ));

      if (admission.guardianDocumentType && admission.guardianDocumentNumber) {
        const { person: guardianPerson } = await this.persons.findOrCreate(
          auth.institutionId,
          {
            documentType: admission.guardianDocumentType,
            documentNumber: admission.guardianDocumentNumber,
            firstNames: admission.guardianFirstNames!,
            lastNames: admission.guardianLastNames!,
            email: admission.guardianEmail,
            phone: admission.guardianPhone,
          },
          tx,
        );
        const linked =
          guardianPerson.guardian &&
          (await this.repository.isGuardianLinked(studentId, guardianPerson.guardian.id, tx));
        if (!linked) {
          await this.students.linkGuardianWithin(
            auth,
            studentId,
            {
              ...(guardianPerson.guardian
                ? { guardianId: guardianPerson.guardian.id }
                : {
                    person: {
                      documentType: guardianPerson.documentType,
                      documentNumber: guardianPerson.documentNumber,
                      firstNames: guardianPerson.firstNames,
                      lastNames: guardianPerson.lastNames,
                    },
                  }),
              relationship: admission.guardianRelationship ?? 'OTHER',
            },
            client,
            tx,
          );
        }
      }

      const enrollmentId = await this.enrollments.createWithin(
        auth,
        {
          studentId,
          academicYearId: admission.academicYearId,
          gradeId: admission.gradeId,
          schoolGroupId: dto.schoolGroupId,
          enrolledOn: dto.enrolledOn,
          status: 'ACTIVE',
        },
        client,
        tx,
      );
      await this.repository.update(id, { status: 'ENROLLED', studentId, enrollmentId }, tx);
      await this.changeStatus(auth, client, 'APPROVED', 'ENROLLED', id, null, tx, {
        studentId,
        enrollmentId,
      });
    });
    return this.get(auth, id);
  }

  // --- Documentos ------------------------------------------------------------

  async addDocument(
    auth: AuthContext,
    id: string,
    documentType: AdmissionDocumentType,
    file: IncomingFile | undefined,
    client: ClientInfo,
  ): Promise<AdmissionDetailView> {
    await this.repository.transaction(async (tx) => {
      const { admission } = await this.lockOpen(auth, id, tx);
      if (!OPEN_STATUSES.includes(admission.status))
        throw AdmissionErrors.notEditable(admission.status);
      const stored = await this.files.store(
        {
          institutionId: auth.institutionId,
          actorUserId: auth.userId,
          file,
          rule: UPLOAD_RULES.admissionDocument,
        },
        tx,
      );
      const document = await this.repository.createDocument(
        { applicationId: id, documentType, storedFileId: stored.id },
        tx,
      );
      await this.record(
        auth,
        client,
        'admissions.document.added',
        id,
        { documentId: document.id, documentType, fileId: stored.id },
        tx,
      );
    });
    return this.get(auth, id);
  }

  /** Retira un documento de la solicitud; el archivo se conserva por trazabilidad. */
  async removeDocument(
    auth: AuthContext,
    id: string,
    documentId: string,
    client: ClientInfo,
  ): Promise<AdmissionDetailView> {
    await this.repository.transaction(async (tx) => {
      const { admission } = await this.lockOpen(auth, id, tx);
      if (!OPEN_STATUSES.includes(admission.status))
        throw AdmissionErrors.notEditable(admission.status);
      const document = await this.repository.findDocument(auth.institutionId, id, documentId, tx);
      if (!document) throw AdmissionErrors.documentNotFound();
      await this.repository.removeDocument(documentId, tx);
      await this.record(
        auth,
        client,
        'admissions.document.removed',
        id,
        { documentId, documentType: document.documentType },
        tx,
      );
    });
    return this.get(auth, id);
  }

  /** Documento descargable por quien puede consultar admisiones. */
  async documentFile(auth: AuthContext, id: string, documentId: string) {
    const document = await this.repository.findDocument(auth.institutionId, id, documentId);
    if (!document) throw AdmissionErrors.documentNotFound();
    return { file: document.storedFile, stream: await this.files.open(document.storedFile) };
  }
}

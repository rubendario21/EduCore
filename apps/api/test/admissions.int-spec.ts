import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

describe('Admisiones (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let institutionId: string;
  let tokens: Record<'admin' | 'secretary' | 'coordinator' | 'teacher', string>;
  let s: { year: string; g6: string; group601: string };
  let docCounter = 1;

  const api = (token = tokens.admin) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
      delete: (url: string) => auth(agent.delete(`/api/v1${url}`)),
      upload: (
        url: string,
        content: Buffer,
        filename: string,
        documentType = 'BIRTH_CERTIFICATE',
      ) =>
        auth(agent.post(`/api/v1${url}`))
          .field('documentType', documentType)
          .attach('file', content, { filename, contentType: 'application/pdf' }),
    };
  };

  async function ok(res: request.Response | Promise<request.Response>, status = 201) {
    const r = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
  }

  const applicant = (firstNames = 'Sofía', extra: object = {}) => ({
    documentType: 'TI',
    documentNumber: String(1100000000 + docCounter++),
    firstNames,
    lastNames: 'Martínez López',
    birthDate: '2015-03-09',
    ...extra,
  });

  const guardian = (extra: object = {}) => ({
    documentType: 'CC',
    documentNumber: String(52000000 + docCounter++),
    firstNames: 'Laura',
    lastNames: 'López',
    relationship: 'MOTHER',
    phone: '3001234567',
    ...extra,
  });

  function apply(body: object = {}, token = tokens.secretary) {
    return api(token).post('/admissions', {
      academicYearId: s.year,
      gradeId: s.g6,
      applicant: applicant(),
      guardian: guardian(),
      ...body,
    });
  }

  /** Lleva una solicitud nueva hasta "aprobada". */
  async function approved(body: object = {}) {
    const a = await ok(apply(body));
    await ok(api(tokens.secretary).post(`/admissions/${a.id}/submit`), 200);
    await ok(api(tokens.secretary).post(`/admissions/${a.id}/review`), 200);
    return ok(
      api(tokens.coordinator).post(`/admissions/${a.id}/approve`, { note: 'Cumple requisitos' }),
      200,
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    docCounter = 1;
    institutionId = (await seedInstitution(app)).id;
    const roles = {
      admin: SYSTEM_ROLES.INSTITUTION_ADMIN,
      secretary: SYSTEM_ROLES.SECRETARY,
      coordinator: SYSTEM_ROLES.COORDINATOR,
      teacher: SYSTEM_ROLES.TEACHER,
    } as const;
    tokens = {} as typeof tokens;
    for (const [key, roleCode] of Object.entries(roles)) {
      const email = `${key}@prueba.edu.co`;
      await seedMember(app, { institutionId, email, password: PASSWORD, roleCode });
      tokens[key as keyof typeof roles] = await loginAs(app, email, PASSWORD);
    }

    const campus = await ok(api().post('/campuses', { code: 'A', name: 'Sede A', isMain: true }));
    const shift = await ok(api().post('/shifts', { code: 'MANANA', name: 'Mañana' }));
    const level = await ok(
      api().post('/education-levels', { code: 'SEC', name: 'Secundaria', sortOrder: 3 }),
    );
    const g6 = await ok(
      api().post('/grades', { code: '6', name: 'Sexto', educationLevelId: level.id, sortOrder: 6 }),
    );
    const year = await ok(
      api().post('/academic-years', {
        year: 2027,
        name: 'Año 2027',
        startsOn: '2027-01-25',
        endsOn: '2027-11-30',
      }),
    );
    const group = await ok(
      api().post('/school-groups', {
        academicYearId: year.id,
        gradeId: g6.id,
        campusId: campus.id,
        shiftId: shift.id,
        code: '601',
        name: 'Grupo 601',
        capacity: 1,
      }),
    );
    s = { year: year.id, g6: g6.id, group601: group.id };
  });

  // ---------------------------------------------------------------------------
  describe('Flujo de la solicitud', () => {
    it('borrador → enviada → en revisión → aprobada → matriculada, con historial y auditoría', async () => {
      const draft = await ok(apply());
      expect(draft).toMatchObject({
        code: 'ADM-2027-0001',
        status: 'DRAFT',
        grade: { name: 'Sexto' },
        applicant: { firstNames: 'Sofía', birthDate: '2015-03-09' },
        guardian: { firstNames: 'Laura', relationship: 'MOTHER' },
        documents: [],
      });
      await ok(api(tokens.secretary).post(`/admissions/${draft.id}/submit`), 200);
      await ok(api(tokens.secretary).post(`/admissions/${draft.id}/review`), 200);
      const a = await ok(
        api(tokens.coordinator).post(`/admissions/${draft.id}/approve`, {
          note: 'Cumple requisitos',
        }),
        200,
      );
      expect(a).toMatchObject({ status: 'APPROVED', decisionNote: 'Cumple requisitos' });

      const enrolled = await ok(
        api().post(`/admissions/${draft.id}/enroll`, {
          schoolGroupId: s.group601,
          enrolledOn: '2027-01-25',
        }),
        200,
      );
      expect(enrolled.status).toBe('ENROLLED');
      expect(
        enrolled.history.map((h: { from: string | null; to: string }) => [h.from, h.to]),
      ).toEqual([
        [null, 'DRAFT'],
        ['DRAFT', 'SUBMITTED'],
        ['SUBMITTED', 'IN_REVIEW'],
        ['IN_REVIEW', 'APPROVED'],
        ['APPROVED', 'ENROLLED'],
      ]);

      // Se creó el estudiante con su acudiente principal y la matrícula activa en el grupo.
      const student = await ok(api().get(`/students/${enrolled.studentId}`), 200);
      expect(student.person).toMatchObject({ firstNames: 'Sofía', lastNames: 'Martínez López' });
      expect(student.guardians).toEqual([
        expect.objectContaining({
          relationship: 'MOTHER',
          isPrimary: true,
          person: expect.objectContaining({ firstNames: 'Laura' }),
        }),
      ]);
      const enrollment = await ok(api().get(`/enrollments/${enrolled.enrollmentId}`), 200);
      expect(enrollment).toMatchObject({ status: 'ACTIVE', currentGroup: { code: '601' } });

      expect(
        await prisma.auditLog.count({ where: { action: 'admissions.application.status_changed' } }),
      ).toBe(4);
    });

    it('solo admite transiciones válidas', async () => {
      const a = await ok(apply());
      const code = async (r: Promise<request.Response>) => (await r).body.error.code;
      expect(await code(api(tokens.coordinator).post(`/admissions/${a.id}/approve`))).toBe(
        'INVALID_STATUS_TRANSITION',
      );
      expect(await code(api().post(`/admissions/${a.id}/enroll`))).toBe(
        'INVALID_STATUS_TRANSITION',
      );
      expect(await code(api(tokens.secretary).post(`/admissions/${a.id}/review`))).toBe(
        'INVALID_STATUS_TRANSITION',
      );

      await ok(api(tokens.secretary).post(`/admissions/${a.id}/submit`), 200);
      await ok(api(tokens.secretary).post(`/admissions/${a.id}/review`), 200);
      await ok(
        api(tokens.coordinator).post(`/admissions/${a.id}/waitlist`, {
          note: 'Sin cupo por ahora',
        }),
        200,
      );
      // Desde la lista de espera se puede rechazar, y el rechazo exige motivo.
      expect((await api(tokens.coordinator).post(`/admissions/${a.id}/reject`, {})).status).toBe(
        400,
      );
      const rejected = await ok(
        api(tokens.coordinator).post(`/admissions/${a.id}/reject`, {
          note: 'No hay cupo en el grado',
        }),
        200,
      );
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'No hay cupo en el grado',
      });

      // Un estado final no admite más cambios.
      expect(await code(api(tokens.secretary).post(`/admissions/${a.id}/withdraw`))).toBe(
        'INVALID_STATUS_TRANSITION',
      );
      expect(await code(api(tokens.secretary).patch(`/admissions/${a.id}`, { notes: 'x' }))).toBe(
        'ADMISSION_NOT_EDITABLE',
      );
    });

    it('la familia puede desistir de una solicitud abierta', async () => {
      const a = await ok(apply());
      await ok(api(tokens.secretary).post(`/admissions/${a.id}/submit`), 200);
      const withdrawn = await ok(
        api(tokens.secretary).post(`/admissions/${a.id}/withdraw`, { note: 'Se mudan de ciudad' }),
        200,
      );
      expect(withdrawn.status).toBe('WITHDRAWN');
    });

    it('un aspirante tiene una sola solicitud en curso por año; tras un rechazo puede volver a aplicar', async () => {
      const person = applicant();
      const first = await ok(apply({ applicant: person }));
      const dup = await apply({ applicant: person });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatchObject({
        code: 'ADMISSION_ALREADY_OPEN',
        details: { code: 'ADM-2027-0001' },
      });

      await ok(api(tokens.secretary).post(`/admissions/${first.id}/withdraw`), 200);
      expect((await ok(apply({ applicant: person }))).code).toBe('ADM-2027-0002');
    });

    it('numera sin repetir y no duplica aunque lleguen solicitudes simultáneas', async () => {
      const same = applicant();
      const results = await Promise.all([
        apply({ applicant: same }),
        apply({ applicant: same }),
        apply(),
        apply(),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 409]);
      const codes = results
        .filter((r) => r.status === 201)
        .map((r) => r.body.code)
        .sort();
      expect(codes).toEqual(['ADM-2027-0001', 'ADM-2027-0002', 'ADM-2027-0003']);
    });

    it('la base de datos impide solicitudes duplicadas y rechazos sin motivo', async () => {
      const a = await ok(apply());
      const db = await connectAsApp();
      try {
        expect(
          await sqlStateOf(
            db.query(
              `INSERT INTO admission_application (id, institution_id, academic_year_id, number, grade_id,
                 applicant_document_type, applicant_document_number, applicant_first_names, applicant_last_names, updated_at)
               SELECT gen_random_uuid(), institution_id, academic_year_id, number + 1, grade_id,
                 applicant_document_type, applicant_document_number, applicant_first_names, applicant_last_names, now()
               FROM admission_application WHERE id = $1`,
              [a.id],
            ),
          ),
        ).toBe(SQLSTATE.UNIQUE_VIOLATION);
        expect(
          await sqlStateOf(
            db.query(`UPDATE admission_application SET status = 'REJECTED' WHERE id = $1`, [a.id]),
          ),
        ).toBe(SQLSTATE.CHECK_VIOLATION);
      } finally {
        await db.end();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Matrícula del admitido', () => {
    it('reutiliza personas existentes: un acudiente que ya es docente no se duplica', async () => {
      const teacher = await ok(
        api().post('/staff', {
          person: {
            documentType: 'CC',
            documentNumber: '52999888',
            firstNames: 'Laura',
            lastNames: 'López',
          },
          staffType: 'TEACHER',
        }),
      );
      const a = await approved({ guardian: guardian({ documentNumber: '52999888' }) });
      await ok(api().post(`/admissions/${a.id}/enroll`), 200);
      // La docente pasó a ser también acudiente: una sola persona con dos perfiles.
      expect(await prisma.person.count({ where: { documentNumber: '52999888' } })).toBe(1);
      const staff = await prisma.staffMember.findUniqueOrThrow({ where: { id: teacher.id } });
      const guardianRecord = await prisma.guardian.findFirstOrThrow();
      expect(guardianRecord.personId).toBe(staff.personId);
    });

    it('es todo o nada: si la matrícula falla no queda estudiante ni acudiente', async () => {
      // El grupo 601 tiene cupo 1: lo ocupa otro admitido.
      const first = await approved();
      await ok(api().post(`/admissions/${first.id}/enroll`, { schoolGroupId: s.group601 }), 200);

      const second = await approved({ applicant: applicant('Tomás') });
      const res = await api().post(`/admissions/${second.id}/enroll`, {
        schoolGroupId: s.group601,
      });
      expect(res.body.error.code).toBe('GROUP_FULL');
      expect(await prisma.student.count()).toBe(1);
      expect(await prisma.guardian.count()).toBe(1);
      expect((await ok(api().get(`/admissions/${second.id}`), 200)).status).toBe('APPROVED');

      // Sin grupo, sí se matricula.
      expect((await ok(api().post(`/admissions/${second.id}/enroll`), 200)).status).toBe(
        'ENROLLED',
      );
    });

    it('rechaza a un aspirante cuyo documento ya existe con otro nombre', async () => {
      const existing = applicant('Valentina');
      await ok(api().post('/students', { person: existing }));
      const a = await approved({ applicant: { ...existing, firstNames: 'Otra Persona' } });
      const res = await api().post(`/admissions/${a.id}/enroll`);
      expect(res.body.error.code).toBe('PERSON_DATA_MISMATCH');
      expect((await ok(api().get(`/admissions/${a.id}`), 200)).status).toBe('APPROVED');
    });

    it('un estudiante retirado que vuelve a aplicar se reintegra con su mismo perfil', async () => {
      const person = applicant('Mateo');
      const student = await ok(api().post('/students', { person }));
      await ok(api().patch(`/students/${student.id}`, { status: 'WITHDRAWN' }), 200);
      const a = await approved({ applicant: person });
      const enrolled = await ok(api().post(`/admissions/${a.id}/enroll`), 200);
      expect(enrolled.studentId).toBe(student.id);
      expect((await ok(api().get(`/students/${student.id}`), 200)).status).toBe('ACTIVE');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Documentos', () => {
    it('adjunta documentos personales con descarga protegida, y los retira sin borrarlos', async () => {
      const a = await ok(apply());
      const withDoc = await ok(
        api(tokens.secretary).upload(`/admissions/${a.id}/documents`, PDF, 'registro civil.pdf'),
      );
      expect(withDoc.documents).toEqual([
        expect.objectContaining({
          documentType: 'BIRTH_CERTIFICATE',
          fileName: 'registro civil.pdf',
          mimeType: 'application/pdf',
        }),
      ]);
      const documentId = withDoc.documents[0].id;
      const stored = await prisma.admissionDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { storedFile: true },
      });
      expect(stored.storedFile.classification).toBe('PERSONAL');

      // Quien consulta admisiones descarga el documento por la solicitud…
      const download = await api(tokens.coordinator)
        .get(`/admissions/${a.id}/documents/${documentId}/file`)
        .responseType('blob');
      expect(download.status).toBe(200);
      expect(download.headers).toMatchObject({
        'content-type': 'application/pdf',
        'cache-control': 'private, no-store',
      });
      expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
      // …pero no por la ruta genérica de archivos, ni sin permiso de admisiones.
      expect((await api(tokens.coordinator).get(`/files/${stored.storedFileId}`)).status).toBe(404);
      expect(
        (await api(tokens.teacher).get(`/admissions/${a.id}/documents/${documentId}/file`)).status,
      ).toBe(403);

      const removed = await ok(
        api(tokens.secretary).delete(`/admissions/${a.id}/documents/${documentId}`),
        200,
      );
      expect(removed.documents).toEqual([]);
      expect(
        (await api(tokens.coordinator).get(`/admissions/${a.id}/documents/${documentId}/file`))
          .status,
      ).toBe(404);
      expect(await prisma.storedFile.count({ where: { id: stored.storedFileId } })).toBe(1);
    });

    it('valida el contenido real del archivo y el tipo de documento', async () => {
      const a = await ok(apply());
      const fake = await api(tokens.secretary).upload(
        `/admissions/${a.id}/documents`,
        Buffer.from('<script>alert(1)</script>'),
        'cedula.pdf',
      );
      expect(fake.status).toBe(415);
      const badType = await api(tokens.secretary).upload(
        `/admissions/${a.id}/documents`,
        PDF,
        'x.pdf',
        'HISTORIA_CLINICA',
      );
      expect(badType.status).toBe(400);
      expect(await prisma.admissionDocument.count()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Permisos', () => {
    it('secretaría registra y tramita; coordinación decide; ninguno hace lo del otro', async () => {
      const a = await ok(apply());
      await ok(api(tokens.secretary).post(`/admissions/${a.id}/submit`), 200);
      await ok(api(tokens.secretary).post(`/admissions/${a.id}/review`), 200);
      expect((await api(tokens.secretary).post(`/admissions/${a.id}/approve`)).status).toBe(403);
      expect((await apply({}, tokens.coordinator)).status).toBe(403);
      await ok(api(tokens.coordinator).post(`/admissions/${a.id}/approve`), 200);
      // Matricular exige además gestionar estudiantes, acudientes y matrículas.
      expect((await api(tokens.coordinator).post(`/admissions/${a.id}/enroll`)).status).toBe(403);
      expect((await api(tokens.teacher).get('/admissions')).status).toBe(403);
    });
  });
});

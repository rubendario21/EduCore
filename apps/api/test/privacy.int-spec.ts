import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { todayIn } from '../src/modules/dashboard/dashboard.service';
import { ageOn } from '../src/modules/privacy/privacy.service';
import { createTestApp } from './setup/create-test-app';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const CONTENT =
  'La institución trata los datos personales de estudiantes y acudientes para la prestación del servicio educativo, conforme a la Ley 1581 de 2012.';

describe('Protección de datos: políticas y autorizaciones (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokens: Record<'admin' | 'secretary' | 'coordinator' | 'teacher', string>;
  let docCounter = 1;
  // Fechas relativas a hoy: las autorizaciones no pueden ser futuras.
  const today = todayIn('America/Bogota');
  const daysAgo = (n: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const api = (token = tokens.admin) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
      upload: (url: string, content: Buffer, filename: string) =>
        auth(agent.post(`/api/v1${url}`)).attach('file', content, {
          filename,
          contentType: 'application/pdf',
        }),
    };
  };

  async function ok(res: request.Response | Promise<request.Response>, status = 201) {
    const r = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
  }

  const purposes = [
    { code: 'ACADEMICA', name: 'Gestión académica y administrativa', required: true },
    { code: 'IMAGEN', name: 'Uso de imagen en publicaciones institucionales' },
    { code: 'COMUNICACIONES', name: 'Envío de comunicaciones informativas' },
  ];

  async function publishedPolicy(version = '2026-1', effectiveFrom = daysAgo(60)) {
    const draft = await ok(
      api().post('/data-policies', {
        version,
        title: 'Política de tratamiento de datos',
        content: CONTENT,
        effectiveFrom,
        purposes,
      }),
    );
    return ok(api().post(`/data-policies/${draft.id}/publish`), 200);
  }

  /** Estudiante con un acudiente (representante legal o no). */
  async function studentWithGuardian(
    options: { legalRepresentative?: boolean; birthDate?: string } = {},
  ) {
    const student = await ok(
      api().post('/students', {
        person: {
          documentType: 'TI',
          documentNumber: String(1100000000 + docCounter++),
          firstNames: 'Sofía',
          lastNames: 'Martínez',
          birthDate: options.birthDate ?? '2015-03-09',
        },
      }),
    );
    const linked = await ok(
      api().post(`/students/${student.id}/guardians`, {
        person: {
          documentType: 'CC',
          documentNumber: String(52000000 + docCounter++),
          firstNames: 'Laura',
          lastNames: 'López',
        },
        relationship: 'MOTHER',
        isLegalRepresentative: options.legalRepresentative ?? true,
      }),
    );
    return {
      student,
      guardianPersonId: linked.guardians[0].person.id as string,
      studentPersonId: student.person.id as string,
    };
  }

  const decisionsFor = (
    policy: { purposes: Array<{ id: string; code: string }> },
    denied: string[] = [],
  ) => policy.purposes.map((p) => ({ purposeId: p.id, granted: !denied.includes(p.code) }));

  function consent(
    policy: { id: string; purposes: Array<{ id: string; code: string }> },
    studentId: string,
    authorizerPersonId: string,
    extra: object = {},
    token = tokens.secretary,
  ) {
    return api(token).post('/data-consents', {
      studentId,
      policyId: policy.id,
      authorizerPersonId,
      method: 'WRITTEN',
      consentedOn: daysAgo(5),
      decisions: decisionsFor(policy),
      ...extra,
    });
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
    const institutionId = (await seedInstitution(app)).id;
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
  });

  it('calcula la edad cumplida', () => {
    expect(ageOn('2008-10-20', '2026-10-19')).toBe(17);
    expect(ageOn('2008-10-19', '2026-10-19')).toBe(18);
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
  });

  // ---------------------------------------------------------------------------
  describe('Políticas', () => {
    it('borrador editable → publicada fija; la vigente es la última publicada en vigor', async () => {
      expect((await api().get('/data-policies/current')).body.error.code).toBe('NO_CURRENT_POLICY');
      const draft = await ok(
        api().post('/data-policies', {
          version: '2026-1',
          title: 'Política de datos',
          content: CONTENT,
          effectiveFrom: daysAgo(30),
          purposes,
        }),
      );
      expect(draft).toMatchObject({ status: 'DRAFT', publishedAt: null });
      expect(draft.purposes.map((p: { code: string }) => p.code)).toEqual([
        'ACADEMICA',
        'IMAGEN',
        'COMUNICACIONES',
      ]);

      const edited = await ok(
        api().patch(`/data-policies/${draft.id}`, { purposes: purposes.slice(0, 2) }),
        200,
      );
      expect(edited.purposes).toHaveLength(2);
      // Un borrador no es vigente.
      expect((await api().get('/data-policies/current')).status).toBe(404);

      const published = await ok(api().post(`/data-policies/${draft.id}/publish`), 200);
      expect(published.status).toBe('PUBLISHED');
      expect((await ok(api().get('/data-policies/current'), 200)).id).toBe(draft.id);
      expect(
        (await api().patch(`/data-policies/${draft.id}`, { title: 'Otro título' })).body.error.code,
      ).toBe('POLICY_PUBLISHED');
      expect((await api().post(`/data-policies/${draft.id}/publish`)).body.error.code).toBe(
        'POLICY_PUBLISHED',
      );

      // Una versión publicada que aún no entra en vigor no reemplaza a la vigente.
      const future = await ok(
        api().post('/data-policies', {
          version: '2099-1',
          title: 'Política futura',
          content: CONTENT,
          effectiveFrom: '2099-01-01',
          purposes,
        }),
      );
      await ok(api().post(`/data-policies/${future.id}/publish`), 200);
      expect((await ok(api().get('/data-policies/current'), 200)).version).toBe('2026-1');
      expect(await prisma.auditLog.count({ where: { action: 'privacy.policy.published' } })).toBe(
        2,
      );
    });

    it('valida versión única y códigos de finalidad distintos', async () => {
      await publishedPolicy('2026-1');
      const taken = await api().post('/data-policies', {
        version: '2026-1',
        title: 'Repetida',
        content: CONTENT,
        effectiveFrom: daysAgo(1),
        purposes,
      });
      expect(taken.body.error.code).toBe('POLICY_VERSION_TAKEN');
      const dupCodes = await api().post('/data-policies', {
        version: '2026-2',
        title: 'Duplicada',
        content: CONTENT,
        effectiveFrom: daysAgo(1),
        purposes: [purposes[0], purposes[0]],
      });
      expect(dupCodes.status).toBe(400);
      const noPurposes = await api().post('/data-policies', {
        version: '2026-3',
        title: 'Sin finalidades',
        content: CONTENT,
        effectiveFrom: daysAgo(1),
        purposes: [],
      });
      expect(noPurposes.status).toBe(400);
    });

    it('la base de datos impide modificar una política publicada o sus finalidades', async () => {
      const policy = await publishedPolicy();
      const db = await connectAsApp();
      try {
        expect(
          await sqlStateOf(
            db.query(`UPDATE data_policy SET content = 'cambiado' WHERE id = $1`, [policy.id]),
          ),
        ).toBe(SQLSTATE.INTEGRITY_VIOLATION);
        expect(
          await sqlStateOf(
            db.query(`DELETE FROM data_policy_purpose WHERE policy_id = $1`, [policy.id]),
          ),
        ).toBe(SQLSTATE.INTEGRITY_VIOLATION);
        expect(
          await sqlStateOf(
            db.query(
              `INSERT INTO data_policy_purpose (id, policy_id, code, name) VALUES (gen_random_uuid(), $1, 'NUEVA', 'Nueva')`,
              [policy.id],
            ),
          ),
        ).toBe(SQLSTATE.INTEGRITY_VIOLATION);
      } finally {
        await db.end();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Autorizaciones', () => {
    it('registra quién autoriza, para qué estudiante, la versión, la fecha, el medio y cada decisión', async () => {
      const policy = await publishedPolicy();
      const { student, guardianPersonId } = await studentWithGuardian();
      const recorded = await ok(
        consent(policy, student.id, guardianPersonId, {
          method: 'ELECTRONIC',
          decisions: decisionsFor(policy, ['IMAGEN']),
        }),
      );
      expect(recorded).toMatchObject({
        status: 'ACTIVE',
        policy: { version: '2026-1' },
        student: { id: student.id, firstNames: 'Sofía' },
        authorizer: { id: guardianPersonId, firstNames: 'Laura' },
        authorizerRole: 'LEGAL_REPRESENTATIVE',
        method: 'ELECTRONIC',
        consentedOn: daysAgo(5),
        evidence: null,
        revocation: null,
      });
      expect(
        recorded.decisions.map((d: { code: string; granted: boolean }) => [d.code, d.granted]),
      ).toEqual([
        ['ACADEMICA', true],
        ['IMAGEN', false],
        ['COMUNICACIONES', true],
      ]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'privacy.consent.recorded' },
      });
      expect(audit.metadata).toMatchObject({
        policyVersion: '2026-1',
        decisions: { IMAGEN: false },
      });
    });

    it('solo autoriza el representante legal, o el propio estudiante mayor de edad', async () => {
      const policy = await publishedPolicy();
      const notRepresentative = await studentWithGuardian({ legalRepresentative: false });
      expect(
        (await consent(policy, notRepresentative.student.id, notRepresentative.guardianPersonId))
          .body.error.code,
      ).toBe('AUTHORIZER_NOT_ALLOWED');

      const minor = await studentWithGuardian();
      // Un menor no se autoriza a sí mismo, ni lo autoriza el acudiente de otro estudiante.
      expect((await consent(policy, minor.student.id, minor.studentPersonId)).body.error.code).toBe(
        'AUTHORIZER_NOT_ALLOWED',
      );
      expect(
        (await consent(policy, minor.student.id, notRepresentative.guardianPersonId)).body.error
          .code,
      ).toBe('AUTHORIZER_NOT_ALLOWED');

      const adult = await studentWithGuardian({ birthDate: daysAgo(19 * 366) });
      const own = await ok(consent(policy, adult.student.id, adult.studentPersonId));
      expect(own.authorizerRole).toBe('TITULAR');
    });

    it('exige una decisión por finalidad, una política publicada y una fecha no futura', async () => {
      const policy = await publishedPolicy();
      const { student, guardianPersonId } = await studentWithGuardian();
      const partial = await consent(policy, student.id, guardianPersonId, {
        decisions: decisionsFor(policy).slice(1),
      });
      expect(partial.status).toBe(400);
      const repeated = decisionsFor(policy);
      repeated[1] = { ...repeated[0]! };
      expect(
        (await consent(policy, student.id, guardianPersonId, { decisions: repeated })).status,
      ).toBe(400);

      const other = await publishedPolicy('2026-2');
      const foreign = decisionsFor(policy);
      foreign[0] = { purposeId: other.purposes[0].id, granted: true };
      expect(
        (await consent(policy, student.id, guardianPersonId, { decisions: foreign })).status,
      ).toBe(400);

      expect(
        (await consent(policy, student.id, guardianPersonId, { consentedOn: '2099-01-01' })).status,
      ).toBe(400);

      const draft = await ok(
        api().post('/data-policies', {
          version: 'borrador',
          title: 'Borrador',
          content: CONTENT,
          effectiveFrom: daysAgo(1),
          purposes,
        }),
      );
      expect(
        (await consent({ id: draft.id, purposes: draft.purposes }, student.id, guardianPersonId))
          .body.error.code,
      ).toBe('POLICY_NOT_PUBLISHED');
      expect(await prisma.dataConsent.count()).toBe(0);
    });

    it('una sola autorización vigente por estudiante y versión, incluso con solicitudes simultáneas', async () => {
      const policy = await publishedPolicy();
      const { student, guardianPersonId } = await studentWithGuardian();
      const results = await Promise.all(
        [1, 2, 3].map(() => consent(policy, student.id, guardianPersonId)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(
        results
          .filter((r) => r.status === 409)
          .every((r) => r.body.error.code === 'CONSENT_ALREADY_ACTIVE'),
      ).toBe(true);
    });

    it('la revocación se registra sin borrar, y permite una autorización nueva', async () => {
      const policy = await publishedPolicy();
      const { student, guardianPersonId } = await studentWithGuardian();
      const first = await ok(consent(policy, student.id, guardianPersonId));
      expect(
        (await api(tokens.secretary).post(`/data-consents/${first.id}/revoke`, {})).status,
      ).toBe(400);
      const revoked = await ok(
        api(tokens.secretary).post(`/data-consents/${first.id}/revoke`, {
          reason: 'La madre solicitó revocar la autorización',
        }),
        200,
      );
      expect(revoked).toMatchObject({
        status: 'REVOKED',
        revocation: { date: today, reason: 'La madre solicitó revocar la autorización' },
      });
      expect(
        (
          await api(tokens.secretary).post(`/data-consents/${first.id}/revoke`, {
            reason: 'Otra vez',
          })
        ).body.error.code,
      ).toBe('CONSENT_REVOKED');

      await ok(
        consent(policy, student.id, guardianPersonId, {
          decisions: decisionsFor(policy, ['IMAGEN', 'COMUNICACIONES']),
        }),
      );
      const history = await ok(api().get(`/data-consents?studentId=${student.id}`), 200);
      expect(history.data.map((c: { status: string }) => c.status).sort()).toEqual([
        'ACTIVE',
        'REVOKED',
      ]);
      expect(
        (await ok(api().get(`/data-consents?studentId=${student.id}&status=ACTIVE`), 200)).meta
          .total,
      ).toBe(1);
    });

    it('la base de datos impide editar o borrar autorizaciones y sus decisiones', async () => {
      const policy = await publishedPolicy();
      const other = await publishedPolicy('2026-2');
      const { student, guardianPersonId } = await studentWithGuardian();
      const c = await ok(consent(policy, student.id, guardianPersonId));
      await ok(
        api(tokens.secretary).post(`/data-consents/${c.id}/revoke`, {
          reason: 'Solicitud del titular',
        }),
        200,
      );
      const db = await connectAsApp();
      try {
        expect(
          await sqlStateOf(
            db.query(`UPDATE data_consent SET method = 'EMAIL' WHERE id = $1`, [c.id]),
          ),
        ).toBe(SQLSTATE.INTEGRITY_VIOLATION);
        expect(
          await sqlStateOf(
            db.query(`UPDATE data_consent SET revocation_reason = 'otro' WHERE id = $1`, [c.id]),
          ),
        ).toBe(SQLSTATE.INTEGRITY_VIOLATION);
        expect(await sqlStateOf(db.query(`DELETE FROM data_consent WHERE id = $1`, [c.id]))).toBe(
          SQLSTATE.INSUFFICIENT_PRIVILEGE,
        );
        expect(
          await sqlStateOf(
            db.query(
              `UPDATE data_consent_decision SET granted = NOT granted WHERE consent_id = $1`,
              [c.id],
            ),
          ),
        ).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
        expect(
          await sqlStateOf(
            db.query(`DELETE FROM data_consent_decision WHERE consent_id = $1`, [c.id]),
          ),
        ).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
        expect(
          await sqlStateOf(
            db.query(
              `INSERT INTO data_consent_decision (id, consent_id, purpose_id, granted) VALUES (gen_random_uuid(), $1, $2, true)`,
              [c.id, other.purposes[0].id],
            ),
          ),
        ).toBe(SQLSTATE.INTEGRITY_VIOLATION);
      } finally {
        await db.end();
      }
    });

    it('adjunta el soporte una sola vez, como archivo personal de descarga protegida', async () => {
      const policy = await publishedPolicy();
      const { student, guardianPersonId } = await studentWithGuardian();
      const c = await ok(consent(policy, student.id, guardianPersonId));
      const withEvidence = await ok(
        api(tokens.secretary).upload(
          `/data-consents/${c.id}/evidence`,
          PDF,
          'autorizacion firmada.pdf',
        ),
        200,
      );
      expect(withEvidence.evidence).toMatchObject({
        fileName: 'autorizacion firmada.pdf',
        mimeType: 'application/pdf',
      });
      expect(
        (await api(tokens.secretary).upload(`/data-consents/${c.id}/evidence`, PDF, 'otra.pdf'))
          .body.error.code,
      ).toBe('EVIDENCE_ALREADY_ATTACHED');

      const download = await api(tokens.coordinator)
        .get(`/data-consents/${c.id}/evidence`)
        .responseType('blob');
      expect(download.status).toBe(200);
      expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
      const stored = await prisma.dataConsent.findUniqueOrThrow({
        where: { id: c.id },
        include: { evidenceFile: true },
      });
      expect(stored.evidenceFile!.classification).toBe('PERSONAL');
      expect((await api(tokens.coordinator).get(`/files/${stored.evidenceFileId}`)).status).toBe(
        404,
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('Cobertura y permisos', () => {
    it('muestra cuántos estudiantes activos tienen autorización vigente y quiénes faltan', async () => {
      const policy = await publishedPolicy();
      const complete = await studentWithGuardian();
      const denied = await studentWithGuardian();
      const missing = await studentWithGuardian();
      const revoked = await studentWithGuardian();
      const withdrawn = await studentWithGuardian();
      await ok(consent(policy, complete.student.id, complete.guardianPersonId));
      await ok(
        consent(policy, denied.student.id, denied.guardianPersonId, {
          decisions: decisionsFor(policy, ['ACADEMICA']),
        }),
      );
      const r = await ok(consent(policy, revoked.student.id, revoked.guardianPersonId));
      await ok(
        api(tokens.secretary).post(`/data-consents/${r.id}/revoke`, {
          reason: 'Solicitud del titular',
        }),
        200,
      );
      await ok(api().patch(`/students/${withdrawn.student.id}`, { status: 'WITHDRAWN' }), 200);

      const coverage = await ok(api(tokens.coordinator).get('/data-consents/coverage'), 200);
      expect(coverage.policy.version).toBe('2026-1');
      expect(coverage.totals).toEqual({
        activeStudents: 4,
        withConsent: 2,
        withoutConsent: 2,
        requiredDenied: 1,
      });
      expect(coverage.pending.map((p: { id: string }) => p.id).sort()).toEqual(
        [missing.student.id, revoked.student.id].sort(),
      );
      expect(coverage.meta.total).toBe(2);
    });

    it('secretaría registra, coordinación consulta, solo el administrador publica políticas', async () => {
      const policy = await publishedPolicy();
      const { student, guardianPersonId } = await studentWithGuardian();
      expect(
        (await consent(policy, student.id, guardianPersonId, {}, tokens.coordinator)).status,
      ).toBe(403);
      expect(
        (
          await api(tokens.secretary).post('/data-policies', {
            version: 'x',
            title: 'Política',
            content: CONTENT,
            effectiveFrom: daysAgo(1),
            purposes,
          })
        ).status,
      ).toBe(403);
      expect((await api(tokens.coordinator).get('/data-policies')).status).toBe(200);
      expect((await api(tokens.teacher).get('/data-consents')).status).toBe(403);
    });
  });
});

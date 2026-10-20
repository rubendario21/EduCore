import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

describe('Matrícula (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: string;
  let coordinator: string;
  let s: {
    year: string;
    nextYear: string;
    g6: string;
    g7: string;
    g11: string;
    group601: string;
    group602: string;
    group701: string;
    nextGroup701: string;
  };
  let docCounter = 1;

  const api = (token = admin) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
    };
  };

  async function ok(res: request.Response | Promise<request.Response>, status = 201) {
    const r = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
  }

  async function newStudent(firstNames = `Estudiante${docCounter}`) {
    return ok(
      api().post('/students', {
        person: {
          documentType: 'TI',
          documentNumber: String(1100000000 + docCounter++),
          firstNames,
          lastNames: 'De Prueba',
        },
      }),
    );
  }

  function enroll(studentId: string, extra: Record<string, unknown> = {}) {
    return api().post('/enrollments', {
      studentId,
      academicYearId: s.year,
      gradeId: s.g6,
      enrolledOn: '2027-01-25',
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
    await seedMember(app, {
      institutionId,
      email: 'rectoria@prueba.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.INSTITUTION_ADMIN,
    });
    await seedMember(app, {
      institutionId,
      email: 'coordinacion@prueba.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.COORDINATOR,
    });
    admin = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
    coordinator = await loginAs(app, 'coordinacion@prueba.edu.co', PASSWORD);

    const campus = await ok(api().post('/campuses', { code: 'A', name: 'Sede A', isMain: true }));
    const shift = await ok(api().post('/shifts', { code: 'MANANA', name: 'Mañana' }));
    const secondary = await ok(
      api().post('/education-levels', { code: 'SEC', name: 'Secundaria', sortOrder: 2 }),
    );
    const media = await ok(
      api().post('/education-levels', { code: 'MEDIA', name: 'Media', sortOrder: 3 }),
    );
    const g6 = await ok(
      api().post('/grades', {
        code: 'G6',
        name: 'Sexto',
        educationLevelId: secondary.id,
        sortOrder: 6,
      }),
    );
    const g7 = await ok(
      api().post('/grades', {
        code: 'G7',
        name: 'Séptimo',
        educationLevelId: secondary.id,
        sortOrder: 7,
      }),
    );
    const g11 = await ok(
      api().post('/grades', {
        code: 'G11',
        name: 'Undécimo',
        educationLevelId: media.id,
        sortOrder: 11,
      }),
    );

    const year = await ok(
      api().post('/academic-years', {
        year: 2027,
        name: 'Año 2027',
        startsOn: '2027-01-25',
        endsOn: '2027-11-30',
      }),
    );
    await ok(
      api().post(`/academic-years/${year.id}/periods`, {
        number: 1,
        name: 'Período único',
        startsOn: '2027-01-25',
        endsOn: '2027-11-30',
        weightPercent: 100,
      }),
    );
    await ok(api().post(`/academic-years/${year.id}/activate`), 200);
    const nextYear = await ok(
      api().post('/academic-years', {
        year: 2028,
        name: 'Año 2028',
        startsOn: '2028-01-24',
        endsOn: '2028-11-30',
      }),
    );

    const group = (yearId: string, gradeId: string, code: string, capacity?: number) =>
      ok(
        api().post('/school-groups', {
          academicYearId: yearId,
          gradeId,
          campusId: campus.id,
          shiftId: shift.id,
          code,
          name: `Grupo ${code}`,
          ...(capacity && { capacity }),
        }),
      );
    s = {
      year: year.id,
      nextYear: nextYear.id,
      g6: g6.id,
      g7: g7.id,
      g11: g11.id,
      group601: (await group(year.id, g6.id, '601', 2)).id,
      group602: (await group(year.id, g6.id, '602', 30)).id,
      group701: (await group(year.id, g7.id, '701')).id,
      nextGroup701: (await group(nextYear.id, g7.id, '701')).id,
    };
  });

  // ---------------------------------------------------------------------------
  describe('Matricular', () => {
    it('matricula y ubica en un grupo, con auditoría', async () => {
      const student = await newStudent('Sofía');
      const enrollment = await ok(enroll(student.id, { schoolGroupId: s.group601 }));
      expect(enrollment).toMatchObject({
        status: 'ACTIVE',
        enrolledOn: '2027-01-25',
        grade: { name: 'Sexto' },
        academicYear: { year: 2027 },
        currentGroup: { code: '601' },
        placements: [{ fromDate: '2027-01-25', toDate: null }],
        student: { firstNames: 'Sofía' },
      });

      const byGroup = await ok(api().get(`/enrollments?schoolGroupId=${s.group601}`), 200);
      expect(byGroup.meta.total).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { action: 'enrollments.enrollment.created' } }),
      ).toBe(1);
    });

    it('solo una matrícula vigente por estudiante y año, incluso con solicitudes simultáneas', async () => {
      const student = await newStudent();
      const results = await Promise.all([
        enroll(student.id),
        enroll(student.id),
        enroll(student.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
        'ENROLLMENT_ALREADY_CURRENT',
      );
      expect(await prisma.enrollment.count({ where: { studentId: student.id } })).toBe(1);
    });

    it('la base de datos impide dos matrículas vigentes aunque falle la aplicación', async () => {
      const student = await newStudent();
      const first = await ok(enroll(student.id));
      const db = await connectAsApp();
      try {
        const state = await sqlStateOf(
          db.query(
            `INSERT INTO enrollment (id, institution_id, student_id, academic_year_id, grade_id, status, enrolled_on, updated_at)
             SELECT gen_random_uuid(), institution_id, student_id, academic_year_id, grade_id, 'PRE_ENROLLED', enrolled_on, now()
             FROM enrollment WHERE id = $1`,
            [first.id],
          ),
        );
        expect(state).toBe(SQLSTATE.UNIQUE_VIOLATION);
      } finally {
        await db.end();
      }
    });

    it('respeta el cupo del grupo, incluso con matrículas simultáneas', async () => {
      const a = await newStudent();
      await ok(enroll(a.id, { schoolGroupId: s.group601 }));
      // Queda 1 cupo y llegan 3 solicitudes a la vez.
      const others = [await newStudent(), await newStudent(), await newStudent()];
      const results = await Promise.all(
        others.map((st) => enroll(st.id, { schoolGroupId: s.group601 })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'GROUP_FULL'),
      ).toBe(true);
      const placed = await prisma.groupPlacement.count({
        where: { schoolGroupId: s.group601, toDate: null },
      });
      expect(placed).toBe(2);
    });

    it('el grupo debe ser del mismo año y grado', async () => {
      const student = await newStudent();
      const res = await enroll(student.id, { schoolGroupId: s.group701 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GROUP_MISMATCH');
    });

    it('no matricula egresados', async () => {
      const student = await newStudent();
      await ok(api().patch(`/students/${student.id}`, { status: 'GRADUATED' }), 200);
      expect((await enroll(student.id)).body.error.code).toBe('STUDENT_NOT_ENROLLABLE');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Ubicación, retiro y traslado', () => {
    it('el cambio de grupo conserva el historial con fechas', async () => {
      const student = await newStudent();
      const enrollment = await ok(enroll(student.id, { schoolGroupId: s.group601 }));
      const moved = await ok(
        api().post(`/enrollments/${enrollment.id}/placement`, {
          schoolGroupId: s.group602,
          effectiveDate: '2027-04-05',
          reason: 'Cambio de jornada',
        }),
        200,
      );
      expect(moved.currentGroup.code).toBe('602');
      expect(moved.placements).toEqual([
        expect.objectContaining({
          group: expect.objectContaining({ code: '601' }),
          fromDate: '2027-01-25',
          toDate: '2027-04-05',
        }),
        expect.objectContaining({
          group: expect.objectContaining({ code: '602' }),
          fromDate: '2027-04-05',
          toDate: null,
          reason: 'Cambio de jornada',
        }),
      ]);

      // Un cambio el mismo día en que empezó la ubicación vigente es una corrección (no crea historial falso).
      const corrected = await ok(
        api().post(`/enrollments/${enrollment.id}/placement`, {
          schoolGroupId: s.group601,
          effectiveDate: '2027-04-05',
        }),
        200,
      );
      expect(corrected.placements).toHaveLength(2);
      expect(corrected.currentGroup.code).toBe('601');

      const backwards = await api().post(`/enrollments/${enrollment.id}/placement`, {
        schoolGroupId: s.group602,
        effectiveDate: '2027-03-01',
      });
      expect(backwards.status).toBe(400);
    });

    it('retira con fecha y motivo, cierra la ubicación y permite el reingreso', async () => {
      const student = await newStudent();
      const enrollment = await ok(enroll(student.id, { schoolGroupId: s.group601 }));
      const withdrawn = await ok(
        api().post(`/enrollments/${enrollment.id}/withdraw`, {
          date: '2027-05-20',
          reason: 'RELOCATION',
          detail: 'Cambio de ciudad',
        }),
        200,
      );
      expect(withdrawn).toMatchObject({
        status: 'WITHDRAWN',
        endedOn: '2027-05-20',
        withdrawalReason: 'RELOCATION',
        endDetail: 'Cambio de ciudad',
        currentGroup: null,
        placements: [expect.objectContaining({ toDate: '2027-05-20' })],
        student: { status: 'WITHDRAWN' },
      });
      // El retiro liberó el cupo.
      expect(
        await prisma.groupPlacement.count({ where: { schoolGroupId: s.group601, toDate: null } }),
      ).toBe(0);

      // Reingreso en el mismo año: nueva matrícula; la anterior se conserva.
      const again = await ok(
        enroll(student.id, { schoolGroupId: s.group602, enrolledOn: '2027-08-01' }),
      );
      expect(again.student.status).toBe('ACTIVE');
      const history = await ok(api().get(`/enrollments?studentId=${student.id}`), 200);
      expect(history.data.map((e: { status: string }) => e.status).sort()).toEqual([
        'ACTIVE',
        'WITHDRAWN',
      ]);

      // Un retiro no se puede repetir ni modificar.
      expect(
        (
          await api().post(`/enrollments/${enrollment.id}/withdraw`, {
            date: '2027-06-01',
            reason: 'OTHER',
          })
        ).body.error.code,
      ).toBe('INVALID_STATUS_TRANSITION');
    });

    it('registra el traslado con la institución de destino', async () => {
      const student = await newStudent();
      const enrollment = await ok(enroll(student.id));
      const transferred = await ok(
        api().post(`/enrollments/${enrollment.id}/transfer`, {
          date: '2027-03-15',
          destination: 'Colegio San José, Medellín',
        }),
        200,
      );
      expect(transferred).toMatchObject({
        status: 'TRANSFERRED',
        endedOn: '2027-03-15',
        endDetail: 'Destino: Colegio San José, Medellín',
      });
      expect(
        await prisma.auditLog.count({ where: { action: 'enrollments.enrollment.transferred' } }),
      ).toBe(1);
    });

    it('rechaza fechas anteriores a la matrícula', async () => {
      const student = await newStudent();
      const enrollment = await ok(enroll(student.id));
      expect(
        (
          await api().post(`/enrollments/${enrollment.id}/withdraw`, {
            date: '2026-12-01',
            reason: 'OTHER',
          })
        ).status,
      ).toBe(400);
    });

    it('prematrícula: se formaliza o se anula (sin borrarse)', async () => {
      const a = await newStudent();
      const pre = await ok(enroll(a.id, { status: 'PRE_ENROLLED', schoolGroupId: s.group601 }));
      expect(pre.status).toBe('PRE_ENROLLED');
      expect((await ok(api().post(`/enrollments/${pre.id}/activate`), 200)).status).toBe('ACTIVE');

      const b = await newStudent();
      const pre2 = await ok(enroll(b.id, { status: 'PRE_ENROLLED', schoolGroupId: s.group601 }));
      const cancelled = await ok(api().post(`/enrollments/${pre2.id}/cancel`), 200);
      expect(cancelled.status).toBe('CANCELLED');
      // La anulación liberó el cupo: el grupo de 2 admite otro estudiante.
      const c = await newStudent();
      expect((await enroll(c.id, { schoolGroupId: s.group601 })).status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Renovación', () => {
    it('simula, renueva al siguiente grado, omite el último grado y es idempotente', async () => {
      const a = await newStudent('Ana');
      const b = await newStudent('Bruno');
      const c = await newStudent('Carla');
      await ok(enroll(a.id, { schoolGroupId: s.group601 }));
      await ok(enroll(b.id, { gradeId: s.g11 }));
      const withdrawnEnrollment = await ok(enroll(c.id));
      await ok(
        api().post(`/enrollments/${withdrawnEnrollment.id}/withdraw`, {
          date: '2027-05-01',
          reason: 'OTHER',
        }),
        200,
      );

      const body = {
        fromAcademicYearId: s.year,
        toAcademicYearId: s.nextYear,
        gradeStrategy: 'NEXT',
      };
      const preview = await ok(api().post('/enrollments/renewals', { ...body, dryRun: true }), 200);
      expect(preview).toMatchObject({
        dryRun: true,
        created: [{ name: 'Ana De Prueba', fromGrade: 'Sexto', toGrade: 'Séptimo' }],
        skipped: [{ name: 'Bruno De Prueba', reason: 'LAST_GRADE' }],
      });
      expect(await prisma.enrollment.count({ where: { academicYearId: s.nextYear } })).toBe(0);

      const done = await ok(api().post('/enrollments/renewals', body), 200);
      expect(done.created).toHaveLength(1);
      const renewed = await prisma.enrollment.findFirstOrThrow({
        where: { academicYearId: s.nextYear },
      });
      expect(renewed).toMatchObject({ studentId: a.id, gradeId: s.g7, status: 'PRE_ENROLLED' });
      expect(renewed.previousEnrollmentId).not.toBeNull();

      const again = await ok(api().post('/enrollments/renewals', body), 200);
      expect(again.created).toHaveLength(0);
      expect(again.skipped).toContainEqual(
        expect.objectContaining({ studentId: a.id, reason: 'ALREADY_ENROLLED' }),
      );
    });

    it('con la estrategia SAME renueva en el mismo grado', async () => {
      const a = await newStudent();
      await ok(enroll(a.id));
      const done = await ok(
        api().post('/enrollments/renewals', {
          fromAcademicYearId: s.year,
          toAcademicYearId: s.nextYear,
          gradeStrategy: 'SAME',
        }),
        200,
      );
      expect(done.created[0]).toMatchObject({ fromGrade: 'Sexto', toGrade: 'Sexto' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('Coherencia con grupos, años y permisos', () => {
    it('un grupo con estudiantes no se desactiva ni reduce su cupo por debajo de la ocupación', async () => {
      const a = await newStudent();
      const b = await newStudent();
      await ok(enroll(a.id, { schoolGroupId: s.group601 }));
      await ok(enroll(b.id, { schoolGroupId: s.group601 }));
      expect(
        (await api().patch(`/school-groups/${s.group601}`, { status: 'INACTIVE' })).body.error.code,
      ).toBe('IN_USE');
      expect(
        (await api().patch(`/school-groups/${s.group601}`, { capacity: 1 })).body.error.code,
      ).toBe('CAPACITY_BELOW_OCCUPANCY');
      expect(
        (await api().patch(`/school-groups/${s.group601}`, { gradeId: s.g7 })).body.error.code,
      ).toBe('GROUP_HAS_STUDENTS');
    });

    it('un año cerrado no admite cambios de matrícula', async () => {
      const a = await newStudent();
      const enrollment = await ok(enroll(a.id, { schoolGroupId: s.group601 }));
      await ok(api().post(`/academic-years/${s.year}/close`), 200);
      const res = await api().post(`/enrollments/${enrollment.id}/placement`, {
        schoolGroupId: s.group602,
      });
      expect(res.body.error.code).toBe('ACADEMIC_YEAR_CLOSED');
      expect((await enroll((await newStudent()).id)).body.error.code).toBe('ACADEMIC_YEAR_CLOSED');
    });

    it('el coordinador consulta pero no matricula', async () => {
      const a = await newStudent();
      const enrollment = await ok(enroll(a.id));
      expect((await api(coordinator).get(`/enrollments/${enrollment.id}`)).status).toBe(200);
      expect(
        (
          await api(coordinator).post('/enrollments', {
            studentId: a.id,
            academicYearId: s.nextYear,
            gradeId: s.g7,
          })
        ).status,
      ).toBe(403);
    });
  });
});

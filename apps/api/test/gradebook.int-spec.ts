import { DECREE_1290_EXAMPLE, SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

describe('Planilla de notas (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokens: Record<'admin' | 'coordinator' | 'teacherA' | 'teacherB', string>;
  let s: {
    year: string;
    period: string;
    group601: string;
    group602: string;
    mat: string;
    lc: string;
    cog: string;
    pro: string;
    ana: string;
    bruno: string;
    other: string;
  };
  let doc = 1;

  const api = (token = tokens.admin) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      put: (url: string, body: object) => auth(agent.put(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
      delete: (url: string) => auth(agent.delete(`/api/v1${url}`)),
    };
  };
  async function ok(res: request.Response | Promise<request.Response>, status = 201) {
    const r = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
  }
  const book = (token = tokens.teacherA, subjectId = s.mat, groupId = s.group601) =>
    api(token).get(
      `/gradebook?schoolGroupId=${groupId}&subjectId=${subjectId}&periodId=${s.period}`,
    );
  const newAssessment = (
    componentId: string,
    title: string,
    token = tokens.teacherA,
    subjectId = s.mat,
  ) =>
    api(token).post('/assessments', {
      schoolGroupId: s.group601,
      subjectId,
      periodId: s.period,
      componentId,
      title,
    });
  const grade = (
    assessmentId: string,
    grades: Array<{ enrollmentId: string; score: number | null }>,
    reason?: string,
    token = tokens.teacherA,
  ) => api(token).put(`/assessments/${assessmentId}/grades`, { grades, ...(reason && { reason }) });

  const siee = {
    ...DECREE_1290_EXAMPLE.scale,
    promotionUnit: 'AREA',
    levels: DECREE_1290_EXAMPLE.levels,
    components: [
      { code: 'COG', name: 'Cognitivo', weightPercent: 60 },
      { code: 'PRO', name: 'Procedimental', weightPercent: 40 },
    ],
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    doc = 1;
    const institutionId = (await seedInstitution(app)).id;
    const people: Array<[keyof typeof tokens, string, string]> = [
      ['admin', SYSTEM_ROLES.INSTITUTION_ADMIN, 'Rectoría'],
      ['coordinator', SYSTEM_ROLES.COORDINATOR, 'Coordinación'],
      ['teacherA', SYSTEM_ROLES.TEACHER, 'Ana'],
      ['teacherB', SYSTEM_ROLES.TEACHER, 'Beto'],
    ];
    tokens = {} as typeof tokens;
    const persons: Record<string, { documentNumber: string; firstNames: string }> = {};
    for (const [key, roleCode, firstNames] of people) {
      const email = `${key.toLowerCase()}@prueba.edu.co`;
      const seeded = await seedMember(app, {
        institutionId,
        email,
        password: PASSWORD,
        roleCode,
        firstNames,
        lastNames: 'Prueba',
      });
      persons[key] = { documentNumber: seeded.person.documentNumber, firstNames };
      tokens[key] = await loginAs(app, email, PASSWORD);
    }
    const staff = async (key: 'teacherA' | 'teacherB') =>
      (
        await ok(
          api().post('/staff', {
            person: {
              documentType: 'CC',
              documentNumber: persons[key]!.documentNumber,
              firstNames: persons[key]!.firstNames,
              lastNames: 'Prueba',
            },
            staffType: 'TEACHER',
          }),
        )
      ).id as string;
    const teacherA = await staff('teacherA');
    await staff('teacherB');

    const campus = await ok(api().post('/campuses', { code: 'A', name: 'Sede A', isMain: true }));
    const shift = await ok(api().post('/shifts', { code: 'M', name: 'Mañana' }));
    const level = await ok(
      api().post('/education-levels', { code: 'SEC', name: 'Secundaria', sortOrder: 3 }),
    );
    const g6 = await ok(
      api().post('/grades', { code: '6', name: 'Sexto', educationLevelId: level.id, sortOrder: 6 }),
    );
    const area = await ok(api().post('/subject-areas', { code: 'MAT', name: 'Matemáticas' }));
    const mat = await ok(
      api().post('/subjects', { code: 'MAT', name: 'Matemáticas', subjectAreaId: area.id }),
    );
    const lc = await ok(
      api().post('/subjects', { code: 'LC', name: 'Lengua castellana', subjectAreaId: area.id }),
    );
    const year = await ok(
      api().post('/academic-years', {
        year: 2027,
        name: 'Año 2027',
        startsOn: '2027-01-25',
        endsOn: '2027-11-30',
      }),
    );
    const yearDetail = await ok(
      api().post(`/academic-years/${year.id}/periods`, {
        number: 1,
        name: 'Primer período',
        startsOn: '2027-01-25',
        endsOn: '2027-11-30',
        weightPercent: 100,
      }),
    );
    const scheme = await ok(api().put(`/academic-years/${year.id}/grading-scheme`, siee), 200);
    await ok(api().post(`/academic-years/${year.id}/activate`), 200);
    const group = (code: string) =>
      ok(
        api().post('/school-groups', {
          academicYearId: year.id,
          gradeId: g6.id,
          campusId: campus.id,
          shiftId: shift.id,
          code,
          name: code,
        }),
      );
    const group601 = (await group('601')).id;
    const group602 = (await group('602')).id;
    for (const subjectId of [mat.id, lc.id]) {
      await ok(
        api().post('/curriculum', {
          academicYearId: year.id,
          gradeId: g6.id,
          subjectId,
          weeklyHours: 4,
        }),
      );
    }
    await ok(
      api().post('/teaching-assignments', {
        schoolGroupId: group601,
        subjectId: mat.id,
        staffMemberId: teacherA,
      }),
    );

    const enroll = async (firstNames: string, groupId: string) => {
      const student = await ok(
        api().post('/students', {
          person: {
            documentType: 'TI',
            documentNumber: String(1100 + doc++),
            firstNames,
            lastNames: 'Estudiante',
          },
        }),
      );
      return (
        await ok(
          api().post('/enrollments', {
            studentId: student.id,
            academicYearId: year.id,
            gradeId: g6.id,
            schoolGroupId: groupId,
          }),
        )
      ).id as string;
    };
    s = {
      year: year.id,
      period: yearDetail.periods[0].id,
      group601,
      group602,
      mat: mat.id,
      lc: lc.id,
      cog: scheme.components.find((c: { code: string }) => c.code === 'COG').id,
      pro: scheme.components.find((c: { code: string }) => c.code === 'PRO').id,
      ana: await enroll('Ana', group601),
      bruno: await enroll('Bruno', group601),
      other: await enroll('Carla', group602),
    };
  });

  const openPeriod = () => ok(api().post(`/academic-periods/${s.period}/open`), 200);

  it('solo se registran actividades y notas en un período abierto', async () => {
    expect((await newAssessment(s.cog, 'Taller')).body.error.code).toBe('PERIOD_NOT_OPEN');
    await openPeriod();
    expect((await api().post(`/academic-periods/${s.period}/open`)).body.error.code).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect((await newAssessment(s.cog, 'Taller')).status).toBe(201);
  });

  it('calcula promedios por componente, la nota parcial ponderada y el nivel de desempeño', async () => {
    await openPeriod();
    const quiz = await ok(newAssessment(s.cog, 'Quiz'));
    const exam = await ok(newAssessment(s.cog, 'Examen'));
    const project = await ok(newAssessment(s.pro, 'Proyecto'));
    await ok(
      grade(quiz.id, [
        { enrollmentId: s.ana, score: 4 },
        { enrollmentId: s.bruno, score: 2 },
      ]),
      200,
    );
    await ok(grade(exam.id, [{ enrollmentId: s.ana, score: 3 }]), 200);
    await ok(grade(project.id, [{ enrollmentId: s.ana, score: 5 }]), 200);

    const view = await ok(book(), 200);
    expect(view).toMatchObject({
      period: { status: 'OPEN' },
      canEdit: true,
      scheme: { passingScore: 3 },
    });
    expect(
      view.assessments.map((a: { title: string; gradedCount: number }) => [a.title, a.gradedCount]),
    ).toEqual([
      ['Quiz', 2],
      ['Examen', 1],
      ['Proyecto', 1],
    ]);
    const ana = view.students.find((x: { enrollmentId: string }) => x.enrollmentId === s.ana);
    // Cognitivo (4 + 3) / 2 = 3,5; Procedimental 5. Parcial: 3,5·0,6 + 5·0,4 = 4,1.
    expect(ana).toMatchObject({
      componentAverages: { [s.cog]: 3.5, [s.pro]: 5 },
      periodScore: 4.1,
      level: { code: 'ALTO' },
      passing: true,
    });
    const bruno = view.students.find((x: { enrollmentId: string }) => x.enrollmentId === s.bruno);
    // Sin notas de Procedimental, la parcial es la de Cognitivo.
    expect(bruno).toMatchObject({
      periodScore: 2,
      level: { code: 'BAJO' },
      passing: false,
      componentAverages: { [s.pro]: null },
    });
  });

  it('cada cambio queda en el historial; repetir el mismo valor no crea registros', async () => {
    await openPeriod();
    const quiz = await ok(newAssessment(s.cog, 'Quiz'));
    await ok(grade(quiz.id, [{ enrollmentId: s.ana, score: 4 }]), 200);
    expect(await ok(grade(quiz.id, [{ enrollmentId: s.ana, score: 4 }]), 200)).toEqual({
      changed: 0,
    });
    await ok(grade(quiz.id, [{ enrollmentId: s.ana, score: 4.5 }], 'Revisión de la prueba'), 200);
    await ok(grade(quiz.id, [{ enrollmentId: s.ana, score: null }], 'Se anuló la prueba'), 200);

    const history = await ok(
      api(tokens.coordinator).get(`/assessments/${quiz.id}/grades/${s.ana}/history`),
      200,
    );
    expect(
      history.map(
        (h: { previousScore: number | null; newScore: number | null; reason: string | null }) => [
          h.previousScore,
          h.newScore,
          h.reason,
        ],
      ),
    ).toEqual([
      [null, 4, null],
      [4, 4.5, 'Revisión de la prueba'],
      [4.5, null, 'Se anuló la prueba'],
    ]);
  });

  it('rechaza todo el lote si una nota está fuera de la escala o el estudiante no es del grupo', async () => {
    await openPeriod();
    const quiz = await ok(newAssessment(s.cog, 'Quiz'));
    for (const bad of [5.5, 0.5, 3.55]) {
      const res = await grade(quiz.id, [
        { enrollmentId: s.ana, score: 4 },
        { enrollmentId: s.bruno, score: bad },
      ]);
      expect(res.status).toBe(400);
    }
    const foreign = await grade(quiz.id, [{ enrollmentId: s.other, score: 4 }]);
    expect(JSON.stringify(foreign.body)).toContain('no está ubicado en este grupo');
    expect(await prisma.gradeRecord.count()).toBe(0);
  });

  it('el docente solo alcanza sus asignaciones; coordinación y rectoría consultan sin editar', async () => {
    await openPeriod();
    const quiz = await ok(newAssessment(s.cog, 'Quiz'));
    // El docente B no tiene la asignación: la asignatura del grupo no existe para él.
    expect((await book(tokens.teacherB)).status).toBe(404);
    expect(
      (await grade(quiz.id, [{ enrollmentId: s.ana, score: 4 }], undefined, tokens.teacherB))
        .status,
    ).toBe(404);
    // El docente A no dicta Lengua castellana en 601.
    expect((await book(tokens.teacherA, s.lc)).status).toBe(404);
    expect((await newAssessment(s.cog, 'Otra', tokens.teacherA, s.lc)).status).toBe(404);

    const coord = await ok(book(tokens.coordinator), 200);
    expect(coord.canEdit).toBe(false);
    expect((await newAssessment(s.cog, 'X', tokens.coordinator)).status).toBe(403);
    expect((await ok(book(tokens.admin), 200)).canEdit).toBe(false);
  });

  it('con notas registradas el SIEE fija su escala, y la actividad no se elimina', async () => {
    await openPeriod();
    const quiz = await ok(newAssessment(s.cog, 'Quiz'));
    const empty = await ok(newAssessment(s.pro, 'Sin notas'));
    await ok(grade(quiz.id, [{ enrollmentId: s.ana, score: 4 }]), 200);

    const locked = await api().put(`/academic-years/${s.year}/grading-scheme`, {
      ...siee,
      passingScore: 3.5,
    });
    expect(locked.body.error.code).toBe('GRADING_SCHEME_LOCKED');
    const reweighted = await api().put(`/academic-years/${s.year}/grading-scheme`, {
      ...siee,
      components: [
        { ...siee.components[0], weightPercent: 50 },
        { ...siee.components[1], weightPercent: 50 },
      ],
    });
    expect(reweighted.body.error.code).toBe('GRADING_SCHEME_LOCKED');
    // Los criterios y reglas de promoción sí se pueden editar.
    expect(
      (
        await api().put(`/academic-years/${s.year}/grading-scheme`, {
          ...siee,
          notes: 'Recuperación en la semana 10.',
        })
      ).status,
    ).toBe(200);

    expect((await api(tokens.teacherA).delete(`/assessments/${quiz.id}`)).body.error.code).toBe(
      'ASSESSMENT_HAS_GRADES',
    );
    expect(
      (await api(tokens.teacherA).patch(`/assessments/${quiz.id}`, { componentId: s.pro })).body
        .error.code,
    ).toBe('ASSESSMENT_HAS_GRADES');
    expect((await api(tokens.teacherA).delete(`/assessments/${empty.id}`)).status).toBe(204);
  });

  it('un estudiante que cambia de grupo conserva sus notas visibles, pero ya no se le registran aquí', async () => {
    await openPeriod();
    const quiz = await ok(newAssessment(s.cog, 'Quiz'));
    await ok(grade(quiz.id, [{ enrollmentId: s.bruno, score: 3.2 }]), 200);
    await ok(
      api().post(`/enrollments/${s.bruno}/placement`, {
        schoolGroupId: s.group602,
        effectiveDate: '2027-04-01',
      }),
      200,
    );

    const view = await ok(book(), 200);
    expect(
      view.students.find((x: { enrollmentId: string }) => x.enrollmentId === s.bruno),
    ).toMatchObject({ inGroup: false, grades: { [quiz.id]: 3.2 } });
    expect((await grade(quiz.id, [{ enrollmentId: s.bruno, score: 4 }])).status).toBe(400);
  });

  it('la base de datos protege el historial y la escala', async () => {
    await openPeriod();
    const quiz = await ok(newAssessment(s.cog, 'Quiz'));
    await ok(grade(quiz.id, [{ enrollmentId: s.ana, score: 4 }]), 200);
    const db = await connectAsApp();
    try {
      expect(await sqlStateOf(db.query(`UPDATE grade_record_change SET new_score = 5`))).toBe(
        SQLSTATE.INSUFFICIENT_PRIVILEGE,
      );
      expect(await sqlStateOf(db.query(`DELETE FROM grade_record_change`))).toBe(
        SQLSTATE.INSUFFICIENT_PRIVILEGE,
      );
      expect(await sqlStateOf(db.query(`UPDATE grade_record SET score = 9`))).toBe(
        SQLSTATE.CHECK_VIOLATION,
      );
    } finally {
      await db.end();
    }
  });
});

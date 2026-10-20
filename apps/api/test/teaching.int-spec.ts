import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';

describe('Plan de estudios, asignación docente y plantilla (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let institutionId: string;
  let admin: string;
  let coordinator: string;
  let teacherToken: string;
  let s: {
    year: string;
    nextYear: string;
    g6: string;
    g7: string;
    mat: string;
    esp: string;
    group601: string;
    group602: string;
    group701: string;
    teacherA: string;
    teacherB: string;
    clerk: string;
  };
  let docCounter = 1;

  const api = (token = admin) => {
    const agent = request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(agent.get(`/api/v1${url}`)),
      post: (url: string, body: object = {}) => auth(agent.post(`/api/v1${url}`)).send(body),
      patch: (url: string, body: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
      delete: (url: string) => auth(agent.delete(`/api/v1${url}`)),
    };
  };

  async function ok(res: request.Response | Promise<request.Response>, status = 201) {
    const r = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
  }

  const person = (firstNames: string, lastNames = 'De Prueba') => ({
    documentType: 'CC',
    documentNumber: String(52000000 + docCounter++),
    firstNames,
    lastNames,
  });

  /** Estudiante matriculado y ubicado en un grupo. */
  async function placedStudent(firstNames: string, gradeId: string, schoolGroupId: string) {
    const student = await ok(
      api().post('/students', { person: { ...person(firstNames), documentType: 'TI' } }),
    );
    await ok(
      api().post('/enrollments', {
        studentId: student.id,
        academicYearId: s.year,
        gradeId,
        schoolGroupId,
      }),
    );
    return student;
  }

  const assign = (
    schoolGroupId: string,
    subjectId: string,
    staffMemberId: string,
    extra: object = {},
  ) => api().post('/teaching-assignments', { schoolGroupId, subjectId, staffMemberId, ...extra });

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
    // La docente A tiene cuenta (rol Docente) y perfil de personal sobre la misma persona.
    const teacherUser = await seedMember(app, {
      institutionId,
      email: 'docente@prueba.edu.co',
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.TEACHER,
      firstNames: 'Ana',
      lastNames: 'Docente',
    });
    admin = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
    coordinator = await loginAs(app, 'coordinacion@prueba.edu.co', PASSWORD);
    teacherToken = await loginAs(app, 'docente@prueba.edu.co', PASSWORD);

    const teacherA = await ok(
      api().post('/staff', {
        person: {
          documentType: 'CC',
          documentNumber: teacherUser.person.documentNumber,
          firstNames: 'Ana',
          lastNames: 'Docente',
        },
        staffType: 'TEACHER',
      }),
    );
    const teacherB = await ok(
      api().post('/staff', { person: person('Bruno', 'Docente'), staffType: 'TEACHER' }),
    );
    const clerk = await ok(
      api().post('/staff', { person: person('Carmen', 'Auxiliar'), staffType: 'ADMINISTRATIVE' }),
    );

    const campus = await ok(api().post('/campuses', { code: 'A', name: 'Sede A', isMain: true }));
    const shift = await ok(api().post('/shifts', { code: 'MANANA', name: 'Mañana' }));
    const level = await ok(
      api().post('/education-levels', { code: 'SEC', name: 'Secundaria', sortOrder: 3 }),
    );
    const g6 = await ok(
      api().post('/grades', { code: '6', name: 'Sexto', educationLevelId: level.id, sortOrder: 6 }),
    );
    const g7 = await ok(
      api().post('/grades', {
        code: '7',
        name: 'Séptimo',
        educationLevelId: level.id,
        sortOrder: 7,
      }),
    );
    const area = await ok(api().post('/subject-areas', { code: 'MAT', name: 'Matemáticas' }));
    const hum = await ok(api().post('/subject-areas', { code: 'HUM', name: 'Humanidades' }));
    const mat = await ok(
      api().post('/subjects', { code: 'MAT', name: 'Matemáticas', subjectAreaId: area.id }),
    );
    const esp = await ok(
      api().post('/subjects', { code: 'LC', name: 'Lengua castellana', subjectAreaId: hum.id }),
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

    const group = async (gradeId: string, code: string) =>
      (
        await ok(
          api().post('/school-groups', {
            academicYearId: year.id,
            gradeId,
            campusId: campus.id,
            shiftId: shift.id,
            code,
            name: `Grupo ${code}`,
          }),
        )
      ).id;

    s = {
      year: year.id,
      nextYear: nextYear.id,
      g6: g6.id,
      g7: g7.id,
      mat: mat.id,
      esp: esp.id,
      group601: await group(g6.id, '601'),
      group602: await group(g6.id, '602'),
      group701: await group(g7.id, '701'),
      teacherA: teacherA.id,
      teacherB: teacherB.id,
      clerk: clerk.id,
    };

    for (const [gradeId, subjectId, weeklyHours] of [
      [s.g6, s.mat, 5],
      [s.g6, s.esp, 4],
      [s.g7, s.mat, 5],
    ] as const) {
      await ok(
        api().post('/curriculum', { academicYearId: s.year, gradeId, subjectId, weeklyHours }),
      );
    }
  });

  // ---------------------------------------------------------------------------
  describe('Plantilla académica colombiana', () => {
    it('simula, aplica y es idempotente; respeta lo que ya existe', async () => {
      const preview = await ok(api().post('/academic-templates/colombia', { dryRun: true }), 200);
      expect(preview.dryRun).toBe(true);
      // Ya existen los grados 6 y 7, el área MAT/HUM y las asignaturas MAT/LC.
      expect(preview.skipped.grades.map((g: { code: string }) => g.code)).toEqual(['6', '7']);
      expect(preview.created.grades).toHaveLength(12);
      // El nivel SEC ya existía: se reutiliza para los grados 8 y 9.
      expect(preview.skipped.levels.map((l: { code: string }) => l.code)).toEqual(['SEC']);
      expect(preview.created.levels).toHaveLength(3);
      expect(preview.skipped.subjects.map((x: { code: string }) => x.code).sort()).toEqual([
        'LC',
        'MAT',
      ]);
      expect(await prisma.grade.count()).toBe(2);

      const applied = await ok(api().post('/academic-templates/colombia', {}), 200);
      expect(applied.created).toEqual(preview.created);
      expect(await prisma.grade.count()).toBe(14);
      expect(await prisma.subjectArea.count()).toBe(11);
      // Lo existente no se modificó: el grado 6 sigue en su nivel original.
      const sixth = await prisma.grade.findFirstOrThrow({
        where: { code: '6' },
        include: { educationLevel: true },
      });
      expect(sixth.educationLevel.code).toBe('SEC');
      expect(sixth.educationLevel.name).toBe('Secundaria');
      const transition = await prisma.grade.findFirstOrThrow({
        where: { code: 'T' },
        include: { educationLevel: true },
      });
      expect(transition.educationLevel.name).toBe('Preescolar');
      const ninth = await prisma.grade.findFirstOrThrow({
        where: { code: '9' },
        include: { educationLevel: true },
      });
      expect(ninth.educationLevel.code).toBe('SEC');
      expect(await prisma.auditLog.count({ where: { action: 'academics.template.applied' } })).toBe(
        1,
      );

      const again = await ok(api().post('/academic-templates/colombia', {}), 200);
      expect(Object.values(again.created).flat()).toHaveLength(0);
      expect(await prisma.grade.count()).toBe(14);
    });

    it('solo la aplica quien gestiona la estructura académica', async () => {
      expect((await api(coordinator).post('/academic-templates/colombia', {})).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Plan de estudios', () => {
    it('lista el plan, no duplica asignaturas y valida la intensidad horaria', async () => {
      const plan = await ok(api().get(`/curriculum?academicYearId=${s.year}&gradeId=${s.g6}`), 200);
      expect(
        plan.map((p: { subject: { name: string }; weeklyHours: number }) => [
          p.subject.name,
          p.weeklyHours,
        ]),
      ).toEqual([
        ['Lengua castellana', 4],
        ['Matemáticas', 5],
      ]);
      const dup = await api().post('/curriculum', {
        academicYearId: s.year,
        gradeId: s.g6,
        subjectId: s.mat,
        weeklyHours: 3,
      });
      expect(dup.body.error.code).toBe('CURRICULUM_SUBJECT_EXISTS');
      for (const weeklyHours of [0, 41, 2.5]) {
        expect(
          (
            await api().post('/curriculum', {
              academicYearId: s.year,
              gradeId: s.g7,
              subjectId: s.esp,
              weeklyHours,
            })
          ).status,
        ).toBe(400);
      }
      const updated = await ok(api().patch(`/curriculum/${plan[0].id}`, { weeklyHours: 6 }), 200);
      expect(updated.weeklyHours).toBe(6);
    });

    it('la base de datos rechaza intensidades fuera de rango', async () => {
      const db = await connectAsApp();
      try {
        const state = await sqlStateOf(db.query(`UPDATE curriculum_subject SET weekly_hours = 0`));
        expect(state).toBe(SQLSTATE.CHECK_VIOLATION);
      } finally {
        await db.end();
      }
    });

    it('copia el plan a otro año sin duplicar', async () => {
      const first = await ok(
        api().post('/curriculum/copy', {
          fromAcademicYearId: s.year,
          toAcademicYearId: s.nextYear,
        }),
        200,
      );
      expect(first).toEqual({ created: 3, skipped: 0 });
      const second = await ok(
        api().post('/curriculum/copy', {
          fromAcademicYearId: s.year,
          toAcademicYearId: s.nextYear,
        }),
        200,
      );
      expect(second).toEqual({ created: 0, skipped: 3 });
      expect(await prisma.curriculumSubject.count({ where: { academicYearId: s.nextYear } })).toBe(
        3,
      );
    });

    it('una asignatura con docente asignado no sale del plan; sin asignaciones, sí', async () => {
      const plan = await ok(api().get(`/curriculum?academicYearId=${s.year}&gradeId=${s.g6}`), 200);
      const matEntry = plan.find((p: { subject: { id: string } }) => p.subject.id === s.mat);
      const espEntry = plan.find((p: { subject: { id: string } }) => p.subject.id === s.esp);
      await ok(assign(s.group601, s.mat, s.teacherA));
      expect((await api().delete(`/curriculum/${matEntry.id}`)).body.error.code).toBe(
        'CURRICULUM_SUBJECT_IN_USE',
      );
      expect((await api().delete(`/curriculum/${espEntry.id}`)).status).toBe(204);
    });

    it('un año cerrado no admite cambios en el plan', async () => {
      await ok(api().post(`/academic-years/${s.year}/close`), 200);
      const res = await api().post('/curriculum', {
        academicYearId: s.year,
        gradeId: s.g7,
        subjectId: s.esp,
        weeklyHours: 4,
      });
      expect(res.body.error.code).toBe('ACADEMIC_YEAR_CLOSED');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Asignación docente', () => {
    it('asigna un docente activo a una asignatura del plan, con auditoría', async () => {
      const a = await ok(assign(s.group601, s.mat, s.teacherA));
      expect(a).toMatchObject({
        group: { code: '601', gradeName: 'Sexto' },
        subject: { name: 'Matemáticas' },
        teacher: { id: s.teacherA, firstNames: 'Ana' },
        // Hoy (2026) es antes del inicio del año: la asignación empieza con el año.
        fromDate: '2027-01-25',
        toDate: null,
        current: true,
      });
      expect(
        await prisma.auditLog.count({ where: { action: 'teaching.assignment.created' } }),
      ).toBe(1);
    });

    it('rechaza personal que no es docente, docentes inactivos y asignaturas fuera del plan', async () => {
      expect((await assign(s.group601, s.mat, s.clerk)).body.error.code).toBe('STAFF_NOT_TEACHER');
      await ok(api().patch(`/staff/${s.teacherB}`, { status: 'INACTIVE' }), 200);
      expect((await assign(s.group601, s.mat, s.teacherB)).body.error.code).toBe(
        'INACTIVE_REFERENCE',
      );
      // Lengua castellana no está en el plan de séptimo.
      expect((await assign(s.group701, s.esp, s.teacherA)).body.error.code).toBe(
        'SUBJECT_NOT_IN_CURRICULUM',
      );
      expect((await assign(s.group601, s.mat, s.teacherA, { fromDate: '2026-12-01' })).status).toBe(
        400,
      );
    });

    it('una asignatura de un grupo tiene un único docente vigente, incluso con solicitudes simultáneas', async () => {
      const results = await Promise.all([
        assign(s.group601, s.mat, s.teacherA),
        assign(s.group601, s.mat, s.teacherB),
        assign(s.group601, s.mat, s.teacherA),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(
        results
          .filter((r) => r.status === 409)
          .every((r) => r.body.error.code === 'SUBJECT_ALREADY_ASSIGNED'),
      ).toBe(true);
      expect(
        await prisma.teachingAssignment.count({
          where: { schoolGroupId: s.group601, toDate: null },
        }),
      ).toBe(1);
    });

    it('la base de datos impide dos docentes vigentes para la misma asignatura del grupo', async () => {
      const a = await ok(assign(s.group601, s.mat, s.teacherA));
      const db = await connectAsApp();
      try {
        const state = await sqlStateOf(
          db.query(
            `INSERT INTO teaching_assignment (id, institution_id, school_group_id, subject_id, staff_member_id, from_date, updated_at)
             SELECT gen_random_uuid(), institution_id, school_group_id, subject_id, $2, from_date, now()
             FROM teaching_assignment WHERE id = $1`,
            [a.id, s.teacherB],
          ),
        );
        expect(state).toBe(SQLSTATE.UNIQUE_VIOLATION);
      } finally {
        await db.end();
      }
    });

    it('el reemplazo conserva el historial; el mismo día es una corrección', async () => {
      const a = await ok(assign(s.group601, s.mat, s.teacherA));
      // Corrección: misma fecha de inicio → no crea historial.
      const corrected = await ok(
        api().post(`/teaching-assignments/${a.id}/replace`, {
          staffMemberId: s.teacherB,
          effectiveDate: '2027-01-25',
        }),
        200,
      );
      expect(corrected).toMatchObject({ id: a.id, teacher: { id: s.teacherB } });

      const replaced = await ok(
        api().post(`/teaching-assignments/${a.id}/replace`, {
          staffMemberId: s.teacherA,
          effectiveDate: '2027-06-01',
        }),
        200,
      );
      expect(replaced).toMatchObject({
        teacher: { id: s.teacherA },
        fromDate: '2027-06-01',
        current: true,
      });
      const history = await ok(
        api().get(`/teaching-assignments?schoolGroupId=${s.group601}&includeEnded=true`),
        200,
      );
      expect(
        history.map((h: { teacher: { id: string }; fromDate: string; toDate: string | null }) => [
          h.teacher.id,
          h.fromDate,
          h.toDate,
        ]),
      ).toEqual([
        [s.teacherB, '2027-01-25', '2027-06-01'],
        [s.teacherA, '2027-06-01', null],
      ]);
      expect(
        (await ok(api().get(`/teaching-assignments?schoolGroupId=${s.group601}`), 200)).length,
      ).toBe(1);

      expect(
        (await api().post(`/teaching-assignments/${a.id}/replace`, { staffMemberId: s.teacherB }))
          .body.error.code,
      ).toBe('ASSIGNMENT_ENDED');
      expect(
        (
          await api().post(`/teaching-assignments/${replaced.id}/replace`, {
            staffMemberId: s.teacherA,
          })
        ).body.error.code,
      ).toBe('SAME_TEACHER');
      expect(
        (
          await api().post(`/teaching-assignments/${replaced.id}/replace`, {
            staffMemberId: s.teacherB,
            effectiveDate: '2027-05-01',
          })
        ).status,
      ).toBe(400);
    });

    it('finaliza una asignación y permite asignar de nuevo la asignatura', async () => {
      const a = await ok(assign(s.group601, s.mat, s.teacherA));
      const ended = await ok(
        api().post(`/teaching-assignments/${a.id}/end`, { date: '2027-03-01' }),
        200,
      );
      expect(ended).toMatchObject({ toDate: '2027-03-01', current: false });
      expect((await assign(s.group601, s.mat, s.teacherB, { fromDate: '2027-03-01' })).status).toBe(
        201,
      );
    });

    it('un docente con asignaturas vigentes no se desactiva ni deja de ser docente; un grupo con docentes no se desactiva', async () => {
      const a = await ok(assign(s.group601, s.mat, s.teacherA));
      expect(
        (await api().patch(`/staff/${s.teacherA}`, { status: 'INACTIVE' })).body.error.code,
      ).toBe('STAFF_HAS_ASSIGNMENTS');
      expect(
        (await api().patch(`/staff/${s.teacherA}`, { staffType: 'DIRECTIVE' })).body.error.code,
      ).toBe('STAFF_HAS_ASSIGNMENTS');
      expect(
        (await api().patch(`/school-groups/${s.group601}`, { status: 'INACTIVE' })).body.error.code,
      ).toBe('GROUP_HAS_ASSIGNMENTS');

      await ok(api().post(`/teaching-assignments/${a.id}/end`, {}), 200);
      expect((await api().patch(`/staff/${s.teacherA}`, { status: 'INACTIVE' })).status).toBe(200);
      expect(
        (await api().patch(`/school-groups/${s.group601}`, { status: 'INACTIVE' })).status,
      ).toBe(200);
    });

    it('el coordinador consulta la asignación pero no la modifica', async () => {
      await ok(assign(s.group601, s.mat, s.teacherA));
      expect((await ok(api(coordinator).get('/teaching-assignments'), 200)).length).toBe(1);
      expect(
        (
          await api(coordinator).post('/teaching-assignments', {
            schoolGroupId: s.group602,
            subjectId: s.mat,
            staffMemberId: s.teacherA,
          })
        ).status,
      ).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Alcance ASSIGNED del docente', () => {
    it('el docente solo ve los estudiantes, matrículas y asignaciones de sus grupos', async () => {
      const mine = await placedStudent('Mía', s.g6, s.group601);
      const other = await placedStudent('Otro', s.g6, s.group602);
      const own = await ok(assign(s.group601, s.mat, s.teacherA));
      const foreign = await ok(assign(s.group602, s.mat, s.teacherB));

      const teacher = api(teacherToken);
      const students = await ok(teacher.get('/students'), 200);
      expect(students.data.map((x: { id: string }) => x.id)).toEqual([mine.id]);
      expect((await teacher.get(`/students/${mine.id}`)).status).toBe(200);
      // Un id manipulado de un estudiante ajeno se trata como inexistente.
      expect((await teacher.get(`/students/${other.id}`)).status).toBe(404);

      const enrollments = await ok(teacher.get('/enrollments'), 200);
      expect(enrollments.data.map((e: { student: { id: string } }) => e.student.id)).toEqual([
        mine.id,
      ]);
      // Pedir explícitamente el grupo ajeno no amplía el alcance.
      expect(
        (await ok(teacher.get(`/enrollments?schoolGroupId=${s.group602}`), 200)).data,
      ).toHaveLength(0);
      const otherEnrollment = await prisma.enrollment.findFirstOrThrow({
        where: { studentId: other.id },
      });
      expect((await teacher.get(`/enrollments/${otherEnrollment.id}`)).status).toBe(404);

      const assignments = await ok(teacher.get('/teaching-assignments'), 200);
      expect(assignments.map((x: { id: string }) => x.id)).toEqual([own.id]);
      expect(
        await ok(teacher.get(`/teaching-assignments?staffMemberId=${s.teacherB}`), 200),
      ).toEqual([]);
      expect((await teacher.get(`/teaching-assignments/${foreign.id}`)).status).toBe(404);
      expect((await teacher.get(`/teaching-assignments/${foreign.id}/students`)).status).toBe(404);

      const roster = await ok(teacher.get(`/teaching-assignments/${own.id}/students`), 200);
      expect(
        roster.students.map((x: { studentId: string; firstNames: string }) => [
          x.studentId,
          x.firstNames,
        ]),
      ).toEqual([[mine.id, 'Mía']]);
    });

    it('al finalizar la asignación, el docente deja de ver a esos estudiantes', async () => {
      const mine = await placedStudent('Mía', s.g6, s.group601);
      const own = await ok(assign(s.group601, s.mat, s.teacherA));
      expect((await api(teacherToken).get(`/students/${mine.id}`)).status).toBe(200);
      await ok(api().post(`/teaching-assignments/${own.id}/end`, {}), 200);
      expect((await api(teacherToken).get(`/students/${mine.id}`)).status).toBe(404);
      expect((await ok(api(teacherToken).get('/students'), 200)).data).toHaveLength(0);
    });

    it('un estudiante retirado sale de la lista del docente', async () => {
      const mine = await placedStudent('Mía', s.g6, s.group601);
      const own = await ok(assign(s.group601, s.mat, s.teacherA));
      const enrollment = await prisma.enrollment.findFirstOrThrow({
        where: { studentId: mine.id },
      });
      await ok(
        api().post(`/enrollments/${enrollment.id}/withdraw`, {
          date: '2027-04-01',
          reason: 'OTHER',
        }),
        200,
      );
      expect(
        (await ok(api(teacherToken).get(`/teaching-assignments/${own.id}/students`), 200)).students,
      ).toHaveLength(0);
      expect((await api(teacherToken).get(`/students/${mine.id}`)).status).toBe(404);
    });

    it('el docente no gestiona estudiantes, matrículas ni asignaciones', async () => {
      const mine = await placedStudent('Mía', s.g6, s.group601);
      await ok(assign(s.group601, s.mat, s.teacherA));
      const teacher = api(teacherToken);
      expect((await teacher.patch(`/students/${mine.id}`, { code: 'X1' })).status).toBe(403);
      expect(
        (
          await teacher.post('/teaching-assignments', {
            schoolGroupId: s.group602,
            subjectId: s.mat,
            staffMemberId: s.teacherA,
          })
        ).status,
      ).toBe(403);
      expect((await teacher.post('/enrollments/renewals', {})).status).toBe(403);
      expect((await teacher.get('/staff')).status).toBe(403);
    });

    it('un usuario con rol Docente sin perfil de personal no ve a nadie', async () => {
      await placedStudent('Mía', s.g6, s.group601);
      await ok(assign(s.group601, s.mat, s.teacherA));
      await seedMember(app, {
        institutionId,
        email: 'sinperfil@prueba.edu.co',
        password: PASSWORD,
        roleCode: SYSTEM_ROLES.TEACHER,
      });
      const token = await loginAs(app, 'sinperfil@prueba.edu.co', PASSWORD);
      expect((await ok(api(token).get('/students'), 200)).data).toHaveLength(0);
      expect(await ok(api(token).get('/teaching-assignments'), 200)).toEqual([]);
    });
  });
});

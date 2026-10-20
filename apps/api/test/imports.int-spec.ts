import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';
import { xlsx } from './setup/xlsx';

const PASSWORD = 'una frase de acceso bastante larga';

const HEADER = [
  'Tipo documento',
  'Número documento',
  'Nombres',
  'Apellidos',
  'Fecha nacimiento',
  'Código',
  'Acudiente tipo documento',
  'Acudiente número documento',
  'Acudiente nombres',
  'Acudiente apellidos',
  'Acudiente parentesco',
  'Acudiente representante legal',
  'Año',
  'Grado',
  'Grupo',
];

/** Fila de ejemplo con datos válidos; `over` reemplaza columnas por posición de HEADER. */
function row(over: Partial<Record<(typeof HEADER)[number], string>> = {}): string[] {
  const base: Record<string, string> = {
    'Tipo documento': 'TI',
    'Número documento': '1100000001',
    Nombres: 'Sofía',
    Apellidos: 'Martínez',
    'Fecha nacimiento': '09/03/2015',
    Código: '',
    'Acudiente tipo documento': 'CC',
    'Acudiente número documento': '52000001',
    'Acudiente nombres': 'Laura',
    'Acudiente apellidos': 'López',
    'Acudiente parentesco': 'Madre',
    'Acudiente representante legal': 'Sí',
    Año: '2027',
    Grado: '6',
    Grupo: '601',
  };
  return HEADER.map((h) => over[h] ?? base[h]!);
}

const csv = (rows: string[][], header = HEADER) =>
  Buffer.from(
    [header, ...rows]
      .map((r) => r.map((c) => (c.includes(';') ? `"${c}"` : c)).join(';'))
      .join('\r\n'),
    'utf8',
  );

describe('Importación masiva de estudiantes (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokens: Record<'admin' | 'secretary' | 'coordinator', string>;

  const http = () => request(app.getHttpServer());
  const upload = (
    url: string,
    content: Buffer,
    filename = 'estudiantes.csv',
    token = tokens.secretary,
  ) =>
    http()
      .post(`/api/v1/imports/students${url}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', content, { filename, contentType: 'text/csv' });
  const api = (token = tokens.admin) => ({
    post: (url: string, body: object) =>
      http().post(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  async function ok(res: request.Response | Promise<request.Response>, status = 201) {
    const r = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
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
    const institutionId = (await seedInstitution(app)).id;
    const roles = {
      admin: SYSTEM_ROLES.INSTITUTION_ADMIN,
      secretary: SYSTEM_ROLES.SECRETARY,
      coordinator: SYSTEM_ROLES.COORDINATOR,
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
    await ok(
      api().post('/grades', {
        code: '7',
        name: 'Séptimo',
        educationLevelId: level.id,
        sortOrder: 7,
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
      api().post('/school-groups', {
        academicYearId: year.id,
        gradeId: g6.id,
        campusId: campus.id,
        shiftId: shift.id,
        code: '601',
        name: 'Grupo 601',
        capacity: 2,
      }),
    );
  });

  it('entrega la plantilla CSV con todas las columnas', async () => {
    const res = await http()
      .get('/api/v1/imports/students/template')
      .set('Authorization', `Bearer ${tokens.secretary}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('plantilla-estudiantes.csv');
    expect(res.text).toContain('tipo_documento;numero_documento;nombres;apellidos');
  });

  it('valida todo el archivo y explica cada error por fila y columna, sin guardar nada', async () => {
    await ok(
      api().post('/students', {
        person: {
          documentType: 'TI',
          documentNumber: '1100000009',
          firstNames: 'Ya',
          lastNames: 'Existe',
        },
      }),
    );
    await ok(
      api().post('/staff', {
        person: {
          documentType: 'CC',
          documentNumber: '52999999',
          firstNames: 'Marta',
          lastNames: 'Docente',
        },
        staffType: 'TEACHER',
      }),
    );
    const before = await prisma.person.count();

    const file = csv([
      row(), // 2: válida
      row({ 'Número documento': '1100000002', Nombres: 'Tomás' }), // 3: hermano, mismo acudiente
      row({ 'Tipo documento': 'XX', 'Número documento': '1100000003' }), // 4: tipo inválido
      row({ 'Número documento': '1100000001', Nombres: 'Repetida' }), // 5: repetida en el archivo
      row({ 'Número documento': '1100000009', Nombres: 'Ya', Apellidos: 'Existe' }), // 6: ya es estudiante
      row({
        'Número documento': '1100000004',
        'Acudiente número documento': '52999999',
        'Acudiente nombres': 'Otra',
      }), // 7: acudiente con otro nombre
      row({ 'Número documento': '1100000005', Grado: '9' }), // 8: grado inexistente
      row({
        'Número documento': '1100000006',
        'Fecha nacimiento': '31/02/2015',
        'Acudiente parentesco': 'Vecino',
      }), // 9: fecha y parentesco
      row({ 'Número documento': '1100000007' }), // 10: el grupo 601 ya se llenó con las filas 2 y 3 (cupo 2)
      row({
        'Número documento': '1100000008',
        'Acudiente número documento': '52000001',
        'Acudiente nombres': 'Lorena',
      }), // 11: mismo acudiente con otro nombre en el archivo
    ]);
    const report = await ok(upload('/validate', file), 200);
    expect(report.totals).toMatchObject({ rows: 10, valid: 2, invalid: 8 });
    const byRow = Object.fromEntries(report.rows.map((r: { row: number }) => [r.row, r]));
    expect(byRow[2]).toMatchObject({
      status: 'VALID',
      actions: [
        'Crear estudiante',
        'Crear y vincular acudiente (Laura López)',
        'Matricular en Sexto 2027 – grupo 601',
      ],
    });
    expect(byRow[3].actions[1]).toBe('Vincular acudiente existente (Laura López)');
    const errorOf = (n: number) =>
      byRow[n].errors.map((e: { column: string; message: string }) => `${e.column}: ${e.message}`);
    expect(errorOf(4)).toEqual([
      expect.stringMatching(/^tipo_documento: Tipo de documento no válido/),
    ]);
    expect(errorOf(5)).toEqual(
      expect.arrayContaining(['numero_documento: El estudiante ya aparece en la fila 2.']),
    );
    expect(errorOf(6)).toEqual(
      expect.arrayContaining(['numero_documento: Ya está registrado como estudiante.']),
    );
    expect(errorOf(7)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^acudiente_nombres: El documento del acudiente ya existe con otro nombre \(Marta Docente\)/,
        ),
      ]),
    );
    expect(errorOf(8)).toEqual(['grado: No existe un grado con el código 9.']);
    expect(errorOf(9)).toEqual([
      'fecha_nacimiento: Fecha no válida. Usa DD/MM/AAAA o AAAA-MM-DD.',
      expect.stringMatching(/^acudiente_parentesco: Parentesco no válido/),
    ]);
    expect(errorOf(10)).toEqual(['grupo: El grupo 601 ya no tiene cupo (2).']);
    expect(errorOf(11)).toEqual(
      expect.arrayContaining([
        'acudiente_nombres: El acudiente aparece en la fila 2 con otro nombre.',
      ]),
    );

    expect(await prisma.person.count()).toBe(before);

    // Importar el mismo archivo no guarda nada y devuelve el informe.
    const rejected = await upload('', file);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe('IMPORT_HAS_ERRORS');
    expect(rejected.body.error.details.report.totals.invalid).toBe(8);
    expect(await prisma.person.count()).toBe(before);
  });

  it('importa todo en una transacción: estudiantes, acudientes compartidos y matrículas', async () => {
    // La acudiente ya es docente: se reutiliza su persona.
    await ok(
      api().post('/staff', {
        person: {
          documentType: 'CC',
          documentNumber: '52000001',
          firstNames: 'Laura',
          lastNames: 'López',
        },
        staffType: 'TEACHER',
      }),
    );
    const file = csv([
      row({ Código: 'E-001' }),
      row({ 'Número documento': '1100000002', Nombres: 'Tomás', Código: 'E-002' }),
      row({
        'Número documento': '1100000003',
        Nombres: 'Valentina',
        'Acudiente número documento': '79000001',
        'Acudiente nombres': 'Jorge',
        'Acudiente apellidos': 'Ruiz',
        'Acudiente parentesco': 'Padre',
        'Acudiente representante legal': 'No',
        Grado: '7',
        Grupo: '',
      }),
    ]);
    const result = await ok(upload('', file));
    expect(result.imported).toBe(true);
    expect(result.report.totals).toMatchObject({
      rows: 3,
      valid: 3,
      invalid: 0,
      newPersons: 3,
      guardians: 3,
      enrollments: 3,
    });

    const students = await prisma.student.findMany({
      include: { person: true, guardians: { include: { guardian: true } } },
      orderBy: { code: 'asc' },
    });
    expect(students.map((s) => [s.code, s.person.firstNames])).toEqual([
      ['E-001', 'Sofía'],
      ['E-002', 'Tomás'],
      [null, 'Valentina'],
    ]);
    // Los hermanos comparten acudiente: una sola persona (la docente) con perfil de acudiente.
    expect(await prisma.person.count({ where: { documentNumber: '52000001' } })).toBe(1);
    expect(students[0]!.guardians[0]!.guardianId).toBe(students[1]!.guardians[0]!.guardianId);
    expect(students[0]!.guardians[0]).toMatchObject({
      relationship: 'MOTHER',
      isPrimary: true,
      isLegalRepresentative: true,
    });
    expect(students[2]!.guardians[0]).toMatchObject({
      relationship: 'FATHER',
      isLegalRepresentative: false,
    });
    expect(students[0]!.person.birthDate?.toISOString().slice(0, 10)).toBe('2015-03-09');

    const placed = await prisma.groupPlacement.count({
      where: { toDate: null, schoolGroup: { code: '601' } },
    });
    expect(placed).toBe(2);
    expect(await prisma.enrollment.count({ where: { status: 'ACTIVE' } })).toBe(3);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'imports.students.completed' },
    });
    expect(audit.metadata).toMatchObject({
      fileName: 'estudiantes.csv',
      format: 'CSV',
      totals: { valid: 3 },
    });
  });

  it('importa desde Excel (.xlsx), con documentos y años como números', async () => {
    const book = xlsx([
      ['tipo_documento', 'numero_documento', 'nombres', 'apellidos', 'anio', 'grado'],
      ['TI', 1100000001, 'Sofía', 'Martínez', 2027, 6],
    ]);
    const result = await ok(upload('', book, 'estudiantes.xlsx'));
    expect(result.report).toMatchObject({ format: 'XLSX', totals: { valid: 1, enrollments: 1 } });
    const person = await prisma.person.findFirstOrThrow({ where: { firstNames: 'Sofía' } });
    expect(person.documentNumber).toBe('1100000001');
  });

  it('es todo o nada: dos importaciones simultáneas del mismo archivo no duplican nada', async () => {
    const file = csv([row(), row({ 'Número documento': '1100000002', Nombres: 'Tomás' })]);
    const results = await Promise.all([upload('', file), upload('', file)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    // La segunda falla al validar (422) o al importar (409, IMPORT_ROW_FAILED) según el orden.
    expect([409, 422]).toContain(statuses[1]);
    expect(await prisma.student.count()).toBe(2);
    expect(await prisma.enrollment.count()).toBe(2);
  });

  it('rechaza archivos sin las columnas obligatorias y usuarios sin permisos', async () => {
    const res = await upload('/validate', csv([['Ana']], ['nombres']));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'IMPORT_COLUMNS_INVALID',
      details: { missing: ['tipo_documento', 'numero_documento', 'apellidos'] },
    });
    expect((await upload('/validate', csv([row()]), 'x.csv', tokens.coordinator)).status).toBe(403);
    const noFile = await http()
      .post('/api/v1/imports/students/validate')
      .set('Authorization', `Bearer ${tokens.secretary}`);
    expect(noFile.body.error.code).toBe('FILE_REQUIRED');
  });
});

import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { type Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { type GuardianRelationship, type PersonInputDto } from '../people/dto/people.dto';
import { sameName } from '../people/person-resolver';
import { StudentsService } from '../people/students.service';
import {
  type CellError,
  type ColumnKey,
  headerOf,
  mapColumns,
  parseDate,
  parseDocumentType,
  parseRelationship,
  parseYesNo,
  STUDENT_IMPORT_COLUMNS,
  validatePerson,
} from './student-import.columns';
import { readTabularFile, type TabularData } from './tabular-file';

type Tx = Prisma.TransactionClient;

export const ImportErrors = {
  columns: (problems: { missing: string[]; duplicated: string[] }) =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'IMPORT_COLUMNS_INVALID',
      problems.missing.length > 0
        ? `Faltan columnas obligatorias: ${problems.missing.join(', ')}. Descarga la plantilla.`
        : `Hay columnas repetidas: ${problems.duplicated.join(', ')}.`,
      problems,
    ),
  hasErrors: (report: ImportReport) =>
    new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'IMPORT_HAS_ERRORS',
      `El archivo tiene ${report.totals.invalid} fila(s) con errores. No se importó nada; corrígelas y vuelve a intentarlo.`,
      { report },
    ),
  rowFailed: (row: number, cause: AppException) =>
    new AppException(
      HttpStatus.CONFLICT,
      'IMPORT_ROW_FAILED',
      `La fila ${row} no se pudo importar: ${cause.message} No se importó nada.`,
      { row, code: cause.code },
    ),
};

interface ParsedRow {
  number: number;
  student: PersonInputDto;
  code: string | null;
  guardian: {
    person: PersonInputDto;
    relationship: GuardianRelationship;
    legalRepresentative: boolean;
  } | null;
  enrollment: {
    year: number;
    grade: string;
    group: string | null;
    campus: string | null;
    enrolledOn: string | null;
  } | null;
}

interface PlannedRow extends ParsedRow {
  /** Ids resueltos para la matrícula. */
  enrollmentTarget: {
    academicYearId: string;
    gradeId: string;
    schoolGroupId: string | null;
  } | null;
}

export interface RowReport {
  row: number;
  status: 'VALID' | 'INVALID';
  student: string;
  errors: CellError[];
  actions: string[];
}

export interface ImportReport {
  fileName: string;
  format: TabularData['format'];
  sha256: string;
  totals: {
    rows: number;
    valid: number;
    invalid: number;
    newPersons: number;
    reusedPersons: number;
    guardians: number;
    enrollments: number;
  };
  /** Columnas del archivo que no se reconocen (se ignoran). */
  ignoredColumns: string[];
  rows: RowReport[];
}

export interface ImportResult {
  imported: true;
  report: ImportReport;
}

const docKey = (type: string, number: string) => `${type}:${number.toUpperCase()}`;

/**
 * Importación masiva de estudiantes (con su acudiente principal y, si se
 * indica, su matrícula) desde CSV o XLSX.
 *
 * 1. Validar: revisa TODO el archivo y devuelve un informe fila por fila, sin
 *    guardar nada.
 * 2. Importar: vuelve a validar y, solo si no hay errores, crea todo en una
 *    única transacción. Si una fila falla, no se guarda ninguna (todo o nada).
 *
 * Usa los mismos servicios que el registro manual, así que aplica las mismas
 * reglas (personas reutilizadas, acudiente principal, cupo de los grupos…).
 */
@Injectable()
export class StudentImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  /** Plantilla CSV (separada por punto y coma, como la abre Excel en español). */
  template(): string {
    const header = STUDENT_IMPORT_COLUMNS.map((c) => c.header).join(';');
    const example = STUDENT_IMPORT_COLUMNS.map((c) => c.example).join(';');
    return `\uFEFF${header}\r\n${example}\r\n`;
  }

  async validate(auth: AuthContext, buffer: Buffer, fileName: string): Promise<ImportReport> {
    return (await this.plan(auth, buffer, fileName)).report;
  }

  async import(
    auth: AuthContext,
    buffer: Buffer,
    fileName: string,
    client: ClientInfo,
  ): Promise<ImportResult> {
    const { report, rows } = await this.plan(auth, buffer, fileName);
    if (report.totals.invalid > 0) throw ImportErrors.hasErrors(report);

    await this.prisma.$transaction(
      async (tx) => {
        for (const row of rows) await this.importRow(auth, row, client, tx);
        await this.audit.record(
          {
            institutionId: auth.institutionId,
            actorUserId: auth.userId,
            action: 'imports.students.completed',
            entityType: 'institution',
            entityId: auth.institutionId,
            metadata: {
              fileName: report.fileName,
              format: report.format,
              sha256: report.sha256,
              totals: report.totals,
            },
            context: client,
          },
          tx,
        );
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    return { imported: true, report };
  }

  private async importRow(auth: AuthContext, row: PlannedRow, client: ClientInfo, tx: Tx) {
    try {
      const studentId = await this.students.createWithin(
        auth,
        { person: row.student, code: row.code ?? undefined },
        client,
        tx,
      );
      if (row.guardian) {
        await this.students.linkGuardianWithin(
          auth,
          studentId,
          {
            person: row.guardian.person,
            relationship: row.guardian.relationship,
            isLegalRepresentative: row.guardian.legalRepresentative,
          },
          client,
          tx,
        );
      }
      if (row.enrollmentTarget) {
        await this.enrollments.createWithin(
          auth,
          {
            studentId,
            academicYearId: row.enrollmentTarget.academicYearId,
            gradeId: row.enrollmentTarget.gradeId,
            schoolGroupId: row.enrollmentTarget.schoolGroupId ?? undefined,
            enrolledOn: row.enrollment?.enrolledOn ?? undefined,
            status: 'ACTIVE',
          },
          client,
          tx,
        );
      }
    } catch (error) {
      if (error instanceof AppException) throw ImportErrors.rowFailed(row.number, error);
      throw error;
    }
  }

  // --- Validación -----------------------------------------------------------

  private async plan(auth: AuthContext, buffer: Buffer, fileName: string) {
    const table = await readTabularFile(buffer);
    const mapping = mapColumns(table.headers);
    if (mapping.missing.length > 0 || mapping.duplicated.length > 0) {
      throw ImportErrors.columns(mapping);
    }
    const cell = (cells: string[], key: ColumnKey) => {
      const index = mapping.positions[key];
      return index === undefined ? '' : (cells[index] ?? '').trim();
    };

    // 1. Formato de cada fila, sin consultar la base.
    const parsed = table.rows.map((r) => this.parseRow(r.number, (key) => cell(r.cells, key)));

    // 2. Contexto de la institución, consultado una sola vez.
    const context = await this.loadContext(auth, parsed);

    // 3. Reglas que dependen de la base y de las demás filas del archivo.
    const seenStudents = new Map<string, number>();
    const seenCodes = new Map<string, number>();
    const guardianNames = new Map<string, { first: string; last: string; row: number }>();
    const plannedSeats = new Map<string, number>();
    const rows: RowReport[] = [];
    const planned: PlannedRow[] = [];
    let newPersons = 0;
    let reusedPersons = 0;
    let guardians = 0;
    let enrollments = 0;

    for (const { number, row, errors } of parsed) {
      const actions: string[] = [];
      const label = row?.student
        ? `${row.student.firstNames} ${row.student.lastNames} (${row.student.documentType} ${row.student.documentNumber})`
        : '—';
      let target: PlannedRow['enrollmentTarget'] = null;

      if (row) {
        const add = (key: ColumnKey, message: string) =>
          errors.push({ column: headerOf(key), message });
        const sKey = docKey(row.student.documentType, row.student.documentNumber);

        // Estudiante
        const previous = seenStudents.get(sKey);
        if (previous) add('documentNumber', `El estudiante ya aparece en la fila ${previous}.`);
        else seenStudents.set(sKey, row.number);
        const existing = context.persons.get(sKey);
        if (existing?.student) {
          add('documentNumber', 'Ya está registrado como estudiante.');
        } else if (existing && !this.namesMatch(existing, row.student)) {
          add(
            'firstNames',
            `El documento ya existe en la institución con otro nombre (${existing.firstNames} ${existing.lastNames}).`,
          );
        } else if (existing) {
          actions.push('Registrar como estudiante a una persona ya existente');
        } else {
          actions.push('Crear estudiante');
        }
        if (row.code) {
          const codeKey = row.code.toUpperCase();
          if (context.codes.has(codeKey)) add('code', 'Ya existe un estudiante con ese código.');
          else if (seenCodes.has(codeKey))
            add('code', `El código se repite en la fila ${seenCodes.get(codeKey)}.`);
          else seenCodes.set(codeKey, row.number);
        }

        // Acudiente
        if (row.guardian) {
          const g = row.guardian.person;
          const gKey = docKey(g.documentType, g.documentNumber);
          if (gKey === sKey)
            add('guardianDocumentNumber', 'El estudiante no puede ser su propio acudiente.');
          const existingGuardian = context.persons.get(gKey);
          const inFile = guardianNames.get(gKey);
          if (existingGuardian && !this.namesMatch(existingGuardian, g)) {
            add(
              'guardianFirstNames',
              `El documento del acudiente ya existe con otro nombre (${existingGuardian.firstNames} ${existingGuardian.lastNames}).`,
            );
          } else if (
            inFile &&
            !(sameName(inFile.first, g.firstNames) && sameName(inFile.last, g.lastNames))
          ) {
            add(
              'guardianFirstNames',
              `El acudiente aparece en la fila ${inFile.row} con otro nombre.`,
            );
          } else {
            if (!inFile)
              guardianNames.set(gKey, { first: g.firstNames, last: g.lastNames, row: row.number });
            actions.push(
              existingGuardian || inFile
                ? `Vincular acudiente existente (${g.firstNames} ${g.lastNames})`
                : `Crear y vincular acudiente (${g.firstNames} ${g.lastNames})`,
            );
          }
        }

        // Matrícula
        if (row.enrollment) {
          // Solo una fila sin otros errores aparta cupo en el grupo.
          target = this.resolveEnrollment(
            row,
            context,
            plannedSeats,
            add,
            actions,
            errors.length === 0,
          );
        }
      }

      const valid = errors.length === 0 && row !== null;
      rows.push({
        row: number,
        status: valid ? 'VALID' : 'INVALID',
        student: label,
        errors,
        actions: valid ? actions : [],
      });
      if (valid) {
        planned.push({ ...row, enrollmentTarget: target });
        const sKey = docKey(row.student.documentType, row.student.documentNumber);
        if (context.persons.has(sKey)) reusedPersons++;
        else newPersons++;
        if (row.guardian) guardians++;
        if (target) enrollments++;
      }
    }

    const report: ImportReport = {
      fileName,
      format: table.format,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      totals: {
        rows: rows.length,
        valid: planned.length,
        invalid: rows.length - planned.length,
        newPersons,
        reusedPersons,
        guardians,
        enrollments,
      },
      ignoredColumns: mapping.unknown,
      rows,
    };
    return { report, rows: planned };
  }

  private namesMatch(
    existing: { firstNames: string; lastNames: string },
    input: { firstNames: string; lastNames: string },
  ) {
    return (
      sameName(existing.firstNames, input.firstNames) &&
      sameName(existing.lastNames, input.lastNames)
    );
  }

  /** Interpreta una fila: tipos de dato y campos obligatorios. */
  private parseRow(
    number: number,
    get: (key: ColumnKey) => string,
  ): { number: number; row: ParsedRow | null; errors: CellError[] } {
    const errors: CellError[] = [];
    const add = (key: ColumnKey, message: string) =>
      errors.push({ column: headerOf(key), message });
    const optional = (key: ColumnKey) => get(key) || null;
    const date = (key: ColumnKey) => {
      const raw = get(key);
      if (!raw) return null;
      const parsed = parseDate(raw);
      if (!parsed) add(key, 'Fecha no válida. Usa DD/MM/AAAA o AAAA-MM-DD.');
      return parsed;
    };

    const student = validatePerson(
      {
        documentType: parseDocumentType(get('documentType')),
        documentNumber: get('documentNumber'),
        firstNames: get('firstNames'),
        lastNames: get('lastNames'),
        birthDate: date('birthDate'),
        email: optional('email'),
        phone: optional('phone'),
        address: optional('address'),
      },
      'student',
    );
    errors.push(...student.errors);

    const code = optional('code');
    if (code && !/^[A-Za-z0-9-]{1,30}$/.test(code)) {
      add('code', 'El código debe tener hasta 30 letras, números o guiones.');
    }

    let guardian: ParsedRow['guardian'] = null;
    const guardianKeys: ColumnKey[] = [
      'guardianDocumentType',
      'guardianDocumentNumber',
      'guardianFirstNames',
      'guardianLastNames',
      'guardianRelationship',
      'guardianPhone',
      'guardianEmail',
      'guardianLegalRepresentative',
    ];
    if (guardianKeys.some((k) => get(k) !== '')) {
      const person = validatePerson(
        {
          documentType: parseDocumentType(get('guardianDocumentType')),
          documentNumber: get('guardianDocumentNumber'),
          firstNames: get('guardianFirstNames'),
          lastNames: get('guardianLastNames'),
          email: optional('guardianEmail'),
          phone: optional('guardianPhone'),
        },
        'guardian',
      );
      errors.push(...person.errors);
      const relationship = parseRelationship(get('guardianRelationship'));
      if (!relationship) {
        add(
          'guardianRelationship',
          'Parentesco no válido. Usa: Madre, Padre, Abuelo/a, Hermano/a, Tío/a, Tutor u Otro.',
        );
      }
      const legal = parseYesNo(get('guardianLegalRepresentative'));
      if (legal === null) add('guardianLegalRepresentative', 'Escribe SI o NO.');
      if (person.person && relationship && legal !== null) {
        guardian = { person: person.person, relationship, legalRepresentative: legal };
      }
    }

    let enrollment: ParsedRow['enrollment'] = null;
    const enrollmentKeys: ColumnKey[] = ['year', 'grade', 'group', 'campus', 'enrolledOn'];
    if (enrollmentKeys.some((k) => get(k) !== '')) {
      const year = Number(get('year'));
      if (!get('year') || !Number.isInteger(year))
        add('year', 'Indica el año lectivo (p. ej. 2027).');
      if (!get('grade')) add('grade', 'Indica el código del grado.');
      const enrolledOn = date('enrolledOn');
      enrollment = {
        year,
        grade: get('grade').toUpperCase(),
        group: get('group').toUpperCase() || null,
        campus: get('campus').toUpperCase() || null,
        enrolledOn,
      };
    }

    const row =
      student.person && errors.length === 0
        ? { number, student: student.person, code, guardian, enrollment }
        : null;
    return { number, row, errors };
  }

  /** Personas, códigos, años, grados y grupos que el archivo menciona. */
  private async loadContext(auth: AuthContext, parsed: Array<{ row: ParsedRow | null }>) {
    const rows = parsed.flatMap((p) => (p.row ? [p.row] : []));
    const documents = rows.flatMap((r) => [
      r.student.documentNumber,
      ...(r.guardian ? [r.guardian.person.documentNumber] : []),
    ]);
    const institutionId = auth.institutionId;
    const [people, codes, years, grades] = await Promise.all([
      this.prisma.person.findMany({
        where: { institutionId, documentNumber: { in: documents } },
        select: {
          documentType: true,
          documentNumber: true,
          firstNames: true,
          lastNames: true,
          student: { select: { id: true } },
        },
      }),
      this.prisma.student.findMany({
        where: {
          institutionId,
          code: { in: rows.flatMap((r) => (r.code ? [r.code] : [])), mode: 'insensitive' },
        },
        select: { code: true },
      }),
      this.prisma.academicYear.findMany({
        where: {
          institutionId,
          year: { in: rows.flatMap((r) => (r.enrollment ? [r.enrollment.year] : [])) },
        },
        select: { id: true, year: true, status: true },
      }),
      this.prisma.grade.findMany({
        where: { institutionId },
        select: { id: true, code: true, name: true, status: true },
      }),
    ]);
    const yearIds = years.map((y) => y.id);
    const groups = await this.prisma.schoolGroup.findMany({
      where: { institutionId, academicYearId: { in: yearIds } },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        capacity: true,
        academicYearId: true,
        gradeId: true,
        campus: { select: { code: true } },
        _count: {
          select: {
            placements: {
              where: { toDate: null, enrollment: { status: { in: ['PRE_ENROLLED', 'ACTIVE'] } } },
            },
          },
        },
      },
    });
    return {
      persons: new Map(people.map((p) => [docKey(p.documentType, p.documentNumber), p])),
      codes: new Set(codes.map((c) => c.code!.toUpperCase())),
      years: new Map(years.map((y) => [y.year, y])),
      grades: new Map(grades.map((g) => [g.code.toUpperCase(), g])),
      groups,
    };
  }

  private resolveEnrollment(
    row: ParsedRow,
    context: Awaited<ReturnType<StudentImportService['loadContext']>>,
    plannedSeats: Map<string, number>,
    add: (key: ColumnKey, message: string) => void,
    actions: string[],
    reserveSeat: boolean,
  ): PlannedRow['enrollmentTarget'] {
    const e = row.enrollment!;
    const year = context.years.get(e.year);
    const grade = context.grades.get(e.grade);
    if (!year) add('year', `No existe el año lectivo ${e.year}.`);
    else if (year.status === 'CLOSED') add('year', `El año lectivo ${e.year} está cerrado.`);
    if (!grade) add('grade', `No existe un grado con el código ${e.grade}.`);
    else if (grade.status !== 'ACTIVE') add('grade', `El grado ${grade.name} está inactivo.`);
    if (!year || year.status === 'CLOSED' || !grade || grade.status !== 'ACTIVE') return null;

    let schoolGroupId: string | null = null;
    let groupLabel = '';
    if (e.group) {
      const candidates = context.groups.filter(
        (g) =>
          g.academicYearId === year.id &&
          g.code.toUpperCase() === e.group &&
          (!e.campus || g.campus.code.toUpperCase() === e.campus),
      );
      if (candidates.length === 0) {
        add(
          'group',
          `No existe el grupo ${e.group} en ${e.year}${e.campus ? ` (sede ${e.campus})` : ''}.`,
        );
        return null;
      }
      if (candidates.length > 1) {
        add('campus', `El grupo ${e.group} existe en varias sedes: indica la sede.`);
        return null;
      }
      const group = candidates[0]!;
      if (group.gradeId !== grade.id) {
        add('group', `El grupo ${group.code} no es del grado ${grade.name}.`);
        return null;
      }
      if (group.status !== 'ACTIVE') {
        add('group', `El grupo ${group.code} está inactivo.`);
        return null;
      }
      const taken = group._count.placements + (plannedSeats.get(group.id) ?? 0);
      if (group.capacity !== null && taken >= group.capacity) {
        add('group', `El grupo ${group.code} ya no tiene cupo (${group.capacity}).`);
        return null;
      }
      if (reserveSeat) plannedSeats.set(group.id, (plannedSeats.get(group.id) ?? 0) + 1);
      schoolGroupId = group.id;
      groupLabel = ` – grupo ${group.code}`;
    }
    actions.push(`Matricular en ${grade.name} ${e.year}${groupLabel}`);
    return { academicYearId: year.id, gradeId: grade.id, schoolGroupId };
  }
}

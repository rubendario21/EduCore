import { randomUUID } from 'node:crypto';
import { type Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAsApp, resetDatabase, SQLSTATE, sqlStateOf } from './setup/database';

/**
 * Verifica, contra PostgreSQL real y con el rol de la aplicación, las reglas
 * de integridad escritas a mano en la migración 0001 (Prisma no las genera).
 */
describe('Reglas de integridad de la base de datos', () => {
  let db: Client;
  let institutionId: string;

  beforeAll(async () => {
    db = await connectAsApp();
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await resetDatabase();
    institutionId = randomUUID();
    await db.query(
      `INSERT INTO institution (id, legal_name, updated_at) VALUES ($1, 'Colegio de Prueba', now())`,
      [institutionId],
    );
  });

  async function insertYear(year: number, status: 'PLANNING' | 'ACTIVE' | 'CLOSED' = 'PLANNING') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO academic_year (id, institution_id, year, name, starts_on, ends_on, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [id, institutionId, year, `Año ${year}`, `${year}-01-20`, `${year}-11-30`, status],
    );
    return id;
  }

  function insertPeriod(
    yearId: string,
    number: number,
    startsOn: string,
    endsOn: string,
    weight = 25,
  ) {
    return db.query(
      `INSERT INTO academic_period (id, academic_year_id, number, name, starts_on, ends_on, weight_percent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [randomUUID(), yearId, number, `Período ${number}`, startsOn, endsOn, weight],
    );
  }

  describe('Auditoría de solo inserción', () => {
    it('la aplicación puede insertar pero no modificar ni borrar registros', async () => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO audit_log (id, institution_id, action) VALUES ($1, $2, 'test.event')`,
        [id, institutionId],
      );

      expect(
        await sqlStateOf(db.query(`UPDATE audit_log SET action = 'alterado' WHERE id = $1`, [id])),
      ).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
      expect(await sqlStateOf(db.query(`DELETE FROM audit_log WHERE id = $1`, [id]))).toBe(
        SQLSTATE.INSUFFICIENT_PRIVILEGE,
      );
      expect(await sqlStateOf(db.query(`TRUNCATE audit_log`))).toBe(
        SQLSTATE.INSUFFICIENT_PRIVILEGE,
      );
    });

    it('impide borrar una institución que tiene auditoría', async () => {
      await db.query(`INSERT INTO audit_log (id, institution_id, action) VALUES ($1, $2, 'x')`, [
        randomUUID(),
        institutionId,
      ]);
      expect(
        await sqlStateOf(db.query(`DELETE FROM institution WHERE id = $1`, [institutionId])),
      ).toBe(SQLSTATE.RESTRICT_VIOLATION);
    });
  });

  describe('Cuentas de usuario', () => {
    it('el correo es único sin distinguir mayúsculas (citext)', async () => {
      await db.query(
        `INSERT INTO "user" (id, email, updated_at) VALUES ($1, 'Rectoria@Colegio.edu.co', now())`,
        [randomUUID()],
      );
      expect(
        await sqlStateOf(
          db.query(
            `INSERT INTO "user" (id, email, updated_at) VALUES ($1, 'rectoria@colegio.edu.co', now())`,
            [randomUUID()],
          ),
        ),
      ).toBe(SQLSTATE.UNIQUE_VIOLATION);
    });
  });

  describe('Sedes', () => {
    it('solo admite una sede principal por institución', async () => {
      const insert = (code: string) =>
        db.query(
          `INSERT INTO campus (id, institution_id, code, name, is_main, updated_at) VALUES ($1, $2, $3, $3, true, now())`,
          [randomUUID(), institutionId, code],
        );
      await insert('NORTE');
      expect(await sqlStateOf(insert('SUR'))).toBe(SQLSTATE.UNIQUE_VIOLATION);
    });
  });

  describe('Años lectivos', () => {
    it('solo admite un año ACTIVO por institución', async () => {
      await insertYear(2026, 'ACTIVE');
      await insertYear(2027, 'PLANNING');
      expect(await sqlStateOf(insertYear(2028, 'ACTIVE'))).toBe(SQLSTATE.UNIQUE_VIOLATION);
    });

    it('rechaza fechas invertidas y años fuera de rango', async () => {
      expect(
        await sqlStateOf(
          db.query(
            `INSERT INTO academic_year (id, institution_id, year, name, starts_on, ends_on, updated_at)
             VALUES ($1, $2, 2026, 'x', '2026-11-30', '2026-01-20', now())`,
            [randomUUID(), institutionId],
          ),
        ),
      ).toBe(SQLSTATE.CHECK_VIOLATION);
      expect(await sqlStateOf(insertYear(1990))).toBe(SQLSTATE.CHECK_VIOLATION);
    });
  });

  describe('Períodos académicos', () => {
    it('admite períodos consecutivos sin solaparse', async () => {
      const yearId = await insertYear(2026);
      await insertPeriod(yearId, 1, '2026-01-20', '2026-03-31');
      expect(await sqlStateOf(insertPeriod(yearId, 2, '2026-04-01', '2026-06-15'))).toBeNull();
    });

    it('rechaza períodos que se solapan en el mismo año, incluso por un día', async () => {
      const yearId = await insertYear(2026);
      await insertPeriod(yearId, 1, '2026-01-20', '2026-03-31');
      expect(await sqlStateOf(insertPeriod(yearId, 2, '2026-03-31', '2026-06-15'))).toBe(
        SQLSTATE.EXCLUSION_VIOLATION,
      );
    });

    it('permite las mismas fechas en años distintos', async () => {
      const a = await insertYear(2026);
      const b = await insertYear(2027);
      await insertPeriod(a, 1, '2026-01-20', '2026-03-31');
      expect(await sqlStateOf(insertPeriod(b, 1, '2026-01-20', '2026-03-31'))).toBeNull();
    });

    it('rechaza pesos fuera de (0, 100] y números de período no positivos', async () => {
      const yearId = await insertYear(2026);
      expect(await sqlStateOf(insertPeriod(yearId, 1, '2026-01-20', '2026-03-31', 0))).toBe(
        SQLSTATE.CHECK_VIOLATION,
      );
      expect(await sqlStateOf(insertPeriod(yearId, 1, '2026-01-20', '2026-03-31', 100.01))).toBe(
        SQLSTATE.CHECK_VIOLATION,
      );
      expect(await sqlStateOf(insertPeriod(yearId, 0, '2026-01-20', '2026-03-31'))).toBe(
        SQLSTATE.CHECK_VIOLATION,
      );
    });
  });
});

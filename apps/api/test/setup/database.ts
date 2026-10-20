import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

config({ path: '.env.test', quiet: true });

function requireTestUrl(key: 'DATABASE_URL' | 'DATABASE_MIGRATION_URL'): string {
  const url = process.env[key];
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error(`${key} debe apuntar a una base de datos *_test`);
  }
  return url;
}

/**
 * Vacía todas las tablas de la base de pruebas (excepto el historial de
 * migraciones). Usa el rol dueño porque educore_app no puede borrar la
 * auditoría, que es de solo inserción.
 */
export async function resetDatabase(): Promise<void> {
  const client = new Client({ connectionString: requireTestUrl('DATABASE_MIGRATION_URL') });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
      await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}

/** Cliente Prisma con el rol de la aplicación (educore_app), igual que en producción. */
export function createAppPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireTestUrl('DATABASE_URL') }),
  });
}

/** Conexión `pg` directa con el rol de la aplicación, para probar reglas de la base. */
export async function connectAsApp(): Promise<Client> {
  const client = new Client({ connectionString: requireTestUrl('DATABASE_URL') });
  await client.connect();
  return client;
}

/** Ejecuta la consulta y devuelve el código de error de PostgreSQL (SQLSTATE), o null si no falló. */
export async function sqlStateOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    throw error;
  }
}

/** Códigos SQLSTATE usados en las pruebas. */
export const SQLSTATE = {
  /** ON DELETE RESTRICT: se intentó borrar una fila referenciada. */
  RESTRICT_VIOLATION: '23001',
  INTEGRITY_VIOLATION: '23000',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;

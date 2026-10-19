import { execSync } from 'node:child_process';
import { config } from 'dotenv';

/**
 * Prepara la base de pruebas antes de las suites de integración: carga
 * .env.test, se niega a continuar si la base no es de pruebas y aplica las
 * migraciones pendientes con el rol de migraciones.
 */
export default function setup(): void {
  const result = config({ path: '.env.test', quiet: true });
  if (result.error) {
    throw new Error(
      'No se encontró apps/api/.env.test. Cópialo desde .env.test.example y configura la base educore_test.',
    );
  }

  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL'] as const) {
    const url = process.env[key];
    const database = url ? new URL(url).pathname.replace(/^\//, '') : '';
    if (!database.endsWith('_test')) {
      throw new Error(
        `${key} debe apuntar a una base de datos de pruebas (nombre terminado en _test). Se encontró "${database}".`,
      );
    }
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

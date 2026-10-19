#!/usr/bin/env node
/**
 * EduCore · Preparación de la base de datos local de desarrollo.
 *
 * 1. Si no existen apps/api/.env y apps/api/.env.test, los crea a partir de los
 *    .env.example con contraseñas aleatorias para educore_owner y educore_app.
 *    Las contraseñas NO se imprimen en pantalla.
 * 2. Ejecuta infra/db/01-create-roles-and-databases.sql con psql como
 *    superusuario. psql pedirá la contraseña del superusuario en su propio prompt.
 *
 * Uso:   npm run db:setup:local
 * Variables opcionales: PSQL_PATH, PGHOST (localhost), PGPORT (5432), PGSUPERUSER (postgres).
 *
 * No elimina datos: si los roles o bases ya existen, el SQL solo actualiza las
 * contraseñas de los roles para que coincidan con las de los archivos .env.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiDir = join(root, 'apps', 'api');
const sqlFile = join(root, 'infra', 'db', '01-create-roles-and-databases.sql');

function readUrlPassword(envPath, key) {
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} no está definido en ${envPath}`);
  return decodeURIComponent(new URL(line.slice(key.length + 1)).password);
}

function ensureEnvFiles() {
  const envPath = join(apiDir, '.env');
  const testPath = join(apiDir, '.env.test');
  const devExists = existsSync(envPath);
  const testExists = existsSync(testPath);

  if (devExists !== testExists) {
    throw new Error(
      'Existe solo uno de apps/api/.env y apps/api/.env.test. Ambos deben usar las mismas ' +
        'contraseñas de rol; créalos manualmente desde los .env.example.',
    );
  }

  if (!devExists) {
    // base64url: sin caracteres que haya que escapar en la URL de conexión.
    const ownerPassword = randomBytes(24).toString('base64url');
    const appPassword = randomBytes(24).toString('base64url');
    const fill = (template) =>
      template
        .replace(/educore_app:CAMBIAR@/g, `educore_app:${appPassword}@`)
        .replace(/educore_owner:CAMBIAR@/g, `educore_owner:${ownerPassword}@`);

    writeFileSync(envPath, fill(readFileSync(join(apiDir, '.env.example'), 'utf8')));
    writeFileSync(testPath, fill(readFileSync(join(apiDir, '.env.test.example'), 'utf8')));
    console.log('✔ Creados apps/api/.env y apps/api/.env.test con contraseñas aleatorias.');
  } else {
    console.log('• apps/api/.env y .env.test ya existen: se usarán sus contraseñas.');
  }

  const owner = readUrlPassword(envPath, 'DATABASE_MIGRATION_URL');
  const app = readUrlPassword(envPath, 'DATABASE_URL');
  if (
    owner !== readUrlPassword(testPath, 'DATABASE_MIGRATION_URL') ||
    app !== readUrlPassword(testPath, 'DATABASE_URL')
  ) {
    throw new Error('Las contraseñas de los roles difieren entre .env y .env.test.');
  }
  if (owner === 'CAMBIAR' || app === 'CAMBIAR') {
    throw new Error('Reemplaza los valores CAMBIAR en apps/api/.env y .env.test.');
  }
  return { owner, app };
}

function findPsql() {
  if (process.env.PSQL_PATH) return process.env.PSQL_PATH;
  if (process.platform === 'win32') {
    for (const version of ['18', '17', '16', '15']) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${version}\\bin\\psql.exe`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'psql';
}

try {
  const passwords = ensureEnvFiles();
  const psql = findPsql();
  console.log(`• Ejecutando ${sqlFile} con ${psql}`);
  console.log('  psql solicitará la contraseña del superusuario de PostgreSQL.\n');

  const result = spawnSync(
    psql,
    [
      '-h',
      process.env.PGHOST ?? 'localhost',
      '-p',
      process.env.PGPORT ?? '5432',
      '-U',
      process.env.PGSUPERUSER ?? 'postgres',
      '-d',
      'postgres',
      '-f',
      sqlFile,
    ],
    {
      stdio: 'inherit',
      // Por entorno y no como argumentos: los argumentos son visibles en la
      // lista de procesos del sistema.
      env: {
        ...process.env,
        EDUCORE_OWNER_PASSWORD: passwords.owner,
        EDUCORE_APP_PASSWORD: passwords.app,
      },
    },
  );

  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

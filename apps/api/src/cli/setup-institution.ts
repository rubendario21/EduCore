/* eslint-disable no-console -- herramienta de línea de comandos: la consola es su interfaz. */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../config/app-config.module';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PermissionSyncService } from '../modules/access-control/permission-sync.service';
import { AuditService } from '../modules/audit/audit.service';
import { PasswordHasher } from '../modules/auth/password-hasher';
import { checkPasswordPolicy } from '../modules/auth/password-policy';
import { setupConfigSchema } from './setup-institution.config';
import { SetupInstitutionService, SetupRefusedError } from './setup-institution.service';

/**
 * Configuración inicial de EduCore.
 *
 *   npm run setup:institution -w @educore/api -- [--file setup/institution.local.json]
 *
 * La contraseña del administrador se pide por consola sin mostrarse. Para
 * entornos no interactivos puede pasarse en EDUCORE_ADMIN_PASSWORD.
 */
@Module({
  imports: [AppConfigModule, PrismaModule],
  providers: [PermissionSyncService, AuditService, PasswordHasher, SetupInstitutionService],
})
class SetupCliModule {}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Lee una línea sin mostrar lo que se escribe. */
function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error('La terminal no es interactiva. Define EDUCORE_ADMIN_PASSWORD para continuar.'),
    );
  }
  return new Promise((resolvePrompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const internals = rl as unknown as {
      _writeToOutput: (text: string) => void;
      output: NodeJS.WriteStream;
    };
    internals._writeToOutput = (text: string) => {
      // Solo se muestra la pregunta; los caracteres tecleados se ocultan.
      if (text.includes(question)) internals.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolvePrompt(answer);
    });
  });
}

async function readAdminPassword(context: {
  email: string;
  firstNames: string;
  lastNames: string;
}) {
  const fromEnv = process.env.EDUCORE_ADMIN_PASSWORD;
  if (fromEnv) {
    const problems = checkPasswordPolicy(fromEnv, context);
    if (problems.length > 0)
      throw new Error(`EDUCORE_ADMIN_PASSWORD no es válida: ${problems.join(' ')}`);
    return fromEnv;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const password = await promptHidden('Contraseña del administrador: ');
    const problems = checkPasswordPolicy(password, context);
    if (problems.length > 0) {
      console.error(`  ✖ ${problems.join(' ')}`);
      continue;
    }
    const confirmation = await promptHidden('Confirma la contraseña: ');
    if (confirmation !== password) {
      console.error('  ✖ Las contraseñas no coinciden.');
      continue;
    }
    return password;
  }
  throw new Error('No se definió una contraseña válida.');
}

async function main(): Promise<void> {
  const file = resolve(argValue('--file') ?? 'setup/institution.local.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `No se pudo leer ${file}. Cópialo desde setup/institution.example.json. (${(error as Error).message})`,
      { cause: error },
    );
  }

  const parsed = setupConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`El archivo de configuración no es válido:\n${problems}`);
  }
  const config = parsed.data;

  console.log(`EduCore · Configuración inicial de "${config.institution.legalName}"`);
  console.log(
    `Administrador: ${config.admin.firstNames} ${config.admin.lastNames} <${config.admin.email}>\n`,
  );

  const password = await readAdminPassword(config.admin);

  const app = await NestFactory.createApplicationContext(SetupCliModule, { logger: ['error'] });
  try {
    const hasher = app.get(PasswordHasher);
    const result = await app.get(SetupInstitutionService).run(config, await hasher.hash(password));
    console.log('\n✔ Institución configurada.');
    console.log(`  Institución: ${result.institutionId}`);
    console.log(`  Administrador: ${config.admin.email} (puede iniciar sesión ahora)`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof SetupRefusedError || error instanceof Error ? error.message : String(error);
  console.error(`\n✖ ${message}`);
  process.exit(1);
});

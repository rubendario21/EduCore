import { type SystemRoleCode } from '@educore/shared';
import { type INestApplication } from '@nestjs/common';
import { type MembershipStatus } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PermissionSyncService } from '../../src/modules/access-control/permission-sync.service';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';

let documentCounter = 1_000_000;

/** Crea una institución con sus roles de sistema sincronizados. */
export async function seedInstitution(app: INestApplication, legalName = 'Colegio de Pruebas') {
  const prisma = app.get(PrismaService);
  const institution = await prisma.institution.create({
    data: { legalName, settings: { create: {} } },
  });
  await app.get(PermissionSyncService).syncAll();
  return institution;
}

export interface SeedMemberOptions {
  institutionId: string;
  email: string;
  /** null = cuenta sin contraseña (invitada, pendiente de activación). */
  password: string | null;
  /** Código de un rol de sistema o personalizado. */
  roleCode: SystemRoleCode | (string & {});
  status?: MembershipStatus;
  firstNames?: string;
  lastNames?: string;
}

/** Crea una cuenta con su persona, membresía y rol. */
export async function seedMember(app: INestApplication, options: SeedMemberOptions) {
  const prisma = app.get(PrismaService);
  const role = await prisma.role.findUniqueOrThrow({
    where: { institutionId_code: { institutionId: options.institutionId, code: options.roleCode } },
  });
  const passwordHash = options.password
    ? await app.get(PasswordHasher).hash(options.password)
    : null;

  const user = await prisma.user.create({ data: { email: options.email, passwordHash } });
  const person = await prisma.person.create({
    data: {
      institutionId: options.institutionId,
      documentType: 'CC',
      documentNumber: String(documentCounter++),
      firstNames: options.firstNames ?? 'Persona',
      lastNames: options.lastNames ?? 'De Prueba',
      email: options.email,
    },
  });
  const membership = await prisma.userInstitution.create({
    data: {
      userId: user.id,
      institutionId: options.institutionId,
      personId: person.id,
      status: options.status ?? (options.password ? 'ACTIVE' : 'INVITED'),
      roles: { create: { roleId: role.id } },
    },
  });
  return { user, person, membership };
}

/** Extrae una cookie de la respuesta (valor y atributos) a partir de Set-Cookie. */
export function readCookie(setCookie: string | string[] | undefined, name: string) {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = headers.find((h) => h.startsWith(`${name}=`));
  if (!header) return null;
  const [pair, ...attributes] = header.split(';').map((part) => part.trim());
  return {
    value: decodeURIComponent(pair!.slice(name.length + 1)),
    attributes: attributes.map((a) => a.toLowerCase()),
    header,
  };
}

/** Inicia sesión por HTTP y devuelve el token de acceso. */
export async function loginAs(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const { default: request } = await import('supertest');
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password });
  if (res.status !== 200) throw new Error(`No se pudo iniciar sesión como ${email}: ${res.status}`);
  return res.body.accessToken as string;
}

/** Crea un rol personalizado con los permisos indicados (alcance ALL). */
export async function seedCustomRole(
  app: INestApplication,
  institutionId: string,
  code: string,
  permissionCodes: string[],
) {
  const prisma = app.get(PrismaService);
  const permissions = await prisma.permission.findMany({
    where: { code: { in: permissionCodes } },
  });
  return prisma.role.create({
    data: {
      institutionId,
      code,
      name: code,
      permissions: {
        create: permissions.map((p) => ({ permissionId: p.id, scope: 'ALL' as const })),
      },
    },
  });
}

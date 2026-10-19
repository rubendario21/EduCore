import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Archivos y logo institucional (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let institutionId: string;
  let admin: string;
  let coordinator: string;

  const http = () => request(app.getHttpServer());
  const upload = (token: string, content: Buffer, filename: string, contentType = 'image/png') =>
    http()
      .post('/api/v1/institution/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', content, { filename, contentType });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
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
    admin = await loginAs(app, 'rectoria@prueba.edu.co', PASSWORD);
    coordinator = await loginAs(app, 'coordinacion@prueba.edu.co', PASSWORD);
  });

  it('sube el logo, lo guarda fuera de la base y lo publica en la marca', async () => {
    const res = await upload(admin, PNG, '../../logo del colegio.png');
    expect(res.status).toBe(201);
    expect(res.body.settings.logoUrl).toMatch(
      /^\/api\/v1\/institution\/branding\/logo\?v=[0-9a-f-]{36}$/,
    );

    // Metadatos en la base; el contenido NO está en la base.
    const file = await prisma.storedFile.findFirstOrThrow({ where: { institutionId } });
    expect(file).toMatchObject({
      originalName: 'logo del colegio.png',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      classification: 'INSTITUTIONAL',
      storageDriver: 'local',
    });
    expect(file.storageKey).toMatch(
      new RegExp(`^institutions/${institutionId}/\\d{4}/\\d{2}/[0-9a-f-]{36}$`),
    );
    expect(file.storageKey).not.toContain('logo');

    // El contenido está en la carpeta privada configurada, idéntico al subido.
    const dir = app.get(AppConfigService).storage.localDir;
    expect(await readFile(resolve(process.cwd(), dir, ...file.storageKey.split('/')))).toEqual(PNG);

    const branding = await http().get('/api/v1/institution/branding');
    expect(branding.body.logoUrl).toBe(res.body.settings.logoUrl);
    expect(await prisma.auditLog.count({ where: { action: 'institution.logo.updated' } })).toBe(1);
  });

  it('sirve el logo público con cabeceras seguras', async () => {
    const res = await upload(admin, PNG, 'logo.png');
    const logo = await http().get(res.body.settings.logoUrl).buffer(true);
    expect(logo.status).toBe(200);
    expect(logo.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=86400',
    });
    expect(logo.headers['content-security-policy']).toContain("default-src 'none'");
    expect(Buffer.compare(logo.body as Buffer, PNG)).toBe(0);
  });

  it('rechaza archivos cuyo contenido no es una imagen permitida, aunque digan serlo', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const fakePng = await upload(admin, svg, 'logo.png', 'image/png');
    expect(fakePng.status).toBe(415);
    expect(fakePng.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');

    const realSvg = await upload(admin, svg, 'logo.svg', 'image/svg+xml');
    expect(realSvg.status).toBe(415);

    const pdf = await upload(admin, Buffer.from('%PDF-1.7\n...'), 'logo.pdf', 'application/pdf');
    expect(pdf.status).toBe(415);
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it('rechaza archivos demasiado grandes o ausentes', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const tooBig = await upload(admin, big, 'grande.png');
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    const none = await http()
      .post('/api/v1/institution/logo')
      .set('Authorization', `Bearer ${admin}`);
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('FILE_REQUIRED');
  });

  it('exige el permiso de configuración para subir o quitar el logo', async () => {
    expect((await upload(coordinator, PNG, 'logo.png')).status).toBe(403);
    expect(
      (
        await http()
          .delete('/api/v1/institution/logo')
          .set('Authorization', `Bearer ${coordinator}`)
      ).status,
    ).toBe(403);
  });

  it('quita el logo conservando el archivo para trazabilidad', async () => {
    const res = await upload(admin, PNG, 'logo.png');
    const removed = await http()
      .delete('/api/v1/institution/logo')
      .set('Authorization', `Bearer ${admin}`);
    expect(removed.status).toBe(200);
    expect(removed.body.settings.logoUrl).toBeNull();
    expect((await http().get('/api/v1/institution/branding')).body.logoUrl).toBeNull();
    expect((await http().get(res.body.settings.logoUrl)).status).toBe(404);
    expect(await prisma.storedFile.count()).toBe(1);
  });

  describe('Descarga autenticada (GET /files/:id)', () => {
    it('un miembro de la institución descarga un archivo institucional', async () => {
      await upload(admin, PNG, 'logo.png');
      const file = await prisma.storedFile.findFirstOrThrow();
      const res = await http()
        .get(`/api/v1/files/${file.id}`)
        .set('Authorization', `Bearer ${coordinator}`)
        .buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain("filename*=UTF-8''logo.png");
    });

    it('exige sesión y oculta archivos de otra institución o no autorizados', async () => {
      await upload(admin, PNG, 'logo.png');
      const file = await prisma.storedFile.findFirstOrThrow();
      expect((await http().get(`/api/v1/files/${file.id}`)).status).toBe(401);

      const other = await seedInstitution(app, 'Otro Colegio');
      await seedMember(app, {
        institutionId: other.id,
        email: 'ajeno@otro.edu.co',
        password: PASSWORD,
        roleCode: SYSTEM_ROLES.INSTITUTION_ADMIN,
      });
      const foreign = await loginAs(app, 'ajeno@otro.edu.co', PASSWORD);
      const res = await http()
        .get(`/api/v1/files/${file.id}`)
        .set('Authorization', `Bearer ${foreign}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FILE_NOT_FOUND');

      // Un archivo sensible solo lo descarga quien lo subió (hasta que su módulo defina reglas).
      await prisma.storedFile.update({
        where: { id: file.id },
        data: { classification: 'SENSITIVE' },
      });
      expect(
        (await http().get(`/api/v1/files/${file.id}`).set('Authorization', `Bearer ${coordinator}`))
          .status,
      ).toBe(404);
      expect(
        (await http().get(`/api/v1/files/${file.id}`).set('Authorization', `Bearer ${admin}`))
          .status,
      ).toBe(200);
    });
  });
});

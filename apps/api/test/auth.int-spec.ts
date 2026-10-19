import { createHmac } from 'node:crypto';
import { SYSTEM_ROLES } from '@educore/shared';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailService } from '../src/infrastructure/mail/mail.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthRepository } from '../src/modules/auth/auth.repository';
import { PasswordService } from '../src/modules/auth/password.service';
import { REFRESH_COOKIE_NAME } from '../src/modules/auth/session.service';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { readCookie, seedInstitution, seedMember } from './setup/fixtures';

const PASSWORD = 'una frase de acceso bastante larga';
const ADMIN_EMAIL = 'rectoria@prueba.edu.co';
const WEB_ORIGIN = 'http://127.0.0.1:5173';

describe('Autenticación (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let institutionId: string;
  let adminUserId: string;

  const http = () => request(app.getHttpServer());

  async function login(email = ADMIN_EMAIL, password = PASSWORD) {
    return http().post('/api/v1/auth/login').send({ email, password });
  }

  async function loginOk(email = ADMIN_EMAIL, password = PASSWORD) {
    const res = await login(email, password);
    expect(res.status).toBe(200);
    const cookie = readCookie(res.headers['set-cookie'], REFRESH_COOKIE_NAME);
    expect(cookie).not.toBeNull();
    return {
      accessToken: res.body.accessToken as string,
      refreshToken: cookie!.value,
      body: res.body,
    };
  }

  function refresh(refreshToken: string) {
    return http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`)
      .set('X-EduCore-CSRF', '1')
      .set('Origin', WEB_ORIGIN);
  }

  function me(accessToken: string) {
    return http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    mail.outbox.length = 0;
    const institution = await seedInstitution(app);
    institutionId = institution.id;
    const admin = await seedMember(app, {
      institutionId,
      email: ADMIN_EMAIL,
      password: PASSWORD,
      roleCode: SYSTEM_ROLES.INSTITUTION_ADMIN,
      firstNames: 'Ana María',
      lastNames: 'Rodríguez',
    });
    adminUserId = admin.user.id;
  });

  // ---------------------------------------------------------------------------
  describe('POST /auth/login', () => {
    it('inicia sesión: token de acceso, permisos y cookie de sesión segura', async () => {
      const res = await login();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: adminUserId,
          email: ADMIN_EMAIL,
          firstNames: 'Ana María',
          institution: { id: institutionId, name: 'Colegio de Pruebas' },
          roles: [{ code: 'INSTITUTION_ADMIN' }],
        },
      });
      expect(res.body.user.permissions).toContainEqual({
        code: 'users.accounts.read',
        scopes: ['ALL'],
      });
      expect(res.body.accessToken.split('.')).toHaveLength(3);
      expect(res.headers['cache-control']).toBe('no-store');

      const cookie = readCookie(res.headers['set-cookie'], REFRESH_COOKIE_NAME)!;
      expect(cookie.attributes).toEqual(
        expect.arrayContaining(['httponly', 'secure', 'samesite=strict', 'path=/api/v1/auth']),
      );
      expect(cookie.value).toHaveLength(43); // 32 bytes en base64url

      // Nada sensible en la respuesta ni en la base.
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|refreshToken/);
      const session = await prisma.userSession.findFirstOrThrow({ where: { userId: adminUserId } });
      expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(session.refreshTokenHash).not.toContain(cookie.value);
    });

    it('acepta el correo con mayúsculas y espacios', async () => {
      expect((await login('  RECTORIA@Prueba.edu.co ')).status).toBe(200);
    });

    it('responde exactamente igual a un correo inexistente y a una contraseña incorrecta', async () => {
      const wrongPassword = await login(ADMIN_EMAIL, 'contraseña equivocada');
      const unknownEmail = await login('nadie@prueba.edu.co', 'contraseña equivocada');
      const strip = (body: { error: Record<string, unknown> }) => ({
        ...body.error,
        requestId: undefined,
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(strip(wrongPassword.body)).toEqual(strip(unknownEmail.body));
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(readCookie(wrongPassword.headers['set-cookie'], REFRESH_COOKIE_NAME)).toBeNull();
    });

    it('bloquea la cuenta tras 5 intentos fallidos, incluso con la contraseña correcta', async () => {
      for (let i = 0; i < 4; i++)
        expect((await login(ADMIN_EMAIL, 'mal')).body.error.code).toBe('INVALID_CREDENTIALS');
      // El quinto fallo bloquea.
      expect((await login(ADMIN_EMAIL, 'mal')).status).toBe(401);

      const blocked = await login();
      expect(blocked.status).toBe(401);
      expect(blocked.body.error).toMatchObject({ code: 'ACCOUNT_LOCKED' });
      expect(blocked.body.error.details.retryAfterSeconds).toBeGreaterThan(14 * 60);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } });
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.auditLog.count({ where: { action: 'auth.account.locked' } })).toBe(1);
    });

    it('desbloquea al vencer el bloqueo y reinicia el contador al entrar', async () => {
      await prisma.user.update({
        where: { id: adminUserId },
        data: { lockedUntil: new Date(Date.now() - 1000), failedLoginCount: 3 },
      });
      expect((await login()).status).toBe(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } });
      expect(user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
      expect(user.lastLoginAt).not.toBeNull();
    });

    it('informa la suspensión solo a quien conoce la contraseña', async () => {
      await prisma.userInstitution.updateMany({
        where: { userId: adminUserId },
        data: { status: 'SUSPENDED' },
      });
      expect((await login(ADMIN_EMAIL, 'mal')).body.error.code).toBe('INVALID_CREDENTIALS');
      const res = await login();
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('rechaza cuentas invitadas que aún no definen contraseña', async () => {
      await seedMember(app, {
        institutionId,
        email: 'invitado@prueba.edu.co',
        password: null,
        roleCode: SYSTEM_ROLES.TEACHER,
      });
      expect((await login('invitado@prueba.edu.co', 'cualquier cosa')).body.error.code).toBe(
        'INVALID_CREDENTIALS',
      );
    });

    it('valida los datos de entrada', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'no-es-correo', password: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'email',
        'password',
      ]);
    });

    it('registra el inicio de sesión en la auditoría', async () => {
      await loginOk();
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.login.succeeded' },
      });
      expect(entry).toMatchObject({ institutionId, actorUserId: adminUserId });
      expect(entry.requestId).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  describe('Autenticación obligatoria (GET /auth/me)', () => {
    it('exige token', async () => {
      const res = await http().get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('devuelve el usuario con un token válido', async () => {
      const { accessToken } = await loginOk();
      const res = await me(accessToken);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: adminUserId, email: ADMIN_EMAIL });
    });

    it('rechaza tokens alterados, firmados con otra clave o sin firma', async () => {
      const { accessToken } = await loginOk();
      const [header, payload] = accessToken.split('.') as [string, string, string];

      const tampered = JSON.parse(Buffer.from(payload, 'base64url').toString());
      tampered.sub = '00000000-0000-7000-8000-000000000000';
      const tamperedToken = `${header}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${accessToken.split('.')[2]}`;

      const foreignSignature = createHmac('sha256', 'otra-clave-secreta-de-al-menos-32-caracteres')
        .update(`${header}.${payload}`)
        .digest('base64url');
      const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );

      for (const token of [
        tamperedToken,
        `${header}.${payload}.${foreignSignature}`,
        `${noneHeader}.${payload}.`,
      ]) {
        const res = await me(token);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('invalida de inmediato el token si se suspende la cuenta', async () => {
      const { accessToken } = await loginOk();
      await prisma.userInstitution.updateMany({
        where: { userId: adminUserId },
        data: { status: 'SUSPENDED' },
      });
      const res = await me(accessToken);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_INVALID');
    });
  });

  // ---------------------------------------------------------------------------
  describe('POST /auth/refresh', () => {
    it('exige el encabezado anti-CSRF y un origen autorizado', async () => {
      const { refreshToken } = await loginOk();
      const noHeader = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`);
      expect(noHeader.status).toBe(403);
      expect(noHeader.body.error.code).toBe('CSRF_CHECK_FAILED');

      const foreign = await refresh(refreshToken).set('Origin', 'https://sitio-malicioso.example');
      expect(foreign.status).toBe(403);
      expect(foreign.body.error.code).toBe('CSRF_CHECK_FAILED');
    });

    it('rota la sesión: entrega un token nuevo y una cookie nueva', async () => {
      const first = await loginOk();
      const res = await refresh(first.refreshToken);
      expect(res.status).toBe(200);
      const rotated = readCookie(res.headers['set-cookie'], REFRESH_COOKIE_NAME)!;
      expect(rotated.value).not.toBe(first.refreshToken);
      expect((await me(res.body.accessToken)).status).toBe(200);

      const sessions = await prisma.userSession.findMany({
        where: { userId: adminUserId },
        orderBy: { createdAt: 'asc' },
      });
      expect(sessions).toHaveLength(2);
      expect(sessions[0]!.familyId).toBe(sessions[1]!.familyId);
      expect(sessions[0]!.rotatedAt).not.toBeNull();
    });

    it('detecta la reutilización de un token ya rotado y revoca toda la familia', async () => {
      const first = await loginOk();
      const second = await refresh(first.refreshToken);
      const newRefresh = readCookie(second.headers['set-cookie'], REFRESH_COOKIE_NAME)!.value;

      // Simula que pasó tiempo: ya no es una carrera entre pestañas.
      await prisma.userSession.updateMany({
        where: { userId: adminUserId, rotatedAt: { not: null } },
        data: { rotatedAt: new Date(Date.now() - 60_000) },
      });

      const reuse = await refresh(first.refreshToken);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('SESSION_INVALID');

      // El atacante y la víctima pierden la sesión: hay que volver a iniciar sesión.
      expect((await refresh(newRefresh)).status).toBe(401);
      expect((await me(second.body.accessToken)).body.error.code).toBe('SESSION_INVALID');
      expect(
        await prisma.auditLog.count({ where: { action: 'auth.session.reuse_detected' } }),
      ).toBe(1);
      expect(
        await prisma.userSession.count({
          where: { userId: adminUserId, revokedReason: 'REUSE_DETECTED' },
        }),
      ).toBe(2);
    });

    it('tolera una carrera entre pestañas sin cerrar la sesión', async () => {
      const first = await loginOk();
      const winner = await refresh(first.refreshToken);
      const loser = await refresh(first.refreshToken);
      expect(loser.status).toBe(401);
      expect(loser.body.error.code).toBe('SESSION_ROTATED');
      // La pestaña perdedora no borra la cookie, y la sesión nueva sigue válida.
      expect(readCookie(loser.headers['set-cookie'], REFRESH_COOKIE_NAME)).toBeNull();
      const newRefresh = readCookie(winner.headers['set-cookie'], REFRESH_COOKIE_NAME)!.value;
      expect((await refresh(newRefresh)).status).toBe(200);
    });

    it('rechaza sesiones vencidas y respeta la duración máxima absoluta', async () => {
      const { refreshToken } = await loginOk();
      await prisma.userSession.updateMany({
        where: { userId: adminUserId },
        data: { createdAt: new Date(Date.now() - 31 * 24 * 3_600_000) },
      });
      const res = await refresh(refreshToken);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_INVALID');
    });

    it('rechaza una cookie inexistente o ausente', async () => {
      expect((await refresh('token-que-no-existe-en-la-base-de-datos')).status).toBe(401);
      const noCookie = await http().post('/api/v1/auth/refresh').set('X-EduCore-CSRF', '1');
      expect(noCookie.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('POST /auth/logout', () => {
    it('revoca la sesión en el servidor y borra la cookie', async () => {
      const { accessToken, refreshToken } = await loginOk();
      const res = await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`)
        .set('X-EduCore-CSRF', '1');
      expect(res.status).toBe(204);
      const cleared = readCookie(res.headers['set-cookie'], REFRESH_COOKIE_NAME)!;
      expect(cleared.value).toBe('');

      expect((await refresh(refreshToken)).status).toBe(401);
      // El token de acceso deja de servir aunque no haya expirado.
      expect((await me(accessToken)).body.error.code).toBe('SESSION_INVALID');
    });

    it('exige el encabezado anti-CSRF', async () => {
      const { refreshToken } = await loginOk();
      const res = await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Recuperación de contraseña', () => {
    function forgot(email: string) {
      return http().post('/api/v1/auth/password/forgot').send({ email });
    }

    function tokenFromLastMail(): string {
      const last = mail.outbox.at(-1)!;
      const match = last.text.match(/token=([A-Za-z0-9_%-]+)/);
      return decodeURIComponent(match![1]!);
    }

    it('responde igual exista o no la cuenta, y solo envía correo si existe', async () => {
      const existing = await forgot(ADMIN_EMAIL);
      const unknown = await forgot('nadie@prueba.edu.co');
      expect(existing.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(existing.body).toEqual(unknown.body);

      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0]).toMatchObject({
        to: ADMIN_EMAIL,
        subject: 'Restablece tu contraseña de EduCore',
      });
      expect(mail.outbox[0]!.text).toContain('http://127.0.0.1:5173/restablecer-contrasena?token=');
    });

    it('restablece la contraseña, cierra todas las sesiones y el enlace es de un solo uso', async () => {
      const session = await loginOk();
      await forgot(ADMIN_EMAIL);
      const token = tokenFromLastMail();

      const res = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'mi nueva frase secreta y larga' });
      expect(res.status).toBe(204);

      expect((await me(session.accessToken)).body.error.code).toBe('SESSION_INVALID');
      expect((await login()).status).toBe(401);
      expect((await login(ADMIN_EMAIL, 'mi nueva frase secreta y larga')).status).toBe(200);

      const reuse = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'otra frase secreta diferente' });
      expect(reuse.status).toBe(400);
      expect(reuse.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
      expect(await prisma.auditLog.count({ where: { action: 'auth.password.reset' } })).toBe(1);
    });

    it('una contraseña débil no consume el enlace', async () => {
      await forgot(ADMIN_EMAIL);
      const token = tokenFromLastMail();
      const weak = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'corta' });
      expect(weak.status).toBe(400);
      expect(weak.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'newPassword' }],
      });

      const strong = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'mi nueva frase secreta y larga' });
      expect(strong.status).toBe(204);
    });

    it('rechaza enlaces vencidos y solo el más reciente es válido', async () => {
      await forgot(ADMIN_EMAIL);
      const oldToken = tokenFromLastMail();
      await forgot(ADMIN_EMAIL);
      const newToken = tokenFromLastMail();

      const old = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: oldToken, newPassword: 'mi nueva frase secreta y larga' });
      expect(old.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

      await prisma.passwordToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: newToken, newPassword: 'mi nueva frase secreta y larga' });
      expect(expired.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    it('limita los enlaces por cuenta y hora', async () => {
      for (let i = 0; i < 5; i++) expect((await forgot(ADMIN_EMAIL)).status).toBe(202);
      expect(mail.outbox).toHaveLength(3);
    });

    it('activa una cuenta invitada con el enlace de activación', async () => {
      const invited = await seedMember(app, {
        institutionId,
        email: 'docente@prueba.edu.co',
        password: null,
        roleCode: SYSTEM_ROLES.TEACHER,
        firstNames: 'Carlos',
      });
      const passwords = app.get(PasswordService);
      const user = (await app.get(AuthRepository).findUserById(invited.user.id))!;
      const message = await prisma.$transaction((tx) => passwords.prepareActivation(user, tx));
      passwords.deliver(message);
      expect(mail.outbox.at(-1)!.text).toContain('/activar-cuenta?token=');

      const res = await http()
        .post('/api/v1/auth/password/reset')
        .send({ token: tokenFromLastMail(), newPassword: 'mi primera frase secreta' });
      expect(res.status).toBe(204);

      const membership = await prisma.userInstitution.findFirstOrThrow({
        where: { userId: invited.user.id },
      });
      expect(membership.status).toBe('ACTIVE');
      expect((await login('docente@prueba.edu.co', 'mi primera frase secreta')).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: 'auth.account.activated' } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('POST /auth/password/change', () => {
    function change(accessToken: string, currentPassword: string, newPassword: string) {
      return http()
        .post('/api/v1/auth/password/change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword, newPassword });
    }

    it('exige la contraseña actual correcta', async () => {
      const { accessToken } = await loginOk();
      const res = await change(accessToken, 'no es la actual', 'mi nueva frase secreta y larga');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CURRENT_PASSWORD_INVALID');
    });

    it('cambia la contraseña, mantiene la sesión actual y cierra las demás', async () => {
      const current = await loginOk();
      const other = await loginOk();

      expect(
        (await change(current.accessToken, PASSWORD, 'mi nueva frase secreta y larga')).status,
      ).toBe(204);

      expect((await me(current.accessToken)).status).toBe(200);
      expect((await me(other.accessToken)).body.error.code).toBe('SESSION_INVALID');
      expect((await login(ADMIN_EMAIL, 'mi nueva frase secreta y larga')).status).toBe(200);
    });

    it('rechaza reutilizar la misma contraseña o una débil', async () => {
      const { accessToken } = await loginOk();
      expect((await change(accessToken, PASSWORD, PASSWORD)).body.error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect((await change(accessToken, PASSWORD, 'colegio2026')).body.error.code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('requiere sesión', async () => {
      const res = await http()
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: PASSWORD, newPassword: 'mi nueva frase secreta y larga' });
      expect(res.status).toBe(401);
    });
  });
});

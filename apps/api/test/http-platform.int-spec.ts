import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './setup/create-test-app';

describe('Plataforma HTTP (integración con PostgreSQL)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /api/v1/health', () => {
    it('responde 200 con la base de datos conectada', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', checks: { database: { status: 'up' } } });
      expect(typeof res.body.checks.database.latencyMs).toBe('number');
    });

    it('expone el liveness sin consultar dependencias', async () => {
      await request(app.getHttpServer()).get('/api/v1/health/live').expect(200, { status: 'ok' });
    });

    it('solo responde bajo la ruta versionada', async () => {
      await request(app.getHttpServer()).get('/health').expect(404);
      await request(app.getHttpServer()).get('/api/health').expect(404);
    });
  });

  describe('Cabeceras de seguridad', () => {
    it('aplica helmet y oculta la tecnología del servidor', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('Identificador de petición', () => {
    it('genera un X-Request-Id cuando no se envía', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/live');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('reutiliza un X-Request-Id válido y descarta uno malicioso', async () => {
      const ok = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('X-Request-Id', 'proxy-abc-12345');
      expect(ok.headers['x-request-id']).toBe('proxy-abc-12345');

      const bad = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('X-Request-Id', '<script>alert(1)</script>');
      expect(bad.headers['x-request-id']).not.toContain('<script>');
    });
  });

  describe('CORS restrictivo', () => {
    it('autoriza el origen configurado con credenciales', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('no autoriza orígenes desconocidos', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', 'https://sitio-malicioso.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Formato de errores', () => {
    it('devuelve 404 con el formato estándar y sin revelar la ruta', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/no-existe').expect(404);
      expect(res.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'El recurso solicitado no existe.',
          requestId: res.headers['x-request-id'],
        },
      });
    });

    it('devuelve 400 con formato estándar ante JSON malformado', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/health')
        .set('Content-Type', 'application/json')
        .send('{"incompleto":');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_JSON',
        message: 'El cuerpo de la solicitud no es un JSON válido.',
      });
    });

    it('devuelve 413 cuando el cuerpo supera el límite', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/health')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ relleno: 'x'.repeat(200 * 1024) }));
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });
});

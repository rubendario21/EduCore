import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from './setup/database';

/**
 * Límite de intentos por IP en los endpoints sensibles. Usa un límite bajo
 * propio: la configuración se lee al importar AppModule, así que la variable
 * se define antes de importar la aplicación.
 */
describe('Límite de intentos por IP (integración)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    vi.stubEnv('AUTH_RATE_LIMIT_MAX', '3');
    await resetDatabase();
    const { createTestApp } = await import('./setup/create-test-app.js');
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('bloquea el login por IP tras superar el límite, con el formato de error estándar', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'atacante@prueba.edu.co', password: 'adivinando' });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after-auth']).toBeDefined();
  });

  it('el límite estricto no afecta a los endpoints que no son de autenticación', async () => {
    for (let i = 0; i < 6; i++) {
      expect((await request(app.getHttpServer()).get('/api/v1/health/live')).status).toBe(200);
    }
  });
});

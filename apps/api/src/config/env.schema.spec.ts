import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://educore_app:secreto-que-no-debe-aparecer@localhost:5432/educore_dev',
  WEB_ORIGINS: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  APP_PUBLIC_URL: 'http://localhost:5173',
};

/** Configuración mínima válida para producción. */
const production = {
  ...base,
  NODE_ENV: 'production',
  WEB_ORIGINS: 'https://educore.example',
  APP_PUBLIC_URL: 'https://educore.example',
  MAIL_DRIVER: 'smtp',
  SMTP_HOST: 'smtp.example',
};

describe('validateEnv', () => {
  it('aplica valores por defecto seguros', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      SWAGGER_ENABLED: false,
      TRUST_PROXY_HOPS: 0,
      RATE_LIMIT_MAX: 120,
      JWT_ACCESS_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 7,
      AUTH_MAX_FAILED_ATTEMPTS: 5,
      AUTH_LOCKOUT_MINUTES: 15,
      COOKIE_SECURE: true,
      MAIL_DRIVER: 'file',
    });
  });

  it('convierte la lista de orígenes y los booleanos', () => {
    const env = validateEnv({
      ...base,
      WEB_ORIGINS: 'http://localhost:5173, https://educore.example',
      SWAGGER_ENABLED: 'true',
    });
    expect(env.WEB_ORIGINS).toEqual(['http://localhost:5173', 'https://educore.example']);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('rechaza una URL que no es de PostgreSQL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://root@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('exige variables obligatorias', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*WEB_ORIGINS/);
  });

  it('acepta una configuración de producción completa', () => {
    expect(() => validateEnv(production)).not.toThrow();
  });

  it('exige HTTPS, cookies seguras y SMTP en producción', () => {
    expect(() => validateEnv({ ...production, WEB_ORIGINS: 'http://educore.example' })).toThrow(
      /HTTPS/,
    );
    expect(() => validateEnv({ ...production, APP_PUBLIC_URL: 'http://educore.example' })).toThrow(
      /APP_PUBLIC_URL/,
    );
    expect(() => validateEnv({ ...production, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => validateEnv({ ...production, MAIL_DRIVER: 'file' })).toThrow(/MAIL_DRIVER/);
  });

  it('exige un secreto JWT de al menos 32 caracteres', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'corto' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('solo permite el correo en memoria durante las pruebas', () => {
    expect(() => validateEnv({ ...base, MAIL_DRIVER: 'memory' })).toThrow(/MAIL_DRIVER/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', MAIL_DRIVER: 'memory' })).not.toThrow();
  });

  it('exige el servidor SMTP cuando se usa ese driver', () => {
    expect(() => validateEnv({ ...base, MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_HOST/);
  });

  it('no incluye valores de las variables en el mensaje de error', () => {
    try {
      validateEnv({ ...base, PORT: 'no-es-un-numero' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/PORT/);
      expect(String(error)).not.toContain('secreto-que-no-debe-aparecer');
    }
  });
});

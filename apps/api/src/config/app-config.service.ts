import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env } from './env.schema';

/** Acceso tipado a la configuración validada. Único punto de lectura del entorno. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get host(): string {
    return this.get('HOST');
  }

  get port(): number {
    return this.get('PORT');
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get webOrigins(): string[] {
    return this.get('WEB_ORIGINS');
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }

  get swaggerEnabled(): boolean {
    return this.get('SWAGGER_ENABLED');
  }

  get trustProxyHops(): number {
    return this.get('TRUST_PROXY_HOPS');
  }

  get rateLimit(): { ttlMs: number; max: number; authMax: number } {
    return {
      ttlMs: this.get('RATE_LIMIT_TTL_MS'),
      max: this.get('RATE_LIMIT_MAX'),
      authMax: this.get('AUTH_RATE_LIMIT_MAX'),
    };
  }

  get auth() {
    return {
      jwtSecret: this.get('JWT_ACCESS_SECRET'),
      accessTtlSeconds: this.get('JWT_ACCESS_TTL_SECONDS'),
      refreshTtlDays: this.get('REFRESH_TOKEN_TTL_DAYS'),
      refreshAbsoluteTtlDays: this.get('REFRESH_TOKEN_ABSOLUTE_TTL_DAYS'),
      maxFailedAttempts: this.get('AUTH_MAX_FAILED_ATTEMPTS'),
      lockoutMinutes: this.get('AUTH_LOCKOUT_MINUTES'),
      cookieSecure: this.get('COOKIE_SECURE'),
    };
  }

  get appPublicUrl(): string {
    return this.get('APP_PUBLIC_URL').replace(/\/+$/, '');
  }

  get storage() {
    return { driver: this.get('STORAGE_DRIVER'), localDir: this.get('STORAGE_LOCAL_DIR') };
  }

  get mail() {
    return {
      driver: this.get('MAIL_DRIVER'),
      from: this.get('MAIL_FROM'),
      outboxDir: this.get('MAIL_OUTBOX_DIR'),
      smtp: {
        host: this.get('SMTP_HOST'),
        port: this.get('SMTP_PORT'),
        secure: this.get('SMTP_SECURE'),
        user: this.get('SMTP_USER'),
        password: this.get('SMTP_PASSWORD'),
      },
    };
  }
}

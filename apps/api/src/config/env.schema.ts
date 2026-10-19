import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const postgresUrl = z
  .string()
  .url()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: 'Debe ser una URL de conexión de PostgreSQL',
  });

const originList = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url()).min(1));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    DATABASE_URL: postgresUrl,
    WEB_ORIGINS: originList,
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    SWAGGER_ENABLED: booleanString.default(false),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

    // Autenticación
    JWT_ACCESS_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    REFRESH_TOKEN_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    COOKIE_SECURE: booleanString.default(true),
    /** URL pública de la web, usada en los enlaces de los correos. */
    APP_PUBLIC_URL: z.string().url(),

    // Almacenamiento de archivos (privado). S3 se agregará en la Fase 5.
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('../../storage/files'),

    // Correo
    MAIL_DRIVER: z.enum(['file', 'smtp', 'memory']).default('file'),
    MAIL_FROM: z.string().min(3).default('EduCore <no-responder@educore.local>'),
    MAIL_OUTBOX_DIR: z.string().min(1).default('../../storage/dev-mail'),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_DRIVER === 'memory' && env.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DRIVER'],
        message: 'El driver "memory" solo se permite en pruebas',
      });
    }
    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'Requerido con MAIL_DRIVER=smtp',
      });
    }
    if (env.REFRESH_TOKEN_ABSOLUTE_TTL_DAYS < env.REFRESH_TOKEN_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_ABSOLUTE_TTL_DAYS'],
        message: 'No puede ser menor que REFRESH_TOKEN_TTL_DAYS',
      });
    }

    if (env.NODE_ENV !== 'production') return;
    const insecure = env.WEB_ORIGINS.filter((origin) => !origin.startsWith('https://'));
    if (insecure.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGINS'],
        message: `En producción todos los orígenes deben usar HTTPS: ${insecure.join(', ')}`,
      });
    }
    if (!env.APP_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_PUBLIC_URL'],
        message: 'En producción debe usar HTTPS',
      });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'En producción debe ser true',
      });
    }
    if (env.MAIL_DRIVER !== 'smtp') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DRIVER'],
        message: 'En producción debe ser "smtp"',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valida las variables de entorno al arrancar. Los mensajes de error indican
 * qué variable falla, pero nunca incluyen su valor (podría ser un secreto).
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${problems}`);
  }
  return result.data;
}

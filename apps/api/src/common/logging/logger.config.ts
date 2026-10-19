import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Params } from 'nestjs-pino';
import { type AppConfigService } from '../../config/app-config.service';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Rutas que nunca deben llegar al log. Es una defensa adicional: los
 * serializadores ya omiten cabeceras y cuerpos de las peticiones.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.documentNumber',
];

/**
 * Reutiliza el X-Request-Id entrante (p. ej. del proxy) si tiene un formato
 * seguro; si no, genera uno. Se devuelve en la respuesta para soporte.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function buildLoggerParams(config: AppConfigService): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      genReqId: resolveRequestId,
      redact: { paths: REDACTED_PATHS, censor: '[REDACTADO]' },
      // Solo los datos necesarios para operar: sin cuerpos, sin query string
      // (podría contener datos personales) y sin cabeceras completas.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/api/v1/health/live') ?? false,
      },
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
          : undefined,
    },
  };
}

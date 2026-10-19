import { type NestApplicationOptions, VersioningType } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { jsonBodyParser } from '../common/http/json-body-parser';
import { AppConfigService } from '../config/app-config.service';
import { CSRF_HEADER } from '../modules/auth/guards/csrf.guard';

export const API_PREFIX = 'api';
export const SWAGGER_PATH = 'api/docs';

/**
 * Opciones de creación de la app. El parser de Nest se desactiva porque
 * `configureApp` registra el suyo (solo JSON y con errores en formato EduCore).
 */
export const NEST_APP_OPTIONS = { bodyParser: false } satisfies NestApplicationOptions;

/**
 * Configuración HTTP común a la ejecución real y a las pruebas de integración,
 * para que ambas usen exactamente los mismos middlewares, rutas y cabeceras.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);

  // Solo se confía en X-Forwarded-* cuando hay proxies declarados; de lo
  // contrario, el rate limiting podría evadirse falsificando la cabecera.
  app.set('trust proxy', config.trustProxyHops);

  app.use(helmet());

  const allowedOrigins = new Set(config.webOrigins);
  app.enableCors({
    origin: (origin, callback) => {
      // Sin cabecera Origin: petición no originada en un navegador (curl, health checks).
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
      CSRF_HEADER,
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.use(...jsonBodyParser());
  // Solo se usa para leer la cookie de sesión en /auth (no hay cookies firmadas).
  app.use(cookieParser());

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('EduCore API')
        .setDescription(
          'API REST de EduCore, plataforma de gestión educativa de la familia PeopleCore.',
        )
        .setVersion('v1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, document);
  }

  app.enableShutdownHooks();
}

import { type DynamicModule, type Provider, type Type } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp, NEST_APP_OPTIONS } from '../../src/bootstrap/configure-app';

/**
 * Levanta la aplicación completa (mismos módulos y middlewares que producción).
 * `extraProviders` (y los módulos que necesiten, en `extraImports`) permiten
 * probar servicios que no forman parte de la API, como los del comando de
 * configuración inicial.
 */
export async function createTestApp(
  options: { extraProviders?: Provider[]; extraImports?: Array<Type | DynamicModule> } = {},
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(options.extraImports ?? [])],
    providers: options.extraProviders ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    ...NEST_APP_OPTIONS,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

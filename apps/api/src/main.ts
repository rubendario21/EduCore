import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, NEST_APP_OPTIONS, SWAGGER_PATH } from './bootstrap/configure-app';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...NEST_APP_OPTIONS,
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  configureApp(app);

  const config = app.get(AppConfigService);
  await app.listen(config.port, config.host);

  const url = await app.getUrl();
  logger.log(`EduCore API escuchando en ${url}/api/v1 (${config.nodeEnv})`, 'Bootstrap');
  if (config.swaggerEnabled) {
    logger.log(`Documentación Swagger en ${url}/${SWAGGER_PATH}`, 'Bootstrap');
  }
}

void bootstrap();

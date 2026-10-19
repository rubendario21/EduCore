import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Cliente Prisma de la aplicación. Se conecta con el rol `educore_app`
 * (solo DML) y abre conexiones de forma perezosa, así la API arranca aunque
 * la base no esté disponible y el health check lo informa.
 *
 * Fuera de `infrastructure/` solo los repositorios de cada módulo lo usan.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        application_name: 'educore-api',
        connectionTimeoutMillis: 5_000,
        statement_timeout: 30_000,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Comprueba la conexión y devuelve la latencia en milisegundos. */
  async ping(): Promise<number> {
    const start = performance.now();
    await this.$queryRaw`SELECT 1`;
    return Math.round(performance.now() - start);
  }
}

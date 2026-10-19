import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// El CLI de Prisma no carga .env por sí mismo. Las variables ya definidas en
// el entorno (p. ej. en CI o en la configuración de integración) tienen prioridad.
config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

// Rol dueño del esquema (educore_owner). La aplicación usa DATABASE_URL.
// `prisma generate` no se conecta, por eso la URL solo se exige al migrar.
const migrationUrl = process.env.DATABASE_MIGRATION_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(migrationUrl && { datasource: { url: migrationUrl } }),
});

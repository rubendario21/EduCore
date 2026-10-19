# EduCore

Plataforma web de gestión académica y administrativa para instituciones educativas, de la familia de productos **PeopleCore**.

> "La gestión educativa, conectada en un solo lugar" (eslogan provisional)

**Estado:** Fase 0 (fundaciones). La primera versión opera para **una sola institución**. Su modelo de datos está preparado para evolucionar a multi-tenant, pero **todavía no es multi-tenant** (ver `docs/00-diagnostico-y-plan.md`, sección 8).

## Requisitos

| Herramienta | Versión                   |
| ----------- | ------------------------- |
| Node.js     | 24 LTS (`.nvmrc`)         |
| npm         | 11+                       |
| PostgreSQL  | 15+ (desarrollado con 18) |

## Estructura

```
apps/api     API REST NestJS 11 + Prisma 7 (PostgreSQL), bajo /api/v1
apps/web     SPA React 19 + Vite 8 + Tailwind 4 + TanStack Query
infra/db     Scripts de creación de roles y bases de datos
docs/        Diagnóstico, arquitectura, decisiones y plan por fases
```

## Instalación en desarrollo

```bash
# 1. Dependencias (desde la raíz)
npm install

# 2. Base de datos local: crea apps/api/.env y .env.test con contraseñas
#    aleatorias, y luego los roles educore_owner / educore_app y las bases
#    educore_dev / educore_test. psql pide la contraseña del superusuario.
npm run db:setup:local

# 3. Migraciones (cuando existan; la Fase 0 aún no tiene tablas)
npm run prisma:migrate -w @educore/api

# 4. Levantar API (http://127.0.0.1:3000) y web (http://127.0.0.1:5173)
npm run dev
```

- La web usa el proxy de Vite (`/api` → API), así que web y API comparten origen, igual que en producción.
- Swagger está disponible en http://127.0.0.1:3000/api/docs cuando `SWAGGER_ENABLED=true`.
- Para configurar los `.env` a mano, cópialos desde `apps/api/.env.example`, `apps/api/.env.test.example` y `apps/web/.env.example`.

### Roles de base de datos

| Rol             | Uso                         | Privilegios                        |
| --------------- | --------------------------- | ---------------------------------- |
| `educore_owner` | CLI de Prisma (migraciones) | Dueño del esquema `public`         |
| `educore_app`   | La API en ejecución         | Solo `SELECT/INSERT/UPDATE/DELETE` |

La API **nunca** se conecta con el superusuario ni con el rol dueño.

## Comandos

| Comando                                  | Descripción                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                            | API y web en modo desarrollo                                                |
| `npm run build`                          | Compila la API (`apps/api/dist`) y la web (`apps/web/dist`)                 |
| `npm test`                               | Pruebas unitarias de API y web                                              |
| `npm run test:integration`               | Pruebas de integración de la API contra `educore_test` (aplica migraciones) |
| `npm run typecheck`                      | Verificación de tipos                                                       |
| `npm run lint` / `npm run format`        | ESLint / Prettier                                                           |
| `npm run prisma:migrate -w @educore/api` | Crea y aplica una migración en desarrollo                                   |
| `npm run prisma:deploy -w @educore/api`  | Aplica migraciones pendientes (producción)                                  |
| `npm run prisma:status -w @educore/api`  | Estado de las migraciones                                                   |

Las pruebas de integración se niegan a ejecutarse si la base configurada no termina en `_test`.

## Seguridad en este entorno

- El proyecto está dentro del `DocumentRoot` de WAMP. El `.htaccess` de la raíz bloquea todo acceso HTTP vía Apache (`Require all denied`). **No lo elimines.**
- Los archivos `.env*` están excluidos de Git; solo se versionan los `.env.example`.

## Documentación

- [Diagnóstico, arquitectura y plan](docs/00-diagnostico-y-plan.md)
- [Fase 0 · Fundaciones](docs/fases/fase-0-fundaciones.md)

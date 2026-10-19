# Fase 0 · Fundaciones

**Fecha:** 2026-10-18 · **Estado:** completada. Todas las pruebas pasan, incluidas las de integración contra `educore_test`.

## Alcance

1. Entorno: Node 24 LTS, Git y protección del directorio frente a Apache.
2. Monorepo con npm workspaces, TypeScript estricto, ESLint y Prettier.
3. API NestJS 11:
   - Configuración validada con Zod.
   - Logs estructurados con redacción de datos sensibles.
   - Formato único de errores.
   - Helmet, CORS restrictivo, rate limiting y `ValidationPipe` estricto.
   - Versionado `/api/v1` y Swagger.
   - Health checks.
4. Prisma 7 con el driver adapter de `pg` y separación entre el rol de migraciones y el rol de aplicación.
5. Scripts de creación de roles y bases (`educore_dev`, `educore_test`).
6. Web React 19 + Vite 8 + Tailwind 4:
   - Tokens de tema claro y oscuro.
   - Layout responsive con menú lateral.
   - Cliente HTTP centralizado.
   - Página de estado del sistema con datos reales de la API.
7. Pruebas unitarias (API y web) y de integración (API con PostgreSQL real).

Fuera de alcance: autenticación, usuarios, permisos, modelo de datos institucional. Todo eso es la Fase 1.

## Criterios de aceptación

| Criterio                                                                             | Estado                                         |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `npm run typecheck` sin errores en API y web                                         | ✅ Verificado                                  |
| `npm test` pasa (unitarias)                                                          | ✅ API 17/17, web 13/13                        |
| `npm run lint` sin errores                                                           | ✅ 0 errores, 1 advertencia (ver limitaciones) |
| `npm run build` genera `apps/api/dist` y `apps/web/dist`                             | ✅ Verificado                                  |
| La API arranca sin base de datos y lo informa (`/health` → 503 con formato estándar) | ✅ Verificado manualmente                      |
| `/api/v1/health/live` → 200; Swagger en `/api/docs` → 200                            | ✅ Verificado manualmente                      |
| El proxy de Vite enruta `/api` a la API                                              | ✅ Verificado manualmente                      |
| Apache no sirve el proyecto                                                          | ✅ `http://localhost/EduCore/` → 403           |
| Ningún secreto versionado (`.env*` ignorados)                                        | ✅ `git check-ignore` confirmado               |
| `npm audit` sin vulnerabilidades                                                     | ✅ 0 (con un override acotado, ver más abajo)  |
| `/api/v1/health` → 200 con la base conectada                                         | ✅ Verificado (prueba de integración)          |
| `npm run test:integration` pasa                                                      | ✅ 11/11                                       |

## Decisiones técnicas tomadas en esta fase

- **TypeScript 5.9.3** en lugar de 7.0. TS 7 es el compilador nativo nuevo, y `@nestjs/swagger` (peer `^5.5 || ^6`) y `typescript-eslint` (`<6.1`) aún no lo soportan.
- **Vitest + unplugin-swc** en la API. NestJS necesita los metadatos de tipo de los decoradores, que esbuild/oxc no emiten.
- **Prisma 7 con `moduleFormat = "cjs"`**. La API compila a CommonJS (estándar de NestJS 11). El cliente se genera en `src/generated/prisma` (ignorado por Git) antes de `dev`, `build`, `test` y `typecheck`.
- **Override de `js-yaml` a 5.5.0, solo para `@nestjs/swagger`.** Corrige el aviso GHSA-r3ph-w7gj-g6xm. Swagger solo usa `js-yaml.dump`, así que el riesgo era bajo, pero se corrigió sin subir de versión mayor. Hay que revisarlo al actualizar Swagger.
- **Parser JSON propio (`common/http/json-body-parser.ts`).** NestJS 11 convierte el `SyntaxError` de body-parser en un `BadRequestException` genérico antes de llegar a los filtros, y se pierde la causa. La prueba de integración lo detectó; la prueba unitaria original no, porque simulaba un error que en la práctica no llega al filtro. EduCore desactiva el parser de Nest (`NEST_APP_OPTIONS`), registra solo `express.json` (100 kb, sin `urlencoded`) y traduce el JSON malformado a `400 INVALID_JSON`.
- **Health check sin datos internos.** El cliente recibe `up/down`; la causa del fallo solo va al log del servidor.
- **Errores:** los mensajes de Nest (en inglés y con rutas internas) se sustituyen por mensajes propios en español con códigos estables.
- **Logs:** no se registran cuerpos, query strings ni cabeceras. `X-Request-Id` se reutiliza solo si tiene un formato seguro.
- **`packages/shared` no se crea todavía.** Se creará en la Fase 1 con el catálogo de permisos, para no tener módulos vacíos.

## Archivos creados

```
.gitignore .gitattributes .editorconfig .htaccess .nvmrc .prettierrc.json .prettierignore
eslint.config.mjs package.json package-lock.json tsconfig.base.json README.md
docs/00-diagnostico-y-plan.md  docs/fases/fase-0-fundaciones.md
infra/db/01-create-roles-and-databases.sql  infra/db/02-grant-app-privileges.sql  infra/db/setup-local.mjs
apps/api/  package.json tsconfig*.json nest-cli.json prisma.config.ts vitest.config.mts .env.example .env.test.example
           prisma/schema.prisma
           src/main.ts src/app.module.ts src/bootstrap/configure-app.ts
           src/config/{env.schema,app-config.service,app-config.module}.ts (+ spec)
           src/common/errors/{error-codes,app.exception,validation-exception.factory,all-exceptions.filter}.ts (+ spec)
           src/common/logging/logger.config.ts
           src/infrastructure/prisma/{prisma.service,prisma.module}.ts
           src/modules/health/{health.controller,health.dto,health.module}.ts (+ spec)
           test/http-platform.int-spec.ts test/setup/{global-setup,create-test-app}.ts
apps/web/  package.json tsconfig.json vite.config.ts index.html .env.example public/favicon.svg
           src/main.tsx src/index.css
           src/app/{brand,providers,query-client,router}.ts(x)
           src/lib/{api-client,theme,utils}.ts(x) (+ tests)
           src/components/theme-toggle.tsx src/components/ui/{button,card}.tsx
           src/layouts/app-shell.tsx
           src/features/system/{types.ts,services,hooks,components,pages}
           src/routes/{not-found-page,route-error-page}.tsx
           src/test/{setup.ts,render.tsx}
```

Archivos locales generados y **no versionados**: `apps/api/.env` y `apps/api/.env.test`, con contraseñas aleatorias.

## Migraciones

Ninguna. La Fase 0 no crea tablas. La primera migración (institución, usuarios, roles, permisos, auditoría) llega en la Fase 1.

## Cómo verificar

```bash
npm run db:setup:local        # una vez; pide la contraseña de postgres
npm run test:integration      # health 200, cabeceras, CORS, formato de errores, 413
npm run dev                   # abrir http://127.0.0.1:5173 → "Estado del sistema"
```

## Limitaciones conocidas

- ESLint emite una advertencia de `react-refresh` en `lib/theme.tsx`, porque exporta el provider y el hook juntos. Solo afecta al _hot reload_ de ese archivo.
- Prisma muestra un aviso de actualización a 8.0.0-rc. Se ignora deliberadamente, porque es una release candidate.
- La web aún no fija su propia CSP. Lo hará el proxy inverso en producción (Fase 5).
- No hay CI configurado (no hay remoto Git).

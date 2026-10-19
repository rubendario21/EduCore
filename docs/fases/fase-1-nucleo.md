# Fase 1 · Núcleo

**Inicio:** 2026-10-19 · **Estado:** completada (bloques 1A–1F)

La fase se entrega en bloques. Cada bloque cierra con sus pruebas ejecutadas y un informe.

| Bloque | Contenido                                                                                                                                        | Estado     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1A     | Modelo de datos núcleo, primera migración, catálogo de permisos, roles de sistema y comando de configuración inicial                             | Completado |
| 1B     | Autenticación: login, refresh rotativo, logout, recuperación y cambio de contraseña, bloqueo por intentos                                        | Completado |
| 1C     | Autorización por permisos y alcance (denegar por defecto), usuarios, perfiles, roles y auditoría                                                 | Completado |
| 1D     | Institución: datos, configuración regional, sedes y jornadas. Estructura académica: años, períodos, niveles, grados, grupos, áreas y asignaturas | Completado |
| 1E     | Web: login y recuperación, sesión, menú por permisos, dashboard y pantallas de administración                                                    | Completado |
| 1F     | Almacenamiento privado de archivos (driver local) y logo institucional                                                                           | Completado |

## Decisiones de diseño de la fase

1. **Roles por institución.** Los roles de sistema se definen en código como plantillas y se materializan en cada institución con `is_system = true`.
   - Sus permisos los gestiona el código: se sincronizan en cada arranque y no son editables.
   - La institución puede crear **roles personalizados** con permisos editables.
   - Así no hay roles con `institution_id` nulo, y la futura transición a multi-tenant no requiere rediseño.
2. **Catálogo de permisos en código** (`module.resource.action`), sincronizado con la tabla `permission` al arrancar. Un permiso eliminado del código deja de concederse.
3. **Permisos por petición.** Los permisos no viajan en el JWT: se cargan de la base en cada petición autenticada (una consulta). Una revocación de rol tiene efecto inmediato.
4. **Prevención de escalamiento.**
   - Un usuario solo puede asignar roles cuyos permisos ya posee.
   - Nadie puede desactivarse a sí mismo.
   - No se puede dejar la institución sin ningún administrador institucional activo.
5. **Altas de usuarios.** El administrador crea la cuenta sin contraseña y el sistema envía un enlace de activación de un solo uso (72 h). El administrador **nunca** conoce ni define la contraseña del usuario.
6. **Correo en desarrollo.** El proveedor de desarrollo escribe los mensajes como archivos `.eml` en `storage/dev-mail/` (fuera de Git) y no en el log, para que los tokens de recuperación no terminen en los registros.
7. **Comando de configuración inicial** (`npm run setup:institution -w @educore/api`). Crea la institución, su configuración, los roles de sistema y el primer administrador a partir de un archivo local no versionado. Se niega a crear una segunda institución, porque la v1 es monoinstitución.
8. **Política de contraseñas** (alineada con NIST SP 800-63B):
   - Longitud de 10 a 128 caracteres.
   - Lista de contraseñas comunes prohibidas.
   - Distinta del correo.
   - Sin reglas de composición forzadas ni caducidad periódica.

## Alcance

### Datos (migración `0001_core`)

- **Institución:** `institution`, `institution_settings`, `campus`, `shift`.
- **Identidad y acceso:** `user`, `person`, `user_institution`, `role`, `permission`, `role_permission` (con `scope`), `membership_role`.
- **Sesiones y tokens:** `user_session`, `password_token` (recuperación y activación).
- **Auditoría:** `audit_log`, de solo inserción. El rol `educore_app` no tiene `UPDATE` ni `DELETE` sobre ella.
- **Estructura académica:** `academic_year`, `academic_period`, `education_level`, `grade`, `school_group`, `subject_area`, `subject`.
- **Extensiones:** `citext` para correos sin distinción de mayúsculas.

### API

- `auth/*`: `login`, `refresh`, `logout`, `me`, `password/forgot`, `password/reset`, `password/change`.
- `users/*`, `roles/*`, `permissions`, `audit-logs`, `me/profile`.
- `institution`, `institution/settings`, `institution/branding` (público: solo nombre, colores y logo), `campuses/*`, `shifts/*`.
- `academic-years/*` (con períodos), `education-levels/*`, `grades/*`, `school-groups/*`, `subject-areas/*`, `subjects/*`.
- `dashboard/summary`.

### Web

- Inicio de sesión, recuperación de contraseña y activación de cuenta.
- Sesión persistente mediante refresh.
- Layout con menú según los permisos del usuario.
- Dashboard con conteos reales.
- Usuarios, roles, institución (datos, sedes, jornadas), estructura académica, auditoría y perfil (con cambio de contraseña).

## Criterios de aceptación

1. Todas las tablas institucionales tienen `institution_id NOT NULL` y sus índices únicos lo incluyen. Una **prueba automática** recorre el modelo Prisma y lo verifica.
2. Las contraseñas se guardan con **Argon2id**. Ninguna respuesta, log ni registro de auditoría contiene contraseñas, hashes ni tokens.
3. **Login:** con credenciales correctas emite un access token y una cookie de refresh `httpOnly; SameSite=Strict`. Con un correo inexistente o una contraseña errónea responde lo mismo (`401 INVALID_CREDENTIALS`).
4. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos. El endpoint de login tiene un límite por IP.
5. **Refresh:** rota el token. Reutilizar un refresh token ya rotado revoca toda la familia de sesiones. Exige el encabezado anti-CSRF.
6. **Recuperación:** `forgot` responde `202` exista o no el correo. El token es de un solo uso y vence en 30 minutos. El restablecimiento revoca todas las sesiones.
7. **Autorización:** **todo** endpoint no público exige un permiso declarado. Una prueba recorre todas las rutas registradas y falla si alguna no declara `@Public`, `@Authenticated` o `@RequirePermissions`.
8. **Matriz de autorización probada:** para cada endpoint protegido, un usuario sin el permiso recibe `403` y uno sin sesión recibe `401`.
9. **Escalamiento:** no se puede asignar un rol con permisos que el asignador no tiene, desactivarse a sí mismo ni dejar la institución sin administrador.
10. **Duplicados:** un correo duplicado da `409 EMAIL_ALREADY_REGISTERED` y un documento duplicado en la institución da `409 PERSON_DOCUMENT_TAKEN`. Igual para los códigos de sedes, grados, grupos y asignaturas.
11. Las operaciones que modifican datos registran una entrada en `audit_log` (actor, acción, entidad, cambios sin datos sensibles, IP y `requestId`).
12. **Estructura académica:**
    - Fechas coherentes.
    - Períodos sin solapes y dentro del año.
    - Suma de pesos de los períodos = 100 % para poder activar un año.
    - Un único año activo por institución.
13. Los listados están paginados (`page`, `pageSize` ≤ 100) y devuelven `{ data, meta }`.
14. **Web:** cada pantalla tiene estados de carga, error, vacío y éxito; los formularios se validan con Zod con mensajes en español; el menú solo muestra lo autorizado.
15. `npm run typecheck`, `npm run lint`, `npm test` y `npm run test:integration` pasan.

---

## Informe · Bloque 1A (2026-10-19)

### Qué se construyó

- **`@educore/shared`**: catálogo de 17 permisos, 7 roles de sistema y enums de dominio. La API lo consume compilado (CommonJS); la web, desde el código fuente (condición `educore-source` de Vite).
- **Migración `20261019045336_core`**: 21 tablas y 8 tipos enumerados. Además de lo que genera Prisma, se añadieron a mano:
  - extensiones `citext` y `btree_gist`;
  - una sola sede principal y un solo año lectivo activo por institución;
  - períodos sin solapamiento (`EXCLUDE USING gist`);
  - validaciones de fechas, pesos, año, capacidad y dígito de verificación del NIT;
  - auditoría de solo inserción (`REVOKE UPDATE, DELETE, TRUNCATE` a `educore_app`);
  - `ON DELETE RESTRICT` en `audit_log → institution` (Prisma proponía `SET NULL`).
- **Sincronización de permisos y roles de sistema** en cada arranque, con advisory lock.
- **Auditoría** (`AuditService`, `diffChanges` sin campos sensibles).
- **Contraseñas**: Argon2id (parámetros OWASP) y política NIST.
- **Comando `setup:institution`**: configuración inicial transaccional desde `setup/institution.local.json` (ignorado por Git). Se niega a crear una segunda institución.

### Verificaciones

| Verificación                                    | Resultado                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `prisma migrate diff` tras aplicar la migración | Migración vacía: Prisma **no** intentará revertir las reglas manuales                                              |
| Pruebas unitarias API / web                     | 49/49 · 13/13                                                                                                      |
| Pruebas de integración (PostgreSQL real)        | 27/27                                                                                                              |
| Comando real contra `educore_test`              | Contraseña débil rechazada, institución creada, segunda ejecución rechazada, archivo inexistente con mensaje claro |
| Tipos / lint / formato                          | Sin errores (1 advertencia conocida en `theme.tsx`)                                                                |

### Incidencias

- Las contraseñas de los roles de PostgreSQL dejaron de coincidir con los `.env` tras una edición manual. Se resolvió restaurando las contraseñas generadas y volviendo a ejecutar `db:setup:local`. **Recomendación:** no editar a mano las URL de conexión; volver a ejecutar el script.

### Cómo verificar

```bash
npm run test:integration
cp apps/api/setup/institution.example.json apps/api/setup/institution.local.json   # y editar con los datos reales
npm run setup:institution -w @educore/api
```

---

## Informe · Bloque 1B (2026-10-19)

### Qué se construyó

- **Endpoints `/api/v1/auth`:** `login`, `refresh`, `logout`, `me`, `password/forgot`, `password/reset` (recuperación y activación), `password/change`.
- **Token de acceso JWT (HS256, 15 min):** lista explícita de algoritmos, `issuer` y `audience`. En cada petición se verifica también en la base que la sesión no esté revocada y que la cuenta siga activa, así que logout y suspensión tienen efecto inmediato.
- **Refresh token opaco de 256 bits** en una cookie `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. En la base solo se guarda su SHA-256.
  - Rota en cada uso.
  - La reutilización revoca toda la familia y se audita.
  - Hay un margen de 10 s para carreras entre pestañas (`SESSION_ROTATED`, el cliente reintenta).
  - Expiración deslizante de 7 días, con un tope absoluto de 30.
- **CSRF:** `SameSite=Strict`, el encabezado `X-EduCore-CSRF: 1` y verificación de `Origin` en `refresh` y `logout`.
- **Fuerza bruta:**
  - Bloqueo de 15 min tras 5 fallos.
  - Límite por IP (`AUTH_RATE_LIMIT_MAX`) solo en los endpoints marcados con `@AuthRateLimit()`.
  - Verificación Argon2 ficticia cuando el correo no existe, para que el tiempo de respuesta no lo delate.
- **Recuperación y activación:**
  - Tokens de un solo uso (consumo atómico): 30 min para recuperación y 72 h para activación.
  - Solo el último token es válido, con un máximo de 3 por hora.
  - Una contraseña débil no consume el token.
  - El restablecimiento revoca todas las sesiones; el cambio de contraseña, todas menos la actual.
- **Correo:** `MailService` con drivers `file` (`.eml` en `storage/dev-mail`), `smtp` y `memory` (solo pruebas), y plantillas en español con HTML escapado.
  - Corrección: el correo de activación se prepara dentro de la transacción y se envía solo tras confirmarla.
- **Autenticación global por defecto:** `JwtAuthGuard` como `APP_GUARD`; las excepciones se marcan con `@Public()`.

### Configuración nueva

`JWT_ACCESS_SECRET` (aleatoria, ≥32 caracteres), `JWT_ACCESS_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `REFRESH_TOKEN_ABSOLUTE_TTL_DAYS`, `AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_MINUTES`, `AUTH_RATE_LIMIT_MAX`, `COOKIE_SECURE`, `APP_PUBLIC_URL`, `MAIL_*` y `SMTP_*`.

En producción se exige HTTPS en `APP_PUBLIC_URL`, `COOKIE_SECURE=true` y `MAIL_DRIVER=smtp`.

Corrección: `WEB_ORIGINS` incluye ahora `http://127.0.0.1:5173`, el origen real de Vite.

### Verificaciones

| Verificación                       | Resultado                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pruebas unitarias API / web        | 55/55 · 13/13                                                                                                                                          |
| Pruebas de integración             | 60/60 (33 de autenticación y 2 del límite por IP)                                                                                                      |
| Prueba manual con la API compilada | health público, 401 sin token, credenciales inválidas genéricas, `forgot` → 202, CSRF → 403, 7 rutas en Swagger, 17 permisos sincronizados al arrancar |
| Tipos / lint / formato             | Sin errores (1 advertencia conocida)                                                                                                                   |

### Limitaciones

- Las respuestas de bloqueo (`ACCOUNT_LOCKED`) revelan que la cuenta existe a quien ya hizo 5 intentos. Se acepta como compromiso de usabilidad; el límite por IP lo mitiga.
- La autorización por permisos (denegar por defecto si un endpoint no declara permiso) llega en el bloque 1C.

---

## Informe · Bloque 1C (2026-10-19)

### Qué se construyó

- **Autorización con "denegar por defecto"** (`PermissionsGuard`, global, después de `JwtAuthGuard`). Toda ruta declara `@Public()`, `@Authenticated()` o `@RequirePermissions(...)`; una ruta sin declaración se rechaza siempre y se registra en el log.
- **Alcances:** el catálogo de `@educore/shared` define qué alcances admite cada permiso (`allowedScopes`, por defecto solo `ALL`). Los alcances `ASSIGNED`, `OWN` y `LINKED` se habilitarán cuando sus módulos filtren los datos según ellos.
- **Prevención de escalada de privilegios** (`missingGrants`):
  - nadie concede (en un rol o a un usuario) permisos que no tiene;
  - nadie gestiona (edita, suspende, cambia roles) a un usuario con permisos que él no tiene;
  - nadie cambia su propio estado ni sus propios roles;
  - nunca queda la institución sin administrador activo, con un advisory lock por institución contra operaciones simultáneas.
- **Usuarios** (`/users`): listado paginado con búsqueda y filtros, consulta, creación (cuenta invitada y correo de activación tras confirmar), edición, suspensión y reactivación (suspender revoca las sesiones), reemplazo de roles y envío de correo de acceso (activación o recuperación).
- **Perfil propio** (`/me/profile`): consulta, y edición de teléfono y dirección.
- **Roles** (`/roles`, `/permissions`): catálogo, roles de sistema de solo lectura y roles personalizados (crear, editar, eliminar sin usuarios) con validación de permisos, alcances y duplicados.
- **Auditoría** (`/audit-logs`): consulta paginada por institución, con filtros por acción (exacta o por prefijo), entidad, actor y fechas, y nombre del actor.
- **Aislamiento institucional:** todas las consultas filtran por `institutionId`. Un identificador de otra institución responde 404 (verificado en pruebas).
- **Paginación común** (`page`, `pageSize` ≤ 100, `{ data, meta }`).
- **Red de seguridad para duplicados:** `P2002`/`P2003` de Prisma se traducen a `409`.

### Verificaciones

| Verificación                | Resultado                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pruebas unitarias API / web | 65/65 · 13/13                                                                                                        |
| Pruebas de integración      | 99/99 (inventario de rutas y matriz de autorización, usuarios, roles y auditoría)                                    |
| Inventario de rutas         | Todas declaran su acceso; las rutas públicas son exactamente las 7 previstas                                         |
| Matriz de autorización      | Toda ruta protegida responde 401 sin sesión y toda ruta con permisos responde 403 a un usuario sin ellos             |
| Pruebas de mutación         | Quitar `@RequirePermissions` de `GET /users` y desactivar `assertCanGrant` hacen fallar las pruebas correspondientes |
| API compilada               | 25 operaciones en Swagger; rutas nuevas → 401 sin sesión; 0 errores en el log                                        |
| Tipos / lint / formato      | Sin errores (1 advertencia conocida)                                                                                 |

### Limitaciones

- La importación masiva de usuarios (CSV/XLSX) queda para la Fase 2, junto con estudiantes y acudientes.
- Cambiar el correo de una cuenta vinculada a más de una institución está bloqueado (`EMAIL_MANAGED_ELSEWHERE`) hasta la fase multi-tenant.

---

## Informe · Bloque 1D (2026-10-19)

### Qué se construyó

- **Institución** (`/institution`, `/institution/settings`, `/institution/branding`):
  - Datos generales, con validación del **dígito de verificación del NIT** (algoritmo DIAN, módulo 11). El DV es obligatorio si hay NIT.
  - Configuración regional: zona horaria IANA y moneda ISO 4217, validadas con `Intl`.
  - Marca: colores `#RRGGBB`.
  - Preferencias: `guardianAbsenceExcusesEnabled`.
  - `/institution/branding` es **pública**: devuelve solo nombre y colores, para la pantalla de inicio de sesión. Se añadió a la lista de rutas públicas previstas. En la v1 resuelve la única institución activa; en multi-tenant se resolverá por dominio.
- **Sedes y jornadas** (`/campuses`, `/shifts`): códigos únicos en mayúsculas y una sola sede principal. No se puede desactivar la sede principal, la última sede o jornada activa, ni una sede o jornada con grupos activos en años no cerrados. No se borran: se desactivan.
- **Catálogo académico** (`/education-levels`, `/grades`, `/subject-areas`, `/subjects`): códigos únicos y referencias activas de la misma institución. No se puede desactivar un nivel con grados activos, un área con asignaturas activas ni un grado con grupos abiertos.
- **Años lectivos y períodos** (`/academic-years`, `/academic-years/:id/periods`, `/academic-periods/:id`):
  - Estados _PLANNING → ACTIVE → CLOSED_. Un año dura como máximo 18 meses, lo que admite el calendario B.
  - Períodos dentro del año, sin solaparse y con número único. Los pesos se comparan en centésimas (33,33 + 33,33 + 33,34 = 100).
  - **Activar** exige períodos consecutivos que sumen exactamente 100 % y que no haya otro año activo.
  - Con el año activo solo se renombran los períodos; un año cerrado es de solo lectura.
  - Concurrencia: bloqueo `FOR UPDATE` del año, transición condicionada al estado esperado y el índice único parcial de la base como última barrera.
- **Grupos** (`/school-groups`): año, grado, sede y jornada activos de la institución; código único por año y sede; inmutables en años cerrados.
- **Utilidades comunes:** validación de NIT y de fechas `AAAA-MM-DD` reales, y decoradores `IsCalendarDate`, `Trim`, `EmptyToNull` y `UpperCode`.
- Todo cambio queda en la auditoría con el antes y el después.

### Verificaciones

| Verificación                                 | Resultado                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Algoritmo del NIT                            | Coincide con el DV publicado de 5 entidades reales (DIAN, MEN, Universidad Nacional, Bancolombia, Davivienda)     |
| Pruebas de integración nuevas                | Institución (12) y estructura académica (17), incluida la activación simultánea de dos años: solo una tiene éxito |
| Inventario de rutas y matriz de autorización | Cubren automáticamente las 35 rutas nuevas                                                                        |
| Pruebas unitarias API / web                  | 74/74 · 13/13                                                                                                     |
| Pruebas de integración (todas)               | 128/128 en 10 archivos                                                                                            |
| Tipos / lint / formato                       | Sin errores (1 advertencia conocida)                                                                              |

### Incidencias

- En la primera ejecución fallaron 2 pruebas por **datos de prueba inválidos** (nombres de período de menos de 3 caracteres): la API los rechazó correctamente. Se corrigieron las pruebas.

### Propuesta pendiente de decisión

- **Plantilla académica colombiana opcional:** precargar niveles (Preescolar, Básica primaria, Básica secundaria, Media), grados (Prejardín a Undécimo) y áreas obligatorias (Ley 115, art. 23) para no capturarlos a mano. No se implementó para no imponer una estructura sin confirmación.

---

## Informe · Bloque 1E (2026-10-19)

### Qué se construyó

**API**

- `GET /dashboard/summary` (permiso `dashboard.summary.read`): usuarios por estado y rol, sedes, jornadas, grados, asignaturas, año activo, período en curso (en la zona horaria de la institución) y grupos.
- Distingue **cero** (`0`) de **sin datos** (`null`). Fórmulas en `docs/indicadores.md`.

**Web**

- **Sesión:**
  - El token de acceso vive solo en memoria.
  - La sesión se recupera al recargar con la cookie `httpOnly`.
  - Hay **una sola renovación compartida**, incluso con el doble efecto de StrictMode o con varias peticiones a la vez.
  - Si el token vence, se renueva y se reintenta la petición una vez.
  - `SESSION_ROTATED` (carrera entre pestañas) se reintenta automáticamente.
- **Pantallas públicas:**
  - Inicio de sesión con la marca de la institución.
  - Recuperación de contraseña.
  - Definir contraseña: restablecer y activar cuenta. El token se borra de la URL.
  - `<meta name="referrer" content="no-referrer">` para que los enlaces con token no se filtren.
- **Marca institucional:** los colores configurados se aplican al tema claro, con texto legible calculado por contraste WCAG.
- **Navegación por permisos:** manifiesto del menú (`app/navigation.ts`), `RequirePermission` en cada ruta ("Acceso denegado") y `RequireAuth`. La API sigue verificando siempre.
- **Pantallas:**
  - Inicio (dashboard o bienvenida).
  - Usuarios: lista con búsqueda, filtros y paginación; alta; detalle con edición, roles, suspensión con confirmación y correo de acceso.
  - Roles: lista, y editor con permisos por módulo, roles de sistema de solo lectura y eliminación.
  - Institución: datos con validación del NIT, configuración regional y de marca, sedes y jornadas.
  - Estructura académica: años lectivos con detalle, períodos, activación y cierre; niveles y grados; áreas y asignaturas; grupos por año.
  - Auditoría: filtros y detalle de cambios antes y después.
  - Mi perfil: datos de contacto y cambio de contraseña.
- **Componentes reutilizables:**
  - `CatalogManager`: tabla y diálogo de alta y edición para 7 catálogos, con eliminación opcional.
  - Formularios con React Hook Form y Zod, y errores de la API llevados a cada campo.
  - Estados de carga, vacío y error, y avisos (Sonner).
  - Diálogos y pestañas accesibles (Radix).

### Correcciones durante el bloque

- **Ejemplo de configuración:** el NIT `900000000` llevaba DV `0`; el correcto es `5`. Se corrigió y el comando `setup:institution` **ahora valida el DV** como la API. La nueva validación detectó además un DV mal escrito en una prueba de integración, que también se corrigió.
- **Página de definir contraseña:** el token se borraba de la URL dentro del inicializador del estado, que React puede ejecutar dos veces. Se movió a un efecto.
- **Errores de casillas:** `CatalogManager` no mostraba el error de la API en los campos de tipo casilla (p. ej. desmarcar la sede principal).
- **Textos:** gramática de las listas vacías ("No hay años lectivos todavía"), barra de desplazamiento sobrante en las pestañas en Windows, y `watch()` sustituido por `useWatch()` (compatible con el compilador de React).

### Pruebas

| Verificación                | Resultado                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Pruebas unitarias API / web | 76/76 · 25/25 (12 nuevas de web: sesión, renovación única, menú por permisos, contraste, login, rutas protegidas) |
| Pruebas de integración      | 131/131 en 11 archivos (incluye el dashboard)                                                                     |
| Tipos / lint / formato      | Sin errores (2 advertencias de _fast refresh_)                                                                    |

### Verificación en navegador real

Con la API apuntando a `educore_test`, con la institución de ejemplo:

- Sin sesión, `/` redirige a `/iniciar-sesion`, que muestra la marca del colegio.
- El inicio de sesión lleva al dashboard con datos reales; el año activo aparece como "Sin datos".
- Usuarios, Estructura académica e Institución cargan. Cada navegación con recarga completa **recupera la sesión** con la cookie.
- Crear un año lectivo:
  - el formulario vacío muestra las validaciones en español;
  - lleno, crea el año y lo lista como "En planeación".
- Agregar un período del 60 % e intentar activar el año: aparece la confirmación y la API rechaza con "Los pesos de los períodos suman 60 % y deben sumar 100 %".

### Limitaciones

- La API mostró una vez la advertencia de `pg` _"Calling client.query() when the client is already executing a query"_. No afecta el funcionamiento actual, pero la versión 9 de `pg` lo convertirá en error. Queda pendiente identificar el origen (probablemente el adaptador de Prisma).
- ESLint mantiene 2 advertencias de _fast refresh_ en `auth-context.tsx` y `theme.tsx` (proveedor y hook en el mismo archivo, patrón estándar).
- Pantallas de estudiantes, docentes, matrícula, etc.: fases siguientes.

---

## Informe · Bloque 1F (2026-10-19)

### Qué se construyó

- **Migración `20261019155624_stored_files`:** solo agrega estructuras.
  - Tipo `file_classification` (`INSTITUTIONAL`, `PERSONAL`, `SENSITIVE`).
  - Tabla `stored_file` con los metadatos (nombre original, tipo, tamaño, SHA-256, quién lo subió).
  - Columna `institution_settings.logo_file_id`, como clave foránea real.
  - Validaciones de tamaño positivo y formato del SHA-256.
- **Almacenamiento privado:**
  - Interfaz `StorageDriver` y driver local (`STORAGE_LOCAL_DIR`, por defecto `storage/files`; en pruebas, `storage/test-files`).
  - Las claves las genera el servidor (`institutions/{id}/{año}/{mes}/{uuid}`) y se valida que no salgan de la carpeta raíz.
  - Escritura atómica; nunca se sobrescribe un archivo.
  - El contenido **no** se guarda en la base.
- **Validación de archivos por contenido (firma):**
  - PNG, JPEG, WebP y PDF se reconocen por sus primeros bytes; **SVG no** (puede contener scripts).
  - Un archivo "logo.png" con contenido SVG o HTML se rechaza (415).
  - Límite de tamaño (413).
- **Descargas** (`GET /files/:id`, con sesión):
  - Los archivos institucionales los descarga cualquier miembro de la institución.
  - Los personales y sensibles, por ahora solo quien los subió; sus módulos definirán reglas por alcance.
  - Un archivo de otra institución responde 404.
  - Cabeceras seguras: `nosniff`, CSP `sandbox`, `Content-Disposition` y `Cache-Control: private, no-store`.
- **Logo** (`POST`/`DELETE /institution/logo`, permiso de configuración; `GET /institution/branding/logo` público):
  - PNG, JPEG o WebP de hasta 2 MB.
  - `logoUrl` cambia con cada logo para invalidar cachés.
  - Al quitarlo, el archivo se conserva por trazabilidad.
  - Todo queda en la auditoría.
- **Web:** tarjeta "Logo" en Institución → Configuración (vista previa, cambiar, quitar) y `BrandMark` en el inicio de sesión y el menú lateral.

### Verificaciones

- Pruebas nuevas:
  - Unitarias (6): detección por contenido, nombres seguros, driver local (path traversal, no sobrescribir, escritura atómica).
  - Integración (9): ciclo completo del logo, rechazos, permisos y aislamiento entre instituciones.
- **Navegador:** el logo subido aparece en la pantalla de inicio de sesión, en el menú lateral y en la tarjeta de Configuración.
- Un defecto encontrado al escribir las pruebas: `rename` sobrescribía el destino. Corregido.

### Incidencia operativa

- Durante la verificación, los puertos 3000 y 5173 estaban ocupados: por una API de desarrollo conectada a `educore_dev` (con los datos reales del colegio) y por un Vite huérfano de una verificación anterior.
- Un comando de prueba alcanzó esa API: registró **un intento de inicio de sesión fallido** con el correo de demostración y **un intento de subida sin token**, que no se completó. No se modificaron datos.
- La verificación se repitió en puertos propios (3100/5174), comprobando antes que respondía la base de pruebas.
- **Aprendizaje:** `npx vite` deja el proceso de Node vivo al detener la tarea; hay que cerrarlo por puerto.

### Pendiente

- Driver S3 (Fase 5, con el despliegue).
- Limpieza de archivos huérfanos (contenido escrito sin registro por una transacción fallida).

---

## Cierre de la Fase 1

| Verificación final                       | Resultado                                                             |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Pruebas unitarias API / web              | 83/83 · 25/25                                                         |
| Pruebas de integración (PostgreSQL real) | 139/139 en 12 archivos                                                |
| Tipos / formato                          | Sin errores                                                           |
| Lint                                     | 0 errores, 2 advertencias de _fast refresh_ (proveedor + hook)        |
| Migraciones                              | 2 (`core`, `stored_files`), sin diferencias pendientes con el esquema |

Los 15 criterios de aceptación de la fase están cubiertos por pruebas automáticas:

- autenticación y recuperación;
- autorización con "denegar por defecto" e inventario de rutas;
- prevención de escalamiento y del último administrador;
- duplicados;
- auditoría de solo inserción;
- reglas de años y períodos;
- paginación;
- aislamiento entre instituciones;
- estados de interfaz y validaciones en español.

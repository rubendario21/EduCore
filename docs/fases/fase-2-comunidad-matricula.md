# Fase 2 · Comunidad y matrícula

**Inicio:** 2026-10-19 · **Estado:** en curso

| Bloque | Contenido                                                                                                                       | Estado     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 2A     | Estudiantes, acudientes y sus vínculos, personal y docentes, y acceso al portal                                                 | Completado |
| 2B     | Matrícula por año: ubicación en grupo con historial, retiro, traslado y renovación                                              | Pendiente  |
| 2C     | Plan de estudios (asignaturas e intensidad horaria por grado), asignación docente y plantilla académica colombiana **opcional** | Pendiente  |
| 2D     | Admisiones: solicitudes, documentos, revisión, aprobación y paso a matrícula                                                    | Pendiente  |
| 2E     | Autorizaciones de tratamiento de datos (Ley 1581)                                                                               | Pendiente  |
| 2F     | Importación masiva desde CSV/XLSX con informe por fila                                                                          | Pendiente  |
| 2G     | Pantallas web de todo lo anterior                                                                                               | Pendiente  |

## Decisiones de diseño

1. **Una persona, varios papeles.** `person` (Fase 1) es la base. Estudiante, acudiente y miembro del personal son **perfiles** que apuntan a una persona (`student`, `guardian`, `staff_member`, cada uno con `person_id` único). Una docente que además es acudiente es **una sola persona** con dos perfiles; sus datos no se duplican.
2. **La cuenta de acceso es opcional.** Un estudiante o acudiente existe aunque no tenga usuario. "Dar acceso al portal" crea la membresía con el rol `STUDENT` o `GUARDIAN` y envía la activación (flujo de la Fase 1).
3. **Vínculo estudiante–acudiente:**
   - Guarda el **parentesco**, quién es el **acudiente principal**, quién es el **representante legal** (quien autoriza el tratamiento de datos del menor, Ley 1581 art. 7) y si **vive con el estudiante**.
   - Un estudiante puede tener varios acudientes, y un acudiente, varios estudiantes.
   - Debe haber exactamente un acudiente principal cuando hay acudientes.
4. **Historial que no se pierde:**
   - Los estudiantes no se borran: cambian de estado (activo, retirado, egresado).
   - En la matrícula (2B), los cambios de grupo se registran con fechas de inicio y fin.
   - Retiros y traslados guardan fecha y motivo.
5. **Datos sensibles fuera de esta fase.** No se registran todavía datos de salud ni de discapacidad (Ley 1581 art. 5). Su tratamiento exige reglas de acceso específicas y una revisión jurídica.
6. **Alcances de permisos:**
   - En 2A, el personal administrativo consulta y gestiona con alcance `ALL`.
   - El alcance `ASSIGNED` (el docente solo ve los estudiantes de sus cursos) se habilita en 2C, cuando exista la asignación docente.
   - El alcance `LINKED` (el acudiente solo ve a sus estudiantes) se habilita con el portal.

7. **Opciones que decide cada institución** (decisión del usuario, 2026-10-19):
   - **Plantilla académica colombiana:** acción opcional e idempotente que precarga niveles (Preescolar, Básica primaria, Básica secundaria, Media), grados (Prejardín a Undécimo) y áreas obligatorias (Ley 115, art. 23). Todo lo creado se puede editar o desactivar después. Si la institución no la aplica, arma su estructura a mano.
   - **Reglas del SIEE:** ninguna escala de calificación ni regla de promoción fija en el código. En la Fase 3, cada institución configura su escala numérica, los rangos de cada nivel de desempeño (Superior, Alto, Básico, Bajo según el Decreto 1290, o los suyos), la nota mínima de aprobación y las reglas de promoción.

## Criterios de aceptación de la fase

1. **Duplicados:**
   - Un mismo documento no crea dos personas en la institución.
   - Registrar como acudiente a alguien que ya existe (p. ej. una docente) **reutiliza** su persona.
2. Un estudiante tiene como máximo **una matrícula vigente por año**, protegido por la base de datos y probado con solicitudes simultáneas.
3. El cupo de un grupo no se supera, ni siquiera con matrículas simultáneas.
4. **Historial:**
   - El cambio de grupo, el retiro y el traslado conservan el historial con fechas y motivo.
   - Ninguna operación borra datos académicos.
5. **Asignación docente:**
   - Solo se asignan docentes activos.
   - Una asignatura de un grupo tiene un único docente titular vigente.
6. Con `ASSIGNED`, el docente solo ve los estudiantes de sus cursos (probado con identificadores manipulados).
7. **Admisión:** el flujo _borrador → enviada → en revisión → aprobada / rechazada / en espera → matriculada_ solo admite transiciones válidas, y cada transición queda auditada.
8. **Documentos de admisión:** se guardan como archivos `PERSONAL`, con descarga protegida.
9. **Importación masiva:**
   - Primero valida todo el archivo y muestra un informe por fila, sin guardar nada.
   - Luego importa en una transacción, todo o nada.
10. **Autorizaciones de datos:** se registra quién autoriza, para qué estudiante, la versión de la política, la fecha y el medio.
11. Todas las rutas nuevas pasan el inventario de autorización (401/403) y las reglas de aislamiento institucional.
12. `npm run typecheck`, `npm run lint`, `npm test` y `npm run test:integration` pasan.

---

## Informe · Bloque 2A (2026-10-19)

### Qué se construyó

- **Migración `20261019162118_community`:** tablas `student`, `guardian`, `student_guardian` y `staff_member`, más índice único parcial: **un solo acudiente principal por estudiante**. Solo agrega estructuras.
- **Migración `20261019163029_person_search`:** columna derivada `person.search_text` (minúsculas, sin tildes), calculada por un trigger con la extensión `unaccent`. Las búsquedas de personas y de usuarios ya no distinguen tildes ni mayúsculas.
- **Estudiantes** (`/students`): listado con búsqueda y filtro de estado; registro con código opcional; edición de datos, código y estado; vínculos con acudientes (`POST/PATCH/DELETE /students/:id/guardians`); acceso al portal.
- **Acudientes** (`/guardians`): registro, edición, consulta con sus estudiantes y acceso al portal.
- **Personal** (`/staff`): docentes, directivos, administrativos y de apoyo, con cargo, fecha de ingreso y estado. Acceso con los roles indicados.
- **Reutilización de personas:**
  - Un documento existente se reutiliza si el nombre coincide, ignorando mayúsculas, tildes y espacios.
  - Si no coincide, se rechaza (`PERSON_DATA_MISMATCH`).
  - Una docente que también es acudiente es **una sola persona**.
- **Reglas de los vínculos:**
  - El primer acudiente es el principal.
  - Marcar otro como principal desplaza al anterior.
  - No se puede quitar ni desmarcar el principal mientras haya otros.
  - Un estudiante no es su propio acudiente.
  - Las operaciones bloquean al estudiante (`FOR UPDATE`).
- **Acceso al portal** (`UsersService.grantAccessToPerson`): crea la membresía para una persona existente, con las mismas reglas de la Fase 1. Exige los permisos de gestión del registro, `users.accounts.create` y `users.roles.assign`.
- **Permisos nuevos:** `students.records.read/manage`, `guardians.records.read/manage` y `staff.records.read/manage`, asignados a Administrador institucional, Secretaría (todo menos gestionar personal) y Coordinador (solo consulta).

### Verificaciones

- 20 pruebas de integración nuevas: reutilización de personas, nombre distinto, duplicados, reglas del acudiente principal (también a nivel de base), vínculos inválidos, acceso al portal y escalamiento, permisos por rol y aislamiento entre instituciones.
- La prueba de búsqueda detectó que "sofia" no encontraba a "Sofía". Corregido con `search_text`.

### Operación sobre la base de desarrollo (con datos reales)

- Antes de cada migración se hizo una copia con `pg_dump` en `backups/` (ignorado por Git): `educore_dev-antes-de-0003.dump` y `educore_dev-antes-de-0004.dump`.
- Las migraciones se aplicaron con `prisma migrate deploy`, que nunca reinicia la base.
- Se verificó que los datos existentes siguen intactos.

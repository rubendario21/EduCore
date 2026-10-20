# Fase 2 · Comunidad y matrícula

**Inicio:** 2026-10-19 · **Estado:** en curso

| Bloque | Contenido                                                                                                                       | Estado     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 2A     | Estudiantes, acudientes y sus vínculos, personal y docentes, y acceso al portal                                                 | Completado |
| 2B     | Matrícula por año: ubicación en grupo con historial, retiro, traslado y renovación                                              | Completado |
| 2C     | Plan de estudios (asignaturas e intensidad horaria por grado), asignación docente y plantilla académica colombiana **opcional** | Completado |
| 2D     | Admisiones: solicitudes, documentos, revisión, aprobación y paso a matrícula                                                    | Completado |
| 2E     | Autorizaciones de tratamiento de datos (Ley 1581)                                                                               | Completado |
| 2F     | Importación masiva desde CSV/XLSX con informe por fila                                                                          | Completado |
| 2G     | Pantallas web de todo lo anterior                                                                                               | Completado |

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

---

## Informe · Bloque 2B (2026-10-19)

### Qué se construyó

- **Migración `20261019171054_enrollments`:** tablas `enrollment` (matrícula por estudiante y año) y `group_placement` (ubicación en grupo con fechas). Solo agrega estructuras. Reglas en la base de datos:
  - Un estudiante tiene como máximo **una matrícula vigente** (prematrícula o activa) por año (índice único parcial).
  - Una matrícula tiene como máximo **una ubicación abierta** (índice único parcial).
  - Las fechas finales no pueden ser anteriores a las iniciales; retiro y traslado exigen fecha de fin (`CHECK`).
- **Matrícula** (`/enrollments`): listado con filtros (año, grado, grupo, estudiante, estado, búsqueda), detalle con historial de ubicaciones y registro como prematrícula o activa.
- **Ciclo de vida:**
  - Prematrícula → activa (`/activate`) o anulada (`/cancel`). Nada se borra.
  - Retiro (`/withdraw`) con fecha, motivo y detalle; traslado (`/transfer`) con institución de destino.
  - Al retirar o trasladar se cierra la ubicación, se libera el cupo y el estudiante pasa a "retirado". Si vuelve, se crea una matrícula nueva y la anterior se conserva.
- **Cambio de grupo** (`/placement`): cierra la ubicación actual y abre otra desde la fecha efectiva. Un cambio el mismo día en que empezó la ubicación vigente se trata como corrección y no crea historial falso. No se aceptan fechas hacia atrás.
- **Cupo:** se valida con el grupo bloqueado (`FOR UPDATE`), así dos matrículas simultáneas no superan el cupo.
- **Renovación** (`/enrollments/renewals`): pasa al año siguiente a los estudiantes con matrícula activa o finalizada, como prematrícula, al grado siguiente (`NEXT`) o al mismo (`SAME`).
  - Tiene modo simulación (`dryRun`) que muestra qué se crearía y qué se omitiría, con el motivo.
  - Omite a quien ya está matriculado (`ALREADY_ENROLLED`), a quien está en el último grado (`LAST_GRADE`) y al estudiante que no está activo (por ejemplo, retirado o egresado).
  - Se puede repetir sin duplicar.
- **Coherencia con grupos:** un grupo con estudiantes ubicados no se desactiva, no cambia de grado y no puede tener un cupo menor que su ocupación.
- **Años cerrados:** no admiten matrículas ni cambios.
- **Permisos nuevos:** `enrollments.records.read/manage`. Administrador institucional y Secretaría gestionan; Coordinador solo consulta.
- Todas las operaciones quedan en la auditoría.

### Verificaciones

- 16 pruebas de integración nuevas: matrícula y auditoría; una matrícula vigente con tres solicitudes simultáneas; la misma regla forzada directamente en la base; cupo con solicitudes simultáneas; grupo de otro grado; egresados; historial de cambios de grupo y corrección del mismo día; retiro, liberación del cupo y reingreso; traslado; fechas inválidas; prematrícula activada y anulada; renovación (simulación, último grado, idempotencia, estrategia `SAME`); reglas de grupos con estudiantes; año cerrado; permisos del coordinador.

### Operación sobre la base de desarrollo (con datos reales)

- Copia previa: `backups/educore_dev-antes-de-0005.dump`.
- La migración se aplicó con `prisma migrate deploy`; `prisma migrate diff` confirma que el esquema y la base coinciden.
- Los datos existentes siguen intactos.

### Limitaciones conocidas

- Aún no hay pantallas web para matrícula (bloque 2G).
- La renovación no asigna grupo: cada estudiante renovado queda en prematrícula sin grupo, para ubicarlo después.
- La promoción según resultados académicos llegará con el SIEE configurable (Fase 3); por ahora la renovación usa solo el orden de grados.

---

## Informe · Bloque 2C (2026-10-19)

### Qué se construyó

- **Migración `20261019190000_curriculum_teaching`:** tablas `curriculum_subject` (plan de estudios) y `teaching_assignment` (asignación académica). Solo agrega estructuras. Reglas en la base de datos:
  - Una asignatura de un grupo tiene **un único docente vigente** (índice único parcial).
  - La intensidad horaria va de 1 a 40 horas semanales (`CHECK`).
  - La fecha de fin de una asignación no puede ser anterior a la de inicio (`CHECK`).
- **Plan de estudios** (`/curriculum`), por año lectivo y grado:
  - Agregar una asignatura con su intensidad horaria semanal, cambiar la intensidad y consultar el plan.
  - Una asignatura solo se quita del plan si nunca tuvo docente asignado en ese grado y año; si lo tuvo, se conserva como historial.
  - **Copiar el plan** de un año a otro (`/curriculum/copy`): solo agrega lo que falta y omite grados o asignaturas inactivos. Se puede repetir sin duplicar.
  - Un año cerrado no admite cambios.
- **Asignación académica** (`/teaching-assignments`):
  - Asigna un docente a una asignatura de un grupo. Solo se aceptan personas del personal de tipo docente y activas, y asignaturas que estén en el plan del grado del grupo para ese año.
  - **Reemplazo** (`/replace`): cierra la asignación vigente y abre otra desde la fecha indicada. Si es el mismo día de inicio, se trata como corrección.
  - **Finalización** (`/end`): la asignatura queda sin docente vigente y se puede volver a asignar.
  - **Lista de clase** (`/:id/students`): estudiantes con matrícula vigente ubicados hoy en el grupo.
  - Las fechas deben estar dentro del año lectivo. Por defecto se usa hoy, o el inicio del año si todavía no empezó.
- **Alcance `ASSIGNED` para docentes:**
  - El rol Docente consulta estudiantes, matrículas y asignaciones solo de los grupos donde tiene una asignación vigente (en años no cerrados).
  - Un id de un registro ajeno se responde como inexistente (404), igual que uno de otra institución.
  - Cuando termina la asignación o el estudiante se retira, el docente deja de verlo.
  - Un usuario con rol Docente sin perfil de personal no ve a nadie.
  - Los roles personalizados también pueden conceder `students.records.read`, `enrollments.records.read` y `teaching.assignments.read` con alcance `ASSIGNED`.
- **Coherencia:**
  - Un docente con asignaturas vigentes no se desactiva ni cambia de tipo de personal.
  - Un grupo con docentes vigentes no se desactiva ni cambia de grado.
  - Las asignaciones y las desactivaciones simultáneas se serializan con bloqueos.
- **Plantilla académica colombiana** (`POST /academic-templates/colombia`), opcional, según la decisión 7:
  - Crea 4 niveles, 14 grados (Prejardín a Undécimo) y 11 áreas obligatorias (Ley 115, arts. 23 y 31), cada una con su asignatura.
  - Tiene modo simulación (`dryRun`).
  - Solo crea lo que falta, comparando por código; nunca modifica lo existente. Se puede aplicar varias veces.
  - No fija intensidades horarias ni escalas de valoración. El preescolar no recibe áreas porque se organiza por dimensiones.
- **Permisos nuevos:**
  - `teaching.assignments.read`: alcances `ALL` y `ASSIGNED`.
  - `teaching.assignments.manage`: solo Administrador institucional.
  - Coordinador y Secretaría consultan.
  - El Docente recibe `ASSIGNED` en asignaciones, estudiantes y matrículas.
  - El plan de estudios usa los permisos de la estructura académica.
- **Corrección:** la sincronización del catálogo de permisos enviaba `allowedScopes` a la tabla `permission`, que no tiene esa columna. Fallaba en cuanto un permiso declaraba alcances propios, lo que ocurrió por primera vez en este bloque.
- **Ajuste de una prueba anterior:** el rol de prueba `USER_MANAGER` (en `users.int-spec.ts`) imitaba los permisos del Docente de la Fase 1. Como ahora el Docente tiene permisos `ASSIGNED`, la protección contra escalada de privilegios le impedía crear docentes, que es el comportamiento correcto. Se actualizó el rol de la prueba.

### Verificaciones

- 20 pruebas de integración nuevas:
  - Plantilla: simulación, aplicación, idempotencia, respeto de lo existente y permisos.
  - Plan de estudios: duplicados, rango de horas (también en la base), copia idempotente, quitar con y sin asignaciones, año cerrado.
  - Asignación: docente no válido, inactivo o asignatura fuera del plan; un docente vigente con tres solicitudes simultáneas y también forzado en la base; reemplazo con historial y corrección del mismo día; finalización; bloqueo de desactivaciones; permisos del coordinador.
  - Alcance `ASSIGNED`: listados filtrados, ids manipulados (404), filtros explícitos que no amplían el alcance, fin de la asignación, retiro del estudiante, operaciones de gestión prohibidas y rol Docente sin perfil.

### Operación sobre la base de desarrollo (con datos reales)

- Copia previa: `backups/educore_dev-antes-de-0006.dump`.
- Migración aplicada con `prisma migrate deploy`; `prisma migrate diff` confirma que el esquema y la base coinciden.

### Limitaciones conocidas

- No hay "director de grupo"; puede añadirse cuando el portal o las notas lo necesiten.
- Solo el personal de tipo docente recibe asignaturas. Si un directivo dicta clase, se registra como docente.
- Sin pantallas web todavía (bloque 2G).

---

## Informe · Bloque 2D (2026-10-19)

### Qué se construyó

- **Migración `20261019210000_admissions`:** tablas `admission_application` (solicitud), `admission_document` (documentos adjuntos) y `admission_status_change` (historial de estados). Solo agrega estructuras. Reglas en la base de datos:
  - Un aspirante tiene como máximo **una solicitud en curso o admitida por año** (índice único parcial). Tras un rechazo o un desistimiento puede volver a aplicar.
  - El acudiente de la solicitud se registra completo o no se registra.
  - Un rechazo siempre guarda su motivo, y una solicitud matriculada siempre apunta a su estudiante y su matrícula (`CHECK`).
- **Solicitudes** (`/admissions`):
  - Registro con los datos del aspirante, del acudiente, el grado al que aspira y la institución de procedencia.
  - Consecutivo por año (`ADM-2027-0001`), asignado con el año bloqueado: no se repite aunque lleguen solicitudes simultáneas.
  - Edición mientras la solicitud no haya finalizado. Listado con filtros por año, grado, estado y aspirante.
- **Datos mínimos:** el aspirante y su acudiente se guardan en la solicitud y solo se convierten en estudiante y acudiente al matricular. Una solicitud rechazada no deja perfiles en la comunidad educativa. No se piden datos de salud.
- **Flujo** (criterio 7): _borrador → enviada → en revisión → aprobada / rechazada / en espera → matriculada_, más _desistida_ desde cualquier estado abierto.
  - Solo se aceptan transiciones válidas (`INVALID_STATUS_TRANSITION`).
  - Rechazar exige motivo.
  - Cada cambio queda en el historial de la solicitud y en la auditoría.
- **Matrícula del admitido** (`/enroll`), en una sola transacción, todo o nada:
  - Registra al aspirante como estudiante, o reutiliza su perfil si ya lo era (reingreso). Un documento existente con otro nombre se rechaza.
  - Vincula al acudiente, reutilizando la persona si ya existe (por ejemplo, una docente).
  - Crea la matrícula activa con todas las reglas del bloque 2B (cupo, grupo del mismo grado, una matrícula vigente).
  - Si algo falla, no queda nada creado y la solicitud sigue aprobada.
- **Documentos** (criterio 8):
  - PDF, PNG o JPEG de hasta 5 MB, validados por su contenido real.
  - Se guardan como archivos `PERSONAL`.
  - Solo se descargan por la solicitud, con el permiso de consultar admisiones; la ruta genérica `/files/:id` no los expone.
  - Retirar un documento no borra el archivo.
- **Permisos nuevos:**
  - `admissions.applications.read`: consultar.
  - `admissions.applications.manage`: registrar, editar, adjuntar, enviar, revisar y desistir.
  - `admissions.applications.decide`: aprobar, rechazar o dejar en espera.
  - Secretaría tramita; Coordinación decide; el Administrador institucional hace todo.
  - Matricular exige además gestionar estudiantes, acudientes y matrículas.
- **Reutilización:** la creación de estudiantes, el vínculo con acudientes y la matrícula tienen ahora variantes que trabajan dentro de una transacción existente.

### Verificaciones

- 13 pruebas de integración nuevas:
  - Flujo completo con historial y auditoría; transiciones inválidas; lista de espera; rechazo sin motivo; desistimiento.
  - Duplicados y numeración con solicitudes simultáneas; las mismas reglas forzadas directamente en la base.
  - Matrícula del admitido: persona reutilizada (docente que es acudiente), todo o nada ante cupo lleno, nombre distinto, reingreso.
  - Documentos: clasificación, descarga protegida, retiro, contenido falso y tipo inválido.
  - Separación de permisos entre Secretaría, Coordinación y Docente.

### Operación sobre la base de desarrollo (con datos reales)

- Copia previa: `backups/educore_dev-antes-de-0007.dump`.
- Migración aplicada con `prisma migrate deploy`; `prisma migrate diff` confirma que el esquema y la base coinciden.

### Limitaciones conocidas

- Las familias todavía no pueden aplicar en línea: la Secretaría registra la solicitud. Un formulario público exigirá protección contra abuso (CAPTCHA o límites) y el aviso de tratamiento de datos (bloque 2E).
- No hay requisitos documentales obligatorios por grado; cada institución decide qué pedir.
- Al matricular, el acudiente queda vinculado sin marcarse como representante legal: se confirma en el registro del estudiante.
- Sin pantallas web todavía (bloque 2G).

---

## Informe · Bloque 2E (2026-10-19)

### Qué se construyó

- **Migración `20261019230000_data_consents`:** tablas `data_policy` (versiones de la política), `data_policy_purpose` (finalidades), `data_consent` (autorizaciones) y `data_consent_decision` (decisión por finalidad). Solo agrega estructuras. Reglas en la base de datos:
  - Una política **publicada** no se modifica ni se borra, ni tampoco sus finalidades (triggers).
  - Una autorización **no se edita**: solo admite, una vez, el soporte y la revocación (trigger). El rol de la aplicación no puede borrarla (`REVOKE DELETE`).
  - Las decisiones son de solo inserción (`REVOKE UPDATE, DELETE`), y cada una debe pertenecer a una finalidad de la misma versión (trigger).
  - Hay una sola autorización vigente por estudiante y versión (índice único parcial).
  - La revocación se registra completa: fecha, motivo y momento (`CHECK`).
- **Políticas** (`/data-policies`):
  - Versiones en borrador editables, con texto, fecha de vigencia y finalidades. Cada finalidad indica si es necesaria para el servicio educativo.
  - Al publicarse, la versión queda fija; un cambio exige una versión nueva.
  - `/current` devuelve la vigente: la última publicada que ya entró en vigor.
- **Autorizaciones** (`/data-consents`), criterio 10. Registran:
  - **quién autoriza**: persona y calidad (representante legal o titular);
  - **para qué estudiante**;
  - **la versión de la política**;
  - **la fecha** en que se otorgó, que no puede ser futura;
  - **el medio**: escrito, electrónico, correo, llamada grabada u otro;
  - **la decisión sobre cada finalidad**, obligatoria para todas;
  - quién lo registró y cuándo.
- **Quién puede autorizar** (Ley 1581, art. 7):
  - un acudiente vinculado al estudiante y **marcado como representante legal**;
  - el propio estudiante si era **mayor de edad** en la fecha de la autorización.
  - Cualquier otra persona se rechaza (`AUTHORIZER_NOT_ALLOWED`).
- **Revocación** (art. 8): se registra con fecha y motivo, sin borrar nada. Después se puede registrar una autorización nueva.
- **Soporte:** un documento (PDF, PNG o JPEG) por autorización, guardado como archivo `PERSONAL`. Se descarga solo con el permiso de consultar autorizaciones y no se reemplaza.
- **Cobertura** (`/data-consents/coverage`): para la versión vigente (u otra indicada), muestra:
  - cuántos estudiantes activos tienen autorización vigente y cuántos no;
  - cuántos negaron alguna finalidad necesaria;
  - la lista paginada de los que faltan.
- **Permisos nuevos:**
  - `privacy.policies.manage`: solo Administrador institucional.
  - `privacy.consents.read`: Administrador, Secretaría y Coordinación.
  - `privacy.consents.manage`: Administrador y Secretaría.

### Verificaciones

- 13 pruebas nuevas (12 de integración y 1 del cálculo de edad):
  - Ciclo de vida de la política y versión vigente; versiones futuras; validaciones.
  - Inmutabilidad en la base de políticas, finalidades, autorizaciones y decisiones.
  - Contenido completo de la autorización y su auditoría.
  - Quién puede autorizar: representante legal, acudiente sin esa calidad, menor, mayor de edad.
  - Decisiones incompletas, repetidas o ajenas; fecha futura; política en borrador.
  - Concurrencia; revocación y nueva autorización; soporte protegido; cobertura; permisos.

### Operación sobre la base de desarrollo (con datos reales)

- Copia previa: `backups/educore_dev-antes-de-0008.dump`.
- Migración aplicada con `prisma migrate deploy`; `prisma migrate diff` confirma que el esquema y la base coinciden. Los datos existentes siguen intactos.

### Limitaciones conocidas

- **El texto de la política lo redacta cada institución.** EduCore no trae un texto legal predefinido; conviene que lo revise un abogado.
- Las autorizaciones las registra el personal. La autorización en línea por el acudiente llegará con el portal; el medio `ELECTRONIC` ya está previsto.
- Las autorizaciones aún no bloquean otros usos. Por ejemplo, un estudiante que negó el uso de imagen no queda excluido automáticamente de las publicaciones; cada módulo que trate esos datos deberá consultarlas.
- Los datos sensibles (salud, discapacidad) siguen fuera de alcance (decisión 5).
- Sin pantallas web todavía (bloque 2G).

---

## Informe · Bloque 2F (2026-10-19)

### Qué se construyó

- **Importación de estudiantes** (`/imports/students`), con su acudiente principal y, si se indica, su matrícula:
  - `GET /template`: plantilla CSV separada por punto y coma (como la abre Excel en español), con una fila de ejemplo.
  - `POST /validate`: revisa **todo** el archivo y devuelve un informe fila por fila. Para cada fila indica si es válida, los errores con su columna y lo que se haría. **No guarda nada.**
  - `POST /`: vuelve a validar. Solo si no hay errores, importa **en una única transacción**. Si una fila falla durante la importación, no se guarda ninguna (`IMPORT_ROW_FAILED`). Si hay errores de validación, responde `422 IMPORT_HAS_ERRORS` con el informe.
- **Formatos y lectura:**
  - **CSV:** separador punto y coma o coma (se detecta), con o sin BOM, en UTF-8 o Windows-1252 (Excel en español), con comillas y saltos de línea dentro de las celdas.
  - **XLSX:** primera hoja; los números y fechas de Excel se convierten a texto.
  - Encabezados sin distinguir mayúsculas, tildes ni espacios (`Número de documento`, `Año`).
  - Valores escritos a mano: `T.I.`, `Madre`/`Mamá`, `Sí`/`No`, fechas `DD/MM/AAAA` o `AAAA-MM-DD`.
  - Las columnas desconocidas se informan y se ignoran; las obligatorias que falten detienen la revisión.
- **Validaciones por fila:**
  - Datos de las personas con las mismas reglas del registro manual.
  - Estudiante repetido en el archivo; ya registrado como estudiante; documento existente con otro nombre.
  - Código de estudiante repetido o ya usado.
  - Acudiente que aparece con nombres distintos (en la base o en otra fila); el estudiante como su propio acudiente; parentesco o SI/NO no válidos.
  - Año lectivo inexistente o cerrado; grado inexistente o inactivo; grupo inexistente, de otro grado, inactivo o ambiguo entre sedes.
  - **Cupo**, contando también las filas anteriores del mismo archivo.
- **Importación con los servicios del registro manual:** aplica las mismas reglas.
  - Las personas existentes se reutilizan: una docente que es acudiente no se duplica.
  - Los hermanos comparten acudiente; el primero queda como acudiente principal.
  - Cada operación queda en la auditoría, y la importación completa se registra con el nombre del archivo, su huella SHA-256 y los totales.
- **Límites y seguridad:**
  - Hasta 2 MB y 1000 filas por archivo.
  - Un XLSX se revisa antes de abrirlo: se rechaza si su contenido descomprimido supera 40 MB (protección contra bombas ZIP).
  - Los archivos importados no se guardan.
- **Permisos:** importar exige gestionar estudiantes, acudientes y matrículas (Administrador institucional y Secretaría).
- **Dependencias nuevas** (versión exacta, licencia MIT, `npm audit` sin vulnerabilidades): `csv-parse` 7.0.3 y `read-excel-file` 9.3.12, solo para leer. Se descartó `exceljs` porque lleva años sin publicar versiones y tiene muchas dependencias.

### Verificaciones

- 9 pruebas unitarias:
  - Encabezados, fechas, parentescos, SI/NO y validación de personas.
  - Lectura de CSV (BOM, comillas, punto y coma, Windows-1252, filas vacías con su número) y de XLSX.
  - Archivos vacíos, binarios, dañados, con demasiadas filas y una bomba ZIP de 60 MB.
- 6 pruebas de integración:
  - Plantilla.
  - Informe con diez casos de error distintos, sin guardar nada.
  - Importación completa con acudiente compartido y persona reutilizada.
  - Importación desde XLSX.
  - Dos importaciones simultáneas del mismo archivo, sin duplicados.
  - Columnas faltantes, archivo ausente y permisos.

### Limitaciones conocidas

- Solo se importan estudiantes (con un acudiente y una matrícula por fila). Un segundo acudiente se vincula después desde el registro del estudiante.
- No hay importación de personal ni de calificaciones (las calificaciones llegan en la Fase 3).
- No se ha medido el tiempo de una importación de 1000 filas. Cada fila pasa por las mismas reglas que el registro manual; la transacción admite hasta 5 minutos.
- Sin pantallas web todavía (bloque 2G).

---

## Informe · Bloque 2G (2026-10-19)

### Qué se construyó

- **Menú** con las secciones Comunidad, Matrícula y Académico. Cada opción exige su permiso. Las opciones institucionales (Estudiantes, Matrículas, Estructura académica, Asignación académica) exigen además alcance `ALL`: un docente ve "Mis cursos" y no los listados de toda la institución. Para eso, `can(permiso, 'ALL')` admite ahora el alcance.
- **Estudiantes:** listado con búsqueda y estado; alta; ficha con:
  - datos y edición;
  - acudientes: vincular, hacer principal, marcar representante legal, desvincular;
  - matrículas;
  - autorizaciones de datos;
  - acceso al portal.
- **Acudientes y Personal:** listados, alta y edición. El personal permite además dar acceso con roles.
- **Matrículas:**
  - Listado con filtros (año, grado, grupo, estado, búsqueda) y matrícula con buscador de estudiantes.
  - Renovación con simulación previa.
  - Detalle con historial de grupos y acciones: formalizar, anular, ubicar o cambiar de grupo, retirar, trasladar.
- **Admisiones:**
  - Listado y registro de la solicitud con aspirante y acudiente.
  - Detalle con las acciones que permite cada estado y cada permiso (las calcula `availableActions`, espejo del flujo de la API).
  - Documentos con carga, descarga protegida y retiro; historial; matrícula del admitido.
- **Estructura académica:** nueva pestaña "Plan de estudios" (asignaturas por año y grado, horas editables, total, copia desde otro año) y botón "Plantilla colombiana", que muestra la simulación antes de crear nada.
- **Asignación académica:** por año y grupo. Lista las asignaturas del plan con su docente vigente y permite asignar, reemplazar, finalizar y ver el historial.
- **Mis cursos:** las asignaciones del usuario y la lista de clase de cada una.
- **Protección de datos:** cobertura (totales y estudiantes pendientes), autorizaciones (revocar, adjuntar y descargar soporte) y políticas (borrador con finalidades, publicación con confirmación).
  - La autorización se registra desde la ficha del estudiante, con una decisión explícita por finalidad. Ninguna viene marcada por defecto.
- **Importar estudiantes:** descarga de la plantilla, validación con informe por fila (con filtro de errores) e importación solo cuando el archivo no tiene errores.
- **Componentes comunes:**
  - `FormDialog` y `DetailList`.
  - `PersonFields` y su esquema (`person-form.ts`).
  - `StudentPicker`.
  - `downloadFile`, que descarga archivos protegidos con el token, sin ponerlo en la URL.
  - `Textarea`.
- **Corrección:** `applyServerErrors` asigna los errores de campos anidados (p. ej. `person.firstNames`) a su ruta completa. Antes quedaban en la raíz y no se mostraban.

### Verificaciones

- Pruebas de la web: 33/33, con 8 nuevas:
  - navegación con alcances (docente frente a institucional);
  - acciones de admisión por estado;
  - matrículas editables;
  - pantalla de importación (con errores no deja importar; sin errores, importa).
- `tsc`, `eslint` (0 errores) y `vite build` pasan.
- **Revisión en el navegador**, con la API y la web contra la base de **pruebas** (`educore_test`, usuario de prueba creado para esto; nunca contra `educore_dev`):
  - estudiantes y su ficha, con una autorización de datos registrada de punta a punta;
  - asignación académica, admisiones, matrículas, mis cursos, protección de datos y plan de estudios;
  - sin errores en la consola.

### Limitaciones conocidas

- El paquete JavaScript pesa 906 KB (259 KB comprimido). Conviene dividirlo por rutas (carga diferida); queda para la Fase 5.
- El buscador de estudiantes muestra los 8 primeros resultados; para más, hay que refinar la búsqueda.
- La asignación académica lista hasta 100 docentes.
- No hay pruebas de punta a punta automatizadas (Playwright, Fase 5); la revisión visual de este bloque fue manual.

### Ajuste: selección de perfil al iniciar sesión (decisión del usuario, 2026-10-19)

- **En la pantalla de inicio** se elige Estudiante, Acudiente, Docente o Administrativo. La pantalla recuerda el último perfil elegido en ese navegador.
- **Después de entrar**, quien tiene varios perfiles (p. ej. docente y acudiente) cambia entre ellos desde el encabezado ("Ingresando como"), sin volver a iniciar sesión.
- **El perfil es una vista, no un permiso.** Ordena el menú y la pantalla de llegada (Docente → Mis cursos). Los permisos los sigue aplicando la API según los roles de la cuenta.
  - Si la cuenta no tiene el perfil elegido, se avisa después de validar la contraseña y se entra con uno propio. Antes de autenticar no se revela nada.
  - El tablero institucional solo aparece con el perfil Administrativo.
- Los perfiles se derivan de los roles: `STUDENT` → Estudiante, `GUARDIAN` → Acudiente, `TEACHER` → Docente, cualquier otro rol (incluidos los personalizados) → Administrativo.
- **Pruebas:** 4 nuevas (perfiles por roles, perfil elegido que la cuenta no tiene, pantalla de llegada, menú por perfil). Revisado en el navegador contra la base de pruebas.
- **Pendiente:** el portal de estudiantes y acudientes (notas, asistencia, comunicados) llega en las Fases 3 y 4. Mientras tanto, esos perfiles ven una página de inicio que lo explica.

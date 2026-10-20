# Fase 3 · Académico

**Inicio:** 2026-10-19 · **Estado:** en curso

Cada bloque incluye su API, sus pruebas y sus pantallas web, para que cada parte se pueda usar apenas esté lista.

| Bloque | Contenido                                                                                                                                       | Estado    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 3A     | **SIEE configurable** por año lectivo: escala, niveles de desempeño, nota mínima de aprobación, redondeo y reglas de promoción                    | Completado |
| 3B     | Componentes de evaluación con ponderación, actividades evaluativas y **registro de notas** con historial (planilla del docente)                  | Completado |
| 3C     | Cálculo de la nota del período, **cierre y publicación**, y cambios posteriores con solicitud y aprobación                                      | Pendiente |
| 3D     | **Asistencia** con estados configurables y **excusas** con soporte sensible                                                                     | Pendiente |
| 3E     | **Boletines en PDF** y consulta de resultados publicados por estudiantes y acudientes (portal)                                                  | Pendiente |
| 3F     | **Horarios** con validación de cruces y **calendario** académico                                                                                | Pendiente |
| 3G     | Promoción de fin de año según el SIEE, **reportes** con exportación e indicadores (`docs/indicadores.md`)                                        | Pendiente |

## Decisiones de diseño

1. **El SIEE lo define cada institución** (decisión del usuario, 2026-10-19; Decreto 1290 de 2009, art. 4).
   - Ninguna escala, rango ni regla de promoción está fija en el código.
   - La configuración es **por año lectivo**: un cambio del SIEE aplica a un año nuevo y no altera los resultados de años anteriores.
   - La web ofrece un **ejemplo editable** (escala 1,0–5,0 con los niveles Superior, Alto, Básico y Bajo del art. 5). La institución lo ajusta o arma su propia escala.
2. **Una sola fórmula, compartida.** El redondeo, la búsqueda del nivel de desempeño y la validación de los rangos viven en `@educore/shared`, así que la web y la API calculan exactamente lo mismo. La API es la autoridad.
3. **Las notas no se sobrescriben.** Cada cambio de una nota queda en su historial. Después de publicar un período, los cambios exigen solicitud y aprobación (3C).
4. **Alcance del docente:** registra notas y asistencia solo de sus asignaciones vigentes y solo en períodos abiertos (alcance `ASSIGNED` de la Fase 2C).
5. **Datos sensibles:** los soportes médicos de las excusas se guardan como archivos `SENSITIVE`. El docente ve el estado de la excusa, no el soporte (matriz de roles, §7 del plan).

## Criterios de aceptación de la fase

1. **SIEE:** los niveles de desempeño cubren toda la escala, sin huecos ni solapes, con la precisión decimal configurada; la nota mínima de aprobación está dentro de la escala. Un SIEE con notas registradas ya no cambia su escala.
2. **Notas:**
   - Una nota está dentro de la escala y respeta sus decimales.
   - Las ponderaciones de los componentes suman 100 %.
   - Solo se registran notas en períodos abiertos, de estudiantes matriculados en el grupo y por el docente de la asignación (o con alcance institucional).
   - Cada cambio queda en el historial con autor, fecha y motivo.
3. **Período:** el cierre calcula la nota de cada estudiante por asignatura con la fórmula documentada. La publicación deja visibles los resultados para estudiantes y acudientes. Un cambio posterior a la publicación requiere solicitud y aprobación, queda auditado y recalcula los resultados.
4. **Asistencia:** se registra por sesión de clase, con estados configurables por la institución. Una excusa aprobada cambia la inasistencia a justificada sin borrar el registro original.
5. **Boletines:** el PDF muestra exactamente los resultados publicados. Estudiantes y acudientes solo ven los propios o los de sus estudiantes vinculados (alcances `OWN` y `LINKED`).
6. **Horarios:** no se permiten cruces de un docente, de un grupo ni de un espacio en la misma franja.
7. **Indicadores:** cada indicador tiene su fórmula en `docs/indicadores.md` y distingue `0` de "sin datos".
8. Todas las rutas nuevas pasan el inventario de autorización y las reglas de aislamiento institucional. `typecheck`, `lint`, pruebas unitarias, de integración y de la web pasan.

---

## Informe · Bloque 3A (2026-10-20)

### Qué se construyó

- **Migración `20261020010000_grading_scheme`:** tablas `grading_scheme` (un SIEE por año lectivo) y `performance_level` (niveles de desempeño). Solo agrega estructuras. Reglas en la base de datos (`CHECK`):
  - entre 0 y 2 decimales;
  - mínima menor que máxima;
  - nota de aprobación dentro de la escala;
  - asistencia mínima entre 0 % y 100 %;
  - cada nivel con su inicio no mayor que su final.
- **Reglas compartidas en `@educore/shared` (`grading.ts`):** redondeo (al más cercano o truncado), nota dentro de la escala y con sus decimales, nivel de desempeño de una nota, aprobación y validación completa de la configuración.
  - Los niveles cubren toda la escala, en orden, **sin huecos ni solapes**, con la precisión configurada.
  - Los cálculos se hacen en unidades enteras para evitar errores de punto flotante.
  - La web y la API usan exactamente las mismas funciones.
- **API** (`/academic-years/:id/grading-scheme`):
  - consultar;
  - guardar o reemplazar la configuración completa, con los mensajes de validación en español;
  - copiar el SIEE de otro año a uno que aún no lo tiene;
  - un año cerrado no cambia su SIEE;
  - cada cambio queda en la auditoría con los valores anteriores y los nuevos.
- **Reglas de promoción configurables:** si se cuentan áreas o asignaturas, el máximo de reprobadas para ser promovido, la asistencia mínima y los criterios adicionales en texto. Se aplicarán en el bloque 3G.
- **Permiso nuevo:** `academics.grading.manage` (Administrador institucional). La consulta usa `academics.structure.read`.
- **Web:** en el detalle del año lectivo, la tarjeta "SIEE del año":
  - resumen de la escala y de los niveles, que se marcan como aprobatorios o no;
  - editor con **validación inmediata**: se ve el problema antes de guardar;
  - **ejemplo editable del Decreto 1290** (1,0–5,0; Bajo, Básico, Alto, Superior), que la institución ajusta o reemplaza por su propia escala;
  - copia desde otro año.

### Verificaciones

- 6 pruebas unitarias de las reglas: redondeo sin errores de punto flotante, bordes de los niveles, huecos, solapes, precisión y escalas propias (p. ej. 0–100 sin decimales).
- 7 pruebas de integración: SIEE no definido, guardar y reemplazar con auditoría, escala propia, rechazo de huecos y de una aprobación fuera de la escala, copia entre años, año cerrado, `CHECK` de la base y permisos del coordinador.
- 2 pruebas de la web: el editor valida al vuelo, bloquea el guardado con un hueco y envía la configuración correcta.
- Totales: API unitarias 115/115, integración 229/229, web 39/39; lint sin errores.

### Operación sobre la base de desarrollo

- Copia previa: `backups/educore_dev-antes-de-0009.dump`. Migración aplicada con `prisma migrate deploy`; el esquema y la base coinciden y los datos siguen intactos.

### Pendiente para los siguientes bloques

- El SIEE se bloqueará para cambios de escala y niveles en cuanto el año tenga notas registradas (bloque 3B), para no alterar resultados ya calculados.

---

## Informe · Bloque 3B (2026-10-20)

### Qué se construyó

- **Migración `20261020020000_gradebook`:** tablas `evaluation_component`, `assessment` (actividad evaluativa), `grade_record` (nota) y `grade_record_change` (historial). Solo agrega estructuras. Además:
  - A los SIEE ya existentes se les crea un componente "General" al 100 %.
  - Un **trigger** impide guardar una nota fuera de la escala del SIEE de su año, aunque se escriba directamente en la base.
  - El historial de notas es **de solo inserción**: el rol de la aplicación no puede modificarlo ni borrarlo.
- **Componentes de evaluación en el SIEE:** cada institución define los suyos (p. ej. Cognitivo 60 %, Procedimental 40 %), que deben sumar 100 %. Se actualizan por código, para que las actividades conserven su componente; uno con actividades no se puede quitar.
- **SIEE bloqueado con notas:** en cuanto el año tiene notas registradas, la escala, los rangos de los niveles y los pesos de los componentes ya no cambian (`GRADING_SCHEME_LOCKED`). Sí se pueden editar los nombres, las reglas de promoción y los criterios.
- **Apertura de períodos** (`POST /academic-periods/:id/open`): exige el año activo y con SIEE configurado. Solo en un período abierto se crean actividades y se registran notas. El cierre y la publicación son del bloque 3C.
- **Planilla de notas:**
  - `GET /gradebook`: estudiantes del grupo con sus notas, el promedio por componente, la **nota parcial**, el nivel de desempeño y si aprueba. Incluye, marcados, a quienes tienen notas pero ya no están en el grupo.
  - `POST/PATCH/DELETE /assessments`: actividades por componente. No se eliminan ni cambian de componente si tienen notas.
  - `PUT /assessments/:id/grades`: registro en lote, **todo o nada**. Valida la escala y los decimales del SIEE y que el estudiante esté ubicado en el grupo. Cada cambio real queda en el historial con el valor anterior, el nuevo, el autor y el motivo; repetir el mismo valor no genera registros.
  - `GET /assessments/:id/grades/:enrollmentId/history`: historial de una nota.
- **Fórmula de la nota parcial** (`computePeriodScore`, compartida con la web):
  1. En cada componente, promedio simple de las actividades con nota.
  2. Promedio de los componentes ponderado por su peso. Si un componente aún no tiene notas, su peso se reparte entre los demás.
  3. Un solo redondeo al final, con el modo y los decimales del SIEE. Sin ninguna nota, el resultado es "sin datos" (`null`), no 0.
- **Permisos nuevos** (`grades.records.read` y `grades.records.manage`, con alcances `ALL` y `ASSIGNED`):
  - El **Docente** consulta y registra solo en sus asignaciones vigentes.
  - **Rectoría y Coordinación** consultan con alcance institucional, sin editar (matriz de roles del plan, §7).
  - Fuera de su alcance, la asignatura del grupo se responde como inexistente (404).
  - El **Administrador institucional** recibe además `grades.records.manage` con alcance `ASSIGNED`. Sin él, la protección contra escalada de privilegios le impedía crear cuentas con el rol Docente; con `ASSIGNED` puede concederlo, pero no registra notas en cursos que no tiene asignados. Lo detectó la verificación completa.
- **Web:**
  - Editor del SIEE con los componentes y su total.
  - En el año lectivo, "Registro de notas por período" con el botón **Abrir**.
  - En **Mis cursos**, cada curso tiene la pestaña **Notas**: selector de período, actividades agrupadas por componente, celdas editables, aviso inmediato de notas fuera de escala, motivo opcional, guardado agrupado por actividad, historial de cada nota y nota parcial con su nivel.

### Verificaciones

- 3 pruebas unitarias nuevas: suma de componentes, nota del período ponderada y redondeada una sola vez, nota parcial y "sin datos".
- 8 pruebas de integración nuevas:
  - Período no abierto y apertura repetida.
  - Cálculo completo de la nota parcial (3,5 · 60 % + 5 · 40 % = 4,1 → Alto).
  - Historial de cambios (incluido retirar una nota).
  - Lote rechazado por notas fuera de escala, con decimales de más o de un estudiante de otro grupo.
  - Alcance del docente: sin asignación, otra asignatura; coordinación y rectoría solo consultan.
  - Bloqueo del SIEE; actividades con notas.
  - Estudiante que cambia de grupo.
  - Protecciones de la base de datos.
- 2 pruebas de la web: la planilla marca notas fuera de escala y envía los cambios agrupados; solo lectura en un período no abierto.

### Operación sobre la base de desarrollo

- Copia previa: `backups/educore_dev-antes-de-0010.dump`. Migración aplicada con `prisma migrate deploy`; el esquema y la base coinciden.

### Limitaciones conocidas

- Las actividades de un componente pesan lo mismo (promedio simple). Si una institución necesita pesos por actividad, se agregará como opción del SIEE.
- La nota definitiva del período, el cierre, la publicación y los cambios después de publicar son del bloque 3C.

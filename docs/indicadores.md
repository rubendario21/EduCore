# EduCore · Fórmulas de los indicadores

Cada indicador se calcula **solo con los datos de la institución del usuario**.

Convención para distinguir **cero** de **sin datos**:

- **`0`** significa que el dato existe y su valor es cero. Por ejemplo, hay un año activo sin grupos.
- **`null`** significa que no hay datos para calcularlo. Por ejemplo, no hay año lectivo activo. La web muestra "Sin datos" o "No aplica", nunca un 0.

## Dashboard principal (`GET /api/v1/dashboard/summary`)

Permiso: `dashboard.summary.read`.

| Indicador                            | Fórmula                                                                                                                       | Sin datos                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `today`                              | Fecha actual en la zona horaria configurada de la institución (`institution_settings.timezone`, por defecto `America/Bogota`) | —                                                          |
| `users.active`                       | Membresías de la institución con `status = ACTIVE`                                                                            | — (0 posible)                                              |
| `users.invited`                      | Membresías con `status = INVITED` (cuenta creada, contraseña aún no definida)                                                 | —                                                          |
| `users.suspended`                    | Membresías con `status = SUSPENDED`                                                                                           | —                                                          |
| `users.byRole[].count`               | Membresías **activas** que tienen el rol. Un usuario con dos roles cuenta en ambos. Se omiten los roles sin usuarios activos  | Lista vacía                                                |
| `institution.activeCampuses`         | Sedes con `status = ACTIVE`                                                                                                   | —                                                          |
| `institution.activeShifts`           | Jornadas con `status = ACTIVE`                                                                                                | —                                                          |
| `academics.activeGrades`             | Grados con `status = ACTIVE`                                                                                                  | —                                                          |
| `academics.activeSubjects`           | Asignaturas con `status = ACTIVE`                                                                                             | —                                                          |
| `academics.activeYear`               | El año lectivo con `status = ACTIVE` (como máximo uno, por restricción de la base)                                            | `null` si no hay año activo                                |
| `academics.activeYear.periodCount`   | Períodos del año activo                                                                                                       | —                                                          |
| `academics.activeYear.currentPeriod` | Período del año activo con `starts_on ≤ today ≤ ends_on` (fechas inclusivas)                                                  | `null` si hoy no cae en ningún período (p. ej. vacaciones) |
| `academics.activeYear.activeGroups`  | Grupos con `status = ACTIVE` del año activo                                                                                   | —                                                          |

Los indicadores académicos y de asistencia (promedios, ausentismo, bajo rendimiento) se documentarán aquí cuando se implementen, en la Fase 3.

/**
 * Catálogo de permisos de EduCore. Formato: `modulo.recurso.accion`.
 *
 * Es la única fuente de verdad: la API lo sincroniza con la tabla `permission`
 * al arrancar y lo usa para autorizar cada endpoint; la web lo usa solo para
 * decidir qué opciones mostrar. Los permisos se añaden aquí en la fase que
 * implementa su módulo; un permiso sin endpoint que lo use no debe existir.
 */
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard.summary.read',

  // Institución
  INSTITUTION_READ: 'institution.profile.read',
  INSTITUTION_UPDATE: 'institution.profile.update',
  INSTITUTION_SETTINGS_UPDATE: 'institution.settings.update',
  CAMPUSES_MANAGE: 'institution.campuses.manage',
  SHIFTS_MANAGE: 'institution.shifts.manage',

  // Usuarios y acceso
  USERS_READ: 'users.accounts.read',
  USERS_CREATE: 'users.accounts.create',
  USERS_UPDATE: 'users.accounts.update',
  USERS_STATUS: 'users.accounts.status',
  USERS_ROLES_ASSIGN: 'users.roles.assign',
  ROLES_READ: 'access.roles.read',
  ROLES_MANAGE: 'access.roles.manage',
  AUDIT_READ: 'audit.logs.read',

  // Estructura académica
  ACADEMICS_READ: 'academics.structure.read',
  ACADEMICS_MANAGE: 'academics.structure.manage',
  ACADEMIC_YEARS_MANAGE: 'academics.years.manage',
  GRADING_MANAGE: 'academics.grading.manage',

  // Comunidad educativa
  STUDENTS_READ: 'students.records.read',
  STUDENTS_MANAGE: 'students.records.manage',
  GUARDIANS_READ: 'guardians.records.read',
  GUARDIANS_MANAGE: 'guardians.records.manage',
  STAFF_READ: 'staff.records.read',
  STAFF_MANAGE: 'staff.records.manage',

  // Matrícula
  ENROLLMENTS_READ: 'enrollments.records.read',
  ENROLLMENTS_MANAGE: 'enrollments.records.manage',

  // Evaluación y notas
  GRADES_READ: 'grades.records.read',
  GRADES_MANAGE: 'grades.records.manage',

  // Asignación académica (docentes por grupo y asignatura)
  TEACHING_READ: 'teaching.assignments.read',
  TEACHING_MANAGE: 'teaching.assignments.manage',

  // Admisiones
  ADMISSIONS_READ: 'admissions.applications.read',
  ADMISSIONS_MANAGE: 'admissions.applications.manage',
  ADMISSIONS_DECIDE: 'admissions.applications.decide',

  // Protección de datos personales (Ley 1581 de 2012)
  PRIVACY_POLICIES_MANAGE: 'privacy.policies.manage',
  PRIVACY_CONSENTS_READ: 'privacy.consents.read',
  PRIVACY_CONSENTS_MANAGE: 'privacy.consents.manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Alcance de los datos sobre los que se ejerce un permiso.
 * - ALL: toda la institución.
 * - ASSIGNED: lo asignado al usuario (sus cursos, grupos, niveles o sedes).
 * - OWN: los registros propios del usuario.
 * - LINKED: los estudiantes vinculados (acudientes).
 */
export const PERMISSION_SCOPES = ['ALL', 'ASSIGNED', 'OWN', 'LINKED'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export interface PermissionDefinition {
  code: PermissionCode;
  module: string;
  description: string;
  /**
   * Alcances que el módulo sabe aplicar para este permiso. Por defecto solo
   * ALL: un alcance se habilita aquí únicamente cuando sus endpoints filtran
   * los datos según él (p. ej. ASSIGNED para las notas de los docentes).
   */
  allowedScopes?: readonly PermissionScope[];
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  {
    code: PERMISSIONS.DASHBOARD_VIEW,
    module: 'dashboard',
    description: 'Ver el tablero de indicadores',
  },
  {
    code: PERMISSIONS.INSTITUTION_READ,
    module: 'institution',
    description: 'Consultar los datos de la institución',
  },
  {
    code: PERMISSIONS.INSTITUTION_UPDATE,
    module: 'institution',
    description: 'Editar los datos de la institución',
  },
  {
    code: PERMISSIONS.INSTITUTION_SETTINGS_UPDATE,
    module: 'institution',
    description: 'Editar la configuración regional, la marca y las preferencias',
  },
  { code: PERMISSIONS.CAMPUSES_MANAGE, module: 'institution', description: 'Crear y editar sedes' },
  {
    code: PERMISSIONS.SHIFTS_MANAGE,
    module: 'institution',
    description: 'Crear y editar jornadas',
  },
  { code: PERMISSIONS.USERS_READ, module: 'users', description: 'Consultar usuarios' },
  { code: PERMISSIONS.USERS_CREATE, module: 'users', description: 'Crear usuarios' },
  { code: PERMISSIONS.USERS_UPDATE, module: 'users', description: 'Editar datos de usuarios' },
  {
    code: PERMISSIONS.USERS_STATUS,
    module: 'users',
    description: 'Activar o suspender usuarios y enviar recuperación de contraseña',
  },
  {
    code: PERMISSIONS.USERS_ROLES_ASSIGN,
    module: 'users',
    description: 'Asignar roles a usuarios',
  },
  { code: PERMISSIONS.ROLES_READ, module: 'access', description: 'Consultar roles y permisos' },
  {
    code: PERMISSIONS.ROLES_MANAGE,
    module: 'access',
    description: 'Crear y editar roles personalizados',
  },
  {
    code: PERMISSIONS.AUDIT_READ,
    module: 'audit',
    description: 'Consultar el registro de auditoría',
  },
  {
    code: PERMISSIONS.ACADEMICS_READ,
    module: 'academics',
    description: 'Consultar la estructura académica',
  },
  {
    code: PERMISSIONS.ACADEMICS_MANAGE,
    module: 'academics',
    description: 'Editar niveles, grados, grupos, áreas y asignaturas',
  },
  {
    code: PERMISSIONS.ACADEMIC_YEARS_MANAGE,
    module: 'academics',
    description: 'Gestionar años lectivos y períodos',
  },
  {
    code: PERMISSIONS.GRADING_MANAGE,
    module: 'academics',
    description:
      'Configurar el SIEE de cada año: escala, niveles de desempeño y reglas de promoción',
  },
  {
    code: PERMISSIONS.STUDENTS_READ,
    module: 'students',
    description: 'Consultar estudiantes y sus acudientes',
    // ASSIGNED: solo los estudiantes ubicados en los grupos del docente.
    allowedScopes: ['ALL', 'ASSIGNED'],
  },
  {
    code: PERMISSIONS.STUDENTS_MANAGE,
    module: 'students',
    description: 'Registrar y editar estudiantes y sus vínculos con acudientes',
  },
  { code: PERMISSIONS.GUARDIANS_READ, module: 'guardians', description: 'Consultar acudientes' },
  {
    code: PERMISSIONS.GUARDIANS_MANAGE,
    module: 'guardians',
    description: 'Registrar y editar acudientes',
  },
  {
    code: PERMISSIONS.STAFF_READ,
    module: 'staff',
    description: 'Consultar el personal (docentes, directivos, administrativos)',
  },
  {
    code: PERMISSIONS.STAFF_MANAGE,
    module: 'staff',
    description: 'Registrar y editar el personal',
  },
  {
    code: PERMISSIONS.ENROLLMENTS_READ,
    module: 'enrollments',
    description: 'Consultar matrículas y su historial',
    allowedScopes: ['ALL', 'ASSIGNED'],
  },
  {
    code: PERMISSIONS.ENROLLMENTS_MANAGE,
    module: 'enrollments',
    description: 'Matricular, cambiar de grupo, retirar, trasladar y renovar matrículas',
  },
  {
    code: PERMISSIONS.GRADES_READ,
    module: 'grades',
    description: 'Consultar actividades evaluativas y notas',
    // ASSIGNED: solo las asignaturas y grupos asignados al docente.
    allowedScopes: ['ALL', 'ASSIGNED'],
  },
  {
    code: PERMISSIONS.GRADES_MANAGE,
    module: 'grades',
    description: 'Crear actividades evaluativas y registrar notas en períodos abiertos',
    allowedScopes: ['ALL', 'ASSIGNED'],
  },
  {
    code: PERMISSIONS.TEACHING_READ,
    module: 'teaching',
    description: 'Consultar la asignación académica y las listas de clase',
    // ASSIGNED: solo las asignaciones propias del docente.
    allowedScopes: ['ALL', 'ASSIGNED'],
  },
  {
    code: PERMISSIONS.TEACHING_MANAGE,
    module: 'teaching',
    description: 'Asignar, reemplazar y finalizar docentes de grupos y asignaturas',
  },
  {
    code: PERMISSIONS.ADMISSIONS_READ,
    module: 'admissions',
    description: 'Consultar solicitudes de admisión y sus documentos',
  },
  {
    code: PERMISSIONS.ADMISSIONS_MANAGE,
    module: 'admissions',
    description:
      'Registrar y editar solicitudes, adjuntar documentos, enviarlas a revisión y matricular admitidos',
  },
  {
    code: PERMISSIONS.ADMISSIONS_DECIDE,
    module: 'admissions',
    description: 'Aprobar, rechazar o dejar en espera solicitudes de admisión',
  },
  {
    code: PERMISSIONS.PRIVACY_POLICIES_MANAGE,
    module: 'privacy',
    description: 'Redactar y publicar versiones de la política de tratamiento de datos',
  },
  {
    code: PERMISSIONS.PRIVACY_CONSENTS_READ,
    module: 'privacy',
    description: 'Consultar las políticas, las autorizaciones de tratamiento y su cobertura',
  },
  {
    code: PERMISSIONS.PRIVACY_CONSENTS_MANAGE,
    module: 'privacy',
    description: 'Registrar y revocar autorizaciones de tratamiento de datos y adjuntar su soporte',
  },
];

const DEFAULT_SCOPES: readonly PermissionScope[] = ['ALL'];

/** Alcances admitidos por un permiso del catálogo (vacío si el código no existe). */
export function allowedScopesFor(code: string): readonly PermissionScope[] {
  const definition = PERMISSION_CATALOG.find((p) => p.code === code);
  return definition ? (definition.allowedScopes ?? DEFAULT_SCOPES) : [];
}

/** Roles de sistema. Sus permisos los define la API y no son editables. */
export const SYSTEM_ROLES = {
  TECH_ADMIN: 'TECH_ADMIN',
  INSTITUTION_ADMIN: 'INSTITUTION_ADMIN',
  COORDINATOR: 'COORDINATOR',
  TEACHER: 'TEACHER',
  SECRETARY: 'SECRETARY',
  STUDENT: 'STUDENT',
  GUARDIAN: 'GUARDIAN',
} as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

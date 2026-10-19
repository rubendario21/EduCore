import {
  PERMISSIONS,
  type PermissionCode,
  type PermissionScope,
  SYSTEM_ROLES,
  type SystemRoleCode,
} from '@educore/shared';

export interface SystemRoleTemplate {
  code: SystemRoleCode;
  name: string;
  description: string;
  permissions: ReadonlyArray<{ code: PermissionCode; scope: PermissionScope }>;
}

const all = (...codes: PermissionCode[]) => codes.map((code) => ({ code, scope: 'ALL' as const }));

/**
 * Plantillas de los roles de sistema (matriz de la sección 7 del plan).
 * Se materializan en cada institución y sus permisos se sincronizan con esta
 * definición en cada arranque: no se editan desde la aplicación.
 *
 * Los perfiles académicos (docente, estudiante, acudiente) reciben sus
 * permisos con alcance ASSIGNED/OWN/LINKED en las fases que implementan esos
 * módulos; en la Fase 1 solo pueden autenticarse y consultar su perfil.
 */
export const SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = [
  {
    code: SYSTEM_ROLES.TECH_ADMIN,
    name: 'Administrador técnico',
    description:
      'Configuración técnica del despliegue. No accede a datos académicos ni personales por defecto.',
    permissions: all(
      PERMISSIONS.INSTITUTION_READ,
      PERMISSIONS.INSTITUTION_SETTINGS_UPDATE,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.AUDIT_READ,
    ),
  },
  {
    code: SYSTEM_ROLES.INSTITUTION_ADMIN,
    name: 'Administrador institucional',
    description:
      'Rector o administrador: gestiona la institución, los usuarios y la estructura académica.',
    permissions: all(
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.INSTITUTION_READ,
      PERMISSIONS.INSTITUTION_UPDATE,
      PERMISSIONS.INSTITUTION_SETTINGS_UPDATE,
      PERMISSIONS.CAMPUSES_MANAGE,
      PERMISSIONS.SHIFTS_MANAGE,
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.USERS_STATUS,
      PERMISSIONS.USERS_ROLES_ASSIGN,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.ROLES_MANAGE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.ACADEMICS_READ,
      PERMISSIONS.ACADEMICS_MANAGE,
      PERMISSIONS.ACADEMIC_YEARS_MANAGE,
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.STUDENTS_MANAGE,
      PERMISSIONS.GUARDIANS_READ,
      PERMISSIONS.GUARDIANS_MANAGE,
      PERMISSIONS.STAFF_READ,
      PERMISSIONS.STAFF_MANAGE,
    ),
  },
  {
    code: SYSTEM_ROLES.COORDINATOR,
    name: 'Coordinador',
    description: 'Directivo docente: supervisa procesos académicos según su alcance.',
    permissions: all(
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.INSTITUTION_READ,
      PERMISSIONS.USERS_READ,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.ACADEMICS_READ,
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.GUARDIANS_READ,
      PERMISSIONS.STAFF_READ,
    ),
  },
  {
    code: SYSTEM_ROLES.SECRETARY,
    name: 'Secretaría académica',
    description: 'Personal administrativo: admisiones, matrículas y gestión documental.',
    permissions: all(
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.INSTITUTION_READ,
      PERMISSIONS.USERS_READ,
      PERMISSIONS.ACADEMICS_READ,
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.STUDENTS_MANAGE,
      PERMISSIONS.GUARDIANS_READ,
      PERMISSIONS.GUARDIANS_MANAGE,
      PERMISSIONS.STAFF_READ,
    ),
  },
  {
    code: SYSTEM_ROLES.TEACHER,
    name: 'Docente',
    description: 'Gestiona sus cursos asignados.',
    permissions: all(PERMISSIONS.ACADEMICS_READ),
  },
  {
    code: SYSTEM_ROLES.STUDENT,
    name: 'Estudiante',
    description: 'Consulta su información académica.',
    permissions: [],
  },
  {
    code: SYSTEM_ROLES.GUARDIAN,
    name: 'Acudiente',
    description: 'Consulta la información de los estudiantes vinculados.',
    permissions: [],
  },
];

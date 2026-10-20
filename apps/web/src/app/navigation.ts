import { type PermissionCode, PERMISSIONS } from '@educore/shared';
import { type Profile } from '@/features/auth/profiles';
import {
  Activity,
  BookOpen,
  Briefcase,
  Building2,
  ClipboardList,
  FileInput,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  Lock,
  type LucideIcon,
  NotebookPen,
  ScrollText,
  ShieldCheck,
  UserRoundPlus,
  Users,
  UsersRound,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Permiso necesario para ver la opción. Sin permiso = visible para cualquier usuario con sesión. */
  permission?: PermissionCode;
  /** Exige el permiso con alcance institucional (no basta lo asignado, p. ej. a un docente). */
  scope?: 'ALL';
  /**
   * Perfiles (además de Administrativo, que ve todo lo que sus permisos
   * permiten) en cuyo menú aparece la opción.
   */
  profiles?: Profile[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Menú lateral. Mostrar u ocultar opciones es solo una ayuda de navegación:
 * cada ruta vuelve a comprobar el permiso y la API lo verifica siempre.
 * Los módulos de fases posteriores se añaden aquí cuando existan.
 */
export const NAVIGATION: NavSection[] = [
  {
    title: 'Principal',
    items: [
      {
        to: '/',
        label: 'Inicio',
        icon: LayoutDashboard,
        profiles: ['TEACHER', 'GUARDIAN', 'STUDENT'],
      },
    ],
  },
  {
    title: 'Comunidad',
    items: [
      {
        to: '/estudiantes',
        label: 'Estudiantes',
        icon: GraduationCap,
        permission: PERMISSIONS.STUDENTS_READ,
        scope: 'ALL',
      },
      {
        to: '/acudientes',
        label: 'Acudientes',
        icon: UsersRound,
        permission: PERMISSIONS.GUARDIANS_READ,
      },
      { to: '/personal', label: 'Personal', icon: Briefcase, permission: PERMISSIONS.STAFF_READ },
    ],
  },
  {
    title: 'Matrícula',
    items: [
      {
        to: '/admisiones',
        label: 'Admisiones',
        icon: UserRoundPlus,
        permission: PERMISSIONS.ADMISSIONS_READ,
      },
      {
        to: '/matriculas',
        label: 'Matrículas',
        icon: ClipboardList,
        permission: PERMISSIONS.ENROLLMENTS_READ,
        scope: 'ALL',
      },
      {
        to: '/importar-estudiantes',
        label: 'Importar estudiantes',
        icon: FileInput,
        permission: PERMISSIONS.STUDENTS_MANAGE,
      },
    ],
  },
  {
    title: 'Académico',
    items: [
      {
        to: '/mis-cursos',
        label: 'Mis cursos',
        icon: NotebookPen,
        permission: PERMISSIONS.TEACHING_READ,
        profiles: ['TEACHER'],
      },
      {
        to: '/academico',
        label: 'Estructura académica',
        icon: BookOpen,
        permission: PERMISSIONS.ACADEMICS_READ,
        scope: 'ALL',
      },
      {
        to: '/asignacion-academica',
        label: 'Asignación académica',
        icon: ListChecks,
        permission: PERMISSIONS.TEACHING_READ,
        scope: 'ALL',
      },
    ],
  },
  {
    title: 'Administración',
    items: [
      { to: '/usuarios', label: 'Usuarios', icon: Users, permission: PERMISSIONS.USERS_READ },
      {
        to: '/roles',
        label: 'Roles y permisos',
        icon: ShieldCheck,
        permission: PERMISSIONS.ROLES_READ,
      },
      {
        to: '/institucion',
        label: 'Institución',
        icon: Building2,
        permission: PERMISSIONS.INSTITUTION_READ,
      },
      {
        to: '/proteccion-datos',
        label: 'Protección de datos',
        icon: Lock,
        permission: PERMISSIONS.PRIVACY_CONSENTS_READ,
      },
      {
        to: '/auditoria',
        label: 'Auditoría',
        icon: ScrollText,
        permission: PERMISSIONS.AUDIT_READ,
      },
      {
        to: '/sistema',
        label: 'Estado del sistema',
        icon: Activity,
        permission: PERMISSIONS.INSTITUTION_SETTINGS_UPDATE,
      },
    ],
  },
];

/**
 * Secciones con solo las opciones permitidas para el perfil activo (sin
 * secciones vacías). El perfil solo ordena el menú; los permisos los aplica la API.
 */
export function visibleNavigation(
  can: (permission: PermissionCode, scope?: 'ALL') => boolean,
  profile: Profile | null = 'STAFF',
): NavSection[] {
  const inProfile = (item: NavItem) =>
    profile === 'STAFF' || profile === null || (item.profiles?.includes(profile) ?? false);
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => inProfile(item) && (!item.permission || can(item.permission, item.scope)),
    ),
  })).filter((section) => section.items.length > 0);
}

import { type PermissionCode, PERMISSIONS } from '@educore/shared';
import {
  Activity,
  BookOpen,
  Building2,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Permiso necesario para ver la opción. Sin permiso = visible para cualquier usuario con sesión. */
  permission?: PermissionCode;
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
    items: [{ to: '/', label: 'Inicio', icon: LayoutDashboard }],
  },
  {
    title: 'Académico',
    items: [
      {
        to: '/academico',
        label: 'Estructura académica',
        icon: BookOpen,
        permission: PERMISSIONS.ACADEMICS_READ,
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

/** Secciones con solo las opciones permitidas (sin secciones vacías). */
export function visibleNavigation(can: (permission: PermissionCode) => boolean): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((section) => section.items.length > 0);
}

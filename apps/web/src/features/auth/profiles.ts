import { SYSTEM_ROLES } from '@educore/shared';
import { type LucideIcon, Briefcase, GraduationCap, NotebookPen, UsersRound } from 'lucide-react';
import { type AuthUser } from './types';

/**
 * Perfil con el que la persona usa EduCore. Es una VISTA: ordena el menú y la
 * pantalla de llegada, pero no concede ni quita permisos (los aplica la API
 * según los roles de la cuenta). Una docente que además es acudiente tiene dos
 * perfiles y cambia entre ellos sin volver a iniciar sesión.
 */
export const PROFILES = ['STAFF', 'TEACHER', 'GUARDIAN', 'STUDENT'] as const;
export type Profile = (typeof PROFILES)[number];

export const PROFILE_INFO: Record<
  Profile,
  { label: string; description: string; icon: LucideIcon }
> = {
  STUDENT: {
    label: 'Estudiante',
    description: 'Consulta tu información académica.',
    icon: GraduationCap,
  },
  GUARDIAN: {
    label: 'Acudiente',
    description: 'Sigue el proceso de tus estudiantes.',
    icon: UsersRound,
  },
  TEACHER: { label: 'Docente', description: 'Tus cursos y listas de clase.', icon: NotebookPen },
  STAFF: { label: 'Administrativo', description: 'Gestión de la institución.', icon: Briefcase },
};

/** Perfiles que permiten los roles de la cuenta (cualquier otro rol cuenta como administrativo). */
export function profilesOf(user: Pick<AuthUser, 'roles'>): Profile[] {
  const found = new Set<Profile>();
  for (const { code } of user.roles) {
    if (code === SYSTEM_ROLES.STUDENT) found.add('STUDENT');
    else if (code === SYSTEM_ROLES.GUARDIAN) found.add('GUARDIAN');
    else if (code === SYSTEM_ROLES.TEACHER) found.add('TEACHER');
    else found.add('STAFF');
  }
  return PROFILES.filter((p) => found.has(p));
}

/** El perfil preferido si la cuenta lo tiene; si no, el primero disponible. */
export function resolveProfile(available: Profile[], preferred: Profile | null): Profile | null {
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] ?? null;
}

/** Pantalla de llegada de cada perfil. */
export function landingOf(profile: Profile | null): string {
  return profile === 'TEACHER' ? '/mis-cursos' : '/';
}

// --- Preferencia del navegador (comodidad, no seguridad) ----------------------

const STORAGE_KEY = 'educore.profile';

export function readPreferredProfile(): Profile | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return PROFILES.includes(value as Profile) ? (value as Profile) : null;
  } catch {
    return null;
  }
}

export function savePreferredProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // Navegación privada o almacenamiento bloqueado: se usa el perfil por defecto.
  }
}

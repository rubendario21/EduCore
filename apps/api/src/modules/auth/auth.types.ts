import { type PermissionScope } from '@educore/shared';

/** Contenido del token de acceso (JWT). No incluye permisos: se cargan en cada petición. */
export interface AccessTokenPayload {
  /** Usuario (cuenta global). */
  sub: string;
  /** Membresía activa (usuario en una institución). */
  mid: string;
  /** Institución de la membresía. */
  iid: string;
  /** Sesión que emitió el token: permite revocarlo antes de que expire. */
  sid: string;
}

/**
 * Identidad y permisos del usuario en la petición actual. Lo construye el
 * guard de autenticación a partir de la base de datos, no del token.
 */
export interface AuthContext {
  userId: string;
  email: string;
  membershipId: string;
  institutionId: string;
  sessionId: string;
  familyId: string;
  roleCodes: string[];
  /** Código de permiso → alcances concedidos (unión de todos los roles). */
  permissions: Map<string, Set<PermissionScope>>;
}

/** Datos de la petición que se guardan con la sesión y la auditoría. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

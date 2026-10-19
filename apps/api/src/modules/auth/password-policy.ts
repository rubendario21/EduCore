/**
 * Política de contraseñas alineada con NIST SP 800-63B: longitud mínima,
 * lista de contraseñas comunes y sin reglas de composición ni caducidad
 * forzadas (empujan a contraseñas predecibles).
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Contraseñas frecuentes en filtraciones y variantes locales obvias. */
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '12345678910',
  '1q2w3e4r5t',
  'qwertyuiop',
  'asdfghjklñ',
  'password123',
  'password1234',
  'contraseña',
  'contraseña1',
  'contraseña123',
  'contrasena123',
  'colombia123',
  'colombia2026',
  'bogota2026',
  'colegio123',
  'colegio2026',
  'educore123',
  'educore2026',
  'peoplecore1',
  'administrador',
  'admin12345',
  'iloveyou12',
  'abcdefghij',
  'abc1234567',
  'qwerty1234',
  'welcome123',
  'bienvenido1',
  'bienvenido123',
  'aaaaaaaaaa',
]);

export interface PasswordPolicyContext {
  email?: string | null;
  firstNames?: string | null;
  lastNames?: string | null;
}

/** Devuelve la lista de incumplimientos en español; vacía si la contraseña es aceptable. */
export function checkPasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {},
): string[] {
  const problems: string[] = [];
  const length = [...password].length;

  if (length < PASSWORD_MIN_LENGTH) {
    problems.push(`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    problems.push(`No puede superar ${PASSWORD_MAX_LENGTH} caracteres.`);
  }

  const normalized = password.toLocaleLowerCase('es-CO');
  if (COMMON_PASSWORDS.has(normalized) || /^(.)\1+$/.test(normalized)) {
    problems.push('Es una contraseña demasiado común. Elige otra.');
  }

  const localPart = context.email?.split('@')[0]?.toLocaleLowerCase('es-CO');
  if (localPart && localPart.length >= 4 && normalized.includes(localPart)) {
    problems.push('No debe contener tu correo electrónico.');
  }

  const names = [context.firstNames, context.lastNames]
    .flatMap((value) => value?.toLocaleLowerCase('es-CO').split(/\s+/) ?? [])
    .filter((name) => name.length >= 4);
  if (names.some((name) => normalized === name || normalized.startsWith(name + '1'))) {
    problems.push('No debe basarse en tu nombre.');
  }

  return problems;
}

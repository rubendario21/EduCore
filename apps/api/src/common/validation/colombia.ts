/**
 * Validaciones propias de Colombia.
 */

/** Pesos oficiales de la DIAN para el dígito de verificación, de derecha a izquierda. */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/**
 * Calcula el dígito de verificación (DV) de un NIT según el algoritmo de la
 * DIAN (módulo 11). Recibe el NIT sin puntos, guiones ni DV.
 */
export function nitCheckDigit(nit: string): number {
  if (!/^\d{1,15}$/.test(nit)) throw new Error('El NIT debe tener entre 1 y 15 dígitos');
  const digits = [...nit].reverse().map(Number);
  const sum = digits.reduce((total, digit, index) => total + digit * NIT_WEIGHTS[index]!, 0);
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

export function isValidNit(nit: string, checkDigit: string): boolean {
  return /^\d$/.test(checkDigit) && nitCheckDigit(nit) === Number(checkDigit);
}

/** Fecha de calendario `AAAA-MM-DD` válida (rechaza p. ej. 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Convierte `AAAA-MM-DD` a Date (medianoche UTC), como se guarda en columnas `date`. */
export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Convierte una columna `date` a `AAAA-MM-DD`. */
export function fromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

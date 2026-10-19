/** Formatos de presentación en español de Colombia. */

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateTimeFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Fecha de calendario `AAAA-MM-DD` (sin zona horaria). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

/** Instante ISO 8601, en la hora local del navegador. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return dateTimeFormatter.format(new Date(value));
}

export function fullName(person: { firstNames: string; lastNames: string }): string {
  return `${person.firstNames} ${person.lastNames}`;
}

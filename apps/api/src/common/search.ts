/**
 * Normaliza un texto de búsqueda igual que la columna `person.search_text`
 * (trigger de la migración 0004): minúsculas, sin tildes y espacios simples.
 * Así "sofia" encuentra a "Sofía" y "PEREZ" a "Pérez".
 */
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

import { describe, expect, it } from 'vitest';
import { isCalendarDate, isValidNit, nitCheckDigit } from './colombia';

describe('nitCheckDigit (algoritmo DIAN)', () => {
  // NIT públicos de entidades conocidas, con su DV publicado.
  it.each([
    ['899999063', 3], // Universidad Nacional de Colombia
    ['800197268', 4], // DIAN
    ['860034313', 7], // Banco Davivienda
    ['890903938', 8], // Bancolombia
    ['899999001', 7], // Ministerio de Educación Nacional
  ])('el NIT %s tiene DV %i', (nit, dv) => {
    expect(nitCheckDigit(nit)).toBe(dv);
  });

  it('valida la pareja NIT-DV', () => {
    expect(isValidNit('800197268', '4')).toBe(true);
    expect(isValidNit('800197268', '5')).toBe(false);
    expect(isValidNit('800197268', 'x')).toBe(false);
  });

  it('rechaza NIT con caracteres no numéricos', () => {
    expect(() => nitCheckDigit('800.197.268')).toThrow();
  });
});

describe('isCalendarDate', () => {
  it('acepta fechas reales en formato AAAA-MM-DD', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
  });

  it('rechaza fechas inexistentes o con otro formato', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('01/02/2026')).toBe(false);
    expect(isCalendarDate('2026-02-01T00:00:00Z')).toBe(false);
  });
});

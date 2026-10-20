import { describe, expect, it } from 'vitest';
import {
  mapColumns,
  normalizeHeader,
  parseDate,
  parseDocumentType,
  parseRelationship,
  parseYesNo,
  validatePerson,
} from './student-import.columns';

describe('Importación: interpretación de columnas y valores', () => {
  it('normaliza encabezados sin importar mayúsculas, tildes ni espacios', () => {
    expect(normalizeHeader('Número de documento')).toBe('numero_de_documento');
    expect(normalizeHeader('  Acudiente Parentesco ')).toBe('acudiente_parentesco');
    expect(normalizeHeader('Año')).toBe('ano');
  });

  it('ubica las columnas, informa las faltantes, desconocidas y repetidas', () => {
    const mapping = mapColumns(['Nombres', 'Apellidos', 'Año', 'Color favorito', 'nombres']);
    expect(mapping.positions).toMatchObject({ firstNames: 0, lastNames: 1, year: 2 });
    expect(mapping.missing).toEqual(['tipo_documento', 'numero_documento']);
    expect(mapping.unknown).toEqual(['Color favorito']);
    expect(mapping.duplicated).toEqual(['nombres']);
  });

  it('interpreta fechas en AAAA-MM-DD y DD/MM/AAAA, y rechaza fechas inexistentes', () => {
    expect(parseDate('2015-03-09')).toBe('2015-03-09');
    expect(parseDate('9/3/2015')).toBe('2015-03-09');
    expect(parseDate('09-03-2015')).toBe('2015-03-09');
    expect(parseDate('31/02/2015')).toBeNull();
    expect(parseDate('03/09/15')).toBeNull();
  });

  it('interpreta parentescos, SI/NO y tipos de documento escritos a mano', () => {
    expect(parseRelationship('Mamá')).toBe('MOTHER');
    expect(parseRelationship('TÍA')).toBe('UNCLE_AUNT');
    expect(parseRelationship('Tutor legal')).toBe('LEGAL_GUARDIAN');
    expect(parseRelationship('vecino')).toBeNull();
    expect(parseYesNo('Sí')).toBe(true);
    expect(parseYesNo('')).toBe(false);
    expect(parseYesNo('tal vez')).toBeNull();
    expect(parseDocumentType('t.i.')).toBe('TI');
  });

  it('valida personas con las reglas del registro manual y señala la columna', () => {
    const ok = validatePerson(
      { documentType: 'TI', documentNumber: '1012345678', firstNames: 'Sofía', lastNames: 'López' },
      'student',
    );
    expect(ok.errors).toEqual([]);
    const bad = validatePerson(
      {
        documentType: 'XX',
        documentNumber: '1',
        firstNames: 'S',
        lastNames: 'López',
        email: 'no-es-correo',
      },
      'guardian',
    );
    expect(bad.person).toBeNull();
    expect(bad.errors.map((e) => e.column).sort()).toEqual([
      'acudiente_correo',
      'acudiente_nombres',
      'acudiente_numero_documento',
      'acudiente_tipo_documento',
    ]);
  });
});

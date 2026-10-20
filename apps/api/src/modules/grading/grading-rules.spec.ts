import {
  computePeriodScore,
  DECREE_1290_EXAMPLE,
  isOnScale,
  isPassing,
  levelFor,
  roundScore,
  validateComponents,
  validateGradingScheme,
} from '@educore/shared';
import { describe, expect, it } from 'vitest';

const { scale, levels } = DECREE_1290_EXAMPLE;

describe('Reglas del SIEE (compartidas con la web)', () => {
  it('el ejemplo del Decreto 1290 es una configuración válida', () => {
    expect(validateGradingScheme(scale, levels)).toEqual([]);
  });

  it('redondea sin errores de punto flotante', () => {
    expect(roundScore(3.45, 1, 'HALF_UP')).toBe(3.5);
    expect(roundScore(2.95, 1, 'HALF_UP')).toBe(3);
    expect(roundScore(2.99, 1, 'TRUNCATE')).toBe(2.9);
    // 0,1 + 0,2 = 0,30000000000000004 en binario.
    expect(roundScore(0.1 + 0.2, 1, 'TRUNCATE')).toBe(0.3);
    expect(roundScore((4.2 + 3.6 + 3.9) / 3, 2, 'HALF_UP')).toBe(3.9);
  });

  it('valida que la nota esté en la escala y con sus decimales', () => {
    expect(isOnScale(3.5, scale)).toBe(true);
    expect(isOnScale(5, scale)).toBe(true);
    expect(isOnScale(0.9, scale)).toBe(false);
    expect(isOnScale(5.1, scale)).toBe(false);
    expect(isOnScale(3.55, scale)).toBe(false);
    expect(isOnScale(Number.NaN, scale)).toBe(false);
  });

  it('ubica el nivel de desempeño y la aprobación, incluso en los bordes', () => {
    expect(levelFor(2.9, levels, 1)?.code).toBe('BAJO');
    expect(levelFor(3, levels, 1)?.code).toBe('BASICO');
    expect(levelFor(4.5, levels, 1)?.code).toBe('ALTO');
    expect(levelFor(4.6, levels, 1)?.code).toBe('SUPERIOR');
    expect(isPassing(2.9, scale)).toBe(false);
    expect(isPassing(3, scale)).toBe(true);
  });

  it('detecta huecos, solapes, bordes y precisión incorrectos', () => {
    const withGap = levels.map((l) => (l.code === 'BASICO' ? { ...l, minScore: 3.1 } : l));
    expect(validateGradingScheme(scale, withGap)).toEqual([
      expect.stringMatching(/hueco entre "Desempeño Bajo" y "Desempeño Básico"/),
    ]);
    const overlapping = levels.map((l) => (l.code === 'ALTO' ? { ...l, maxScore: 4.7 } : l));
    expect(validateGradingScheme(scale, overlapping)).toEqual([
      expect.stringMatching(/se solapan/),
    ]);
    const short = levels.filter((l) => l.code !== 'SUPERIOR');
    expect(validateGradingScheme(scale, short)).toEqual([expect.stringMatching(/terminar en 5,0/)]);
    expect(validateGradingScheme({ ...scale, passingScore: 6 }, levels)).toEqual([
      expect.stringMatching(/aprobación debe estar entre 1,0 y 5,0/),
    ]);
    expect(validateGradingScheme({ ...scale, decimals: 0 }, levels)[0]).toMatch(/0 decimal/);
    expect(validateGradingScheme({ ...scale, minScore: 5, maxScore: 1 }, levels)).toEqual([
      'La nota mínima debe ser menor que la máxima.',
    ]);
    const duplicated = [...levels, { ...levels[0]!, name: 'Otro' }];
    expect(validateGradingScheme(scale, duplicated)).toContain(
      'Cada nivel de desempeño debe tener un código distinto.',
    );
  });

  it('admite escalas propias (p. ej. 0 a 100 sin decimales)', () => {
    const custom = {
      minScore: 0,
      maxScore: 100,
      decimals: 0,
      passingScore: 60,
      rounding: 'HALF_UP' as const,
    };
    const customLevels = [
      { code: 'NO_APRUEBA', name: 'No aprueba', minScore: 0, maxScore: 59 },
      { code: 'APRUEBA', name: 'Aprueba', minScore: 60, maxScore: 100 },
    ];
    expect(validateGradingScheme(custom, customLevels)).toEqual([]);
    expect(levelFor(59, customLevels, 0)?.code).toBe('NO_APRUEBA');
    expect(isOnScale(59.5, custom)).toBe(false);
  });

  it('los componentes deben sumar 100 % y tener códigos distintos', () => {
    const ok = [
      { code: 'COG', name: 'Cognitivo', weightPercent: 60 },
      { code: 'PRO', name: 'Procedimental', weightPercent: 30 },
      { code: 'ACT', name: 'Actitudinal', weightPercent: 10 },
    ];
    expect(validateComponents(ok)).toEqual([]);
    expect(
      validateComponents([
        { code: 'A', name: 'A', weightPercent: 33.33 },
        { code: 'B', name: 'B', weightPercent: 33.33 },
        { code: 'C', name: 'C', weightPercent: 33.34 },
      ]),
    ).toEqual([]);
    expect(validateComponents(ok.slice(0, 2))).toEqual([expect.stringMatching(/suman 90 %/)]);
    expect(validateComponents([...ok.slice(0, 2), { ...ok[2]!, code: 'COG' }])).toContain(
      'Cada componente debe tener un código distinto.',
    );
    expect(validateComponents([])).toEqual(['Define al menos un componente de evaluación.']);
  });

  it('calcula la nota del período: promedio por componente, ponderado y redondeado al final', () => {
    const result = computePeriodScore(
      [
        { weightPercent: 60, scores: [4, 3.5] }, // 3,75
        { weightPercent: 30, scores: [3] },
        { weightPercent: 10, scores: [5] },
      ],
      { decimals: 1, rounding: 'HALF_UP' },
    );
    // 3,75·0,6 + 3·0,3 + 5·0,1 = 3,65 → 3,7 (se redondea una sola vez).
    expect(result).toEqual({ score: 3.7, componentsWithData: 3 });
  });

  it('una nota parcial reparte el peso de los componentes sin notas; sin notas es "sin datos"', () => {
    const partial = computePeriodScore(
      [
        { weightPercent: 60, scores: [4] },
        { weightPercent: 40, scores: [] },
      ],
      { decimals: 1, rounding: 'HALF_UP' },
    );
    expect(partial).toEqual({ score: 4, componentsWithData: 1 });
    expect(
      computePeriodScore([{ weightPercent: 100, scores: [] }], {
        decimals: 1,
        rounding: 'HALF_UP',
      }),
    ).toEqual({
      score: null,
      componentsWithData: 0,
    });
  });
});

/**
 * Reglas del SIEE compartidas por la API y la web (Decreto 1290 de 2009).
 * Ninguna escala está fija: cada institución configura la suya por año lectivo.
 *
 * Los cálculos se hacen en "unidades" enteras (nota × 10^decimales) para no
 * arrastrar errores de punto flotante (p. ej. 2,9 + 0,1 ≠ 3,0 en binario).
 */

export const ROUNDING_MODES = ['HALF_UP', 'TRUNCATE'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export const PROMOTION_UNITS = ['AREA', 'SUBJECT'] as const;
export type PromotionUnit = (typeof PROMOTION_UNITS)[number];

export interface GradingScale {
  minScore: number;
  maxScore: number;
  /** Decimales de las notas: 0, 1 o 2. */
  decimals: number;
  passingScore: number;
  rounding: RoundingMode;
}

export interface PerformanceLevelRange {
  code: string;
  name: string;
  minScore: number;
  maxScore: number;
}

const factor = (decimals: number) => 10 ** decimals;

/** Nota en unidades enteras de la escala. */
export function toUnits(value: number, decimals: number): number {
  return Math.round(value * factor(decimals));
}

/** ¿La nota tiene como máximo los decimales configurados? */
export function hasValidPrecision(value: number, decimals: number): boolean {
  return Math.abs(value * factor(decimals) - toUnits(value, decimals)) < 1e-6;
}

/** Redondea un resultado calculado (p. ej. un promedio) a los decimales de la escala. */
export function roundScore(value: number, decimals: number, mode: RoundingMode): number {
  const scaled = value * factor(decimals);
  // El pequeño margen corrige representaciones como 3.4999999999 de un 3,5 exacto.
  const units = mode === 'TRUNCATE' ? Math.floor(scaled + 1e-9) : Math.floor(scaled + 0.5 + 1e-9);
  return units / factor(decimals);
}

/** ¿Es una nota válida para registrar en la escala? */
export function isOnScale(
  score: number,
  scale: Pick<GradingScale, 'minScore' | 'maxScore' | 'decimals'>,
): boolean {
  return (
    Number.isFinite(score) &&
    hasValidPrecision(score, scale.decimals) &&
    toUnits(score, scale.decimals) >= toUnits(scale.minScore, scale.decimals) &&
    toUnits(score, scale.decimals) <= toUnits(scale.maxScore, scale.decimals)
  );
}

export function isPassing(
  score: number,
  scale: Pick<GradingScale, 'passingScore' | 'decimals'>,
): boolean {
  return toUnits(score, scale.decimals) >= toUnits(scale.passingScore, scale.decimals);
}

/** Nivel de desempeño que corresponde a una nota (null si ninguno la contiene). */
export function levelFor<T extends PerformanceLevelRange>(
  score: number,
  levels: readonly T[],
  decimals: number,
): T | null {
  const units = toUnits(score, decimals);
  return (
    levels.find(
      (l) => units >= toUnits(l.minScore, decimals) && units <= toUnits(l.maxScore, decimals),
    ) ?? null
  );
}

const show = (value: number, decimals: number) => value.toFixed(decimals).replace('.', ',');

/**
 * Problemas de una configuración del SIEE (lista vacía = válida):
 * escala coherente, nota de aprobación dentro de ella y niveles de desempeño
 * que la cubren completa, en orden, sin huecos ni solapes.
 */
export function validateGradingScheme(
  scale: GradingScale,
  levels: readonly PerformanceLevelRange[],
): string[] {
  const problems: string[] = [];
  const { decimals } = scale;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 2) {
    return ['Los decimales de la escala deben ser 0, 1 o 2.'];
  }
  for (const [label, value] of [
    ['La nota mínima', scale.minScore],
    ['La nota máxima', scale.maxScore],
    ['La nota de aprobación', scale.passingScore],
  ] as const) {
    if (!Number.isFinite(value) || !hasValidPrecision(value, decimals)) {
      problems.push(`${label} debe tener como máximo ${decimals} decimal(es).`);
    }
  }
  if (problems.length > 0) return problems;
  if (toUnits(scale.minScore, decimals) >= toUnits(scale.maxScore, decimals)) {
    return ['La nota mínima debe ser menor que la máxima.'];
  }
  if (!isOnScale(scale.passingScore, scale)) {
    problems.push(
      `La nota de aprobación debe estar entre ${show(scale.minScore, decimals)} y ${show(scale.maxScore, decimals)}.`,
    );
  }

  if (levels.length === 0) return [...problems, 'Define al menos un nivel de desempeño.'];
  const codes = levels.map((l) => l.code.trim().toUpperCase());
  if (new Set(codes).size !== codes.length)
    problems.push('Cada nivel de desempeño debe tener un código distinto.');
  if (levels.some((l) => l.name.trim() === ''))
    problems.push('Cada nivel de desempeño debe tener nombre.');

  const sorted = [...levels].sort((a, b) => a.minScore - b.minScore);
  for (const level of sorted) {
    if (
      !hasValidPrecision(level.minScore, decimals) ||
      !hasValidPrecision(level.maxScore, decimals)
    ) {
      problems.push(
        `Los rangos de "${level.name}" deben tener como máximo ${decimals} decimal(es).`,
      );
      return problems;
    }
    if (toUnits(level.minScore, decimals) > toUnits(level.maxScore, decimals)) {
      problems.push(`En "${level.name}" el inicio del rango es mayor que el final.`);
    }
  }
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (toUnits(first.minScore, decimals) !== toUnits(scale.minScore, decimals)) {
    problems.push(
      `El primer nivel debe empezar en ${show(scale.minScore, decimals)} (la nota mínima).`,
    );
  }
  if (toUnits(last.maxScore, decimals) !== toUnits(scale.maxScore, decimals)) {
    problems.push(
      `El último nivel debe terminar en ${show(scale.maxScore, decimals)} (la nota máxima).`,
    );
  }
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    const gap = toUnits(current.minScore, decimals) - toUnits(previous.maxScore, decimals);
    if (gap > 1) {
      problems.push(
        `Hay un hueco entre "${previous.name}" y "${current.name}": ninguna nota queda en ese rango.`,
      );
    } else if (gap < 1) {
      problems.push(
        `"${previous.name}" y "${current.name}" se solapan: una nota quedaría en los dos niveles.`,
      );
    }
  }
  return problems;
}

/**
 * Ejemplo editable con los niveles del Decreto 1290 (art. 5) en una escala de
 * 1,0 a 5,0. No es obligatorio: cada institución define los suyos.
 */
export const DECREE_1290_EXAMPLE: { scale: GradingScale; levels: PerformanceLevelRange[] } = {
  scale: { minScore: 1, maxScore: 5, decimals: 1, passingScore: 3, rounding: 'HALF_UP' },
  levels: [
    { code: 'BAJO', name: 'Desempeño Bajo', minScore: 1, maxScore: 2.9 },
    { code: 'BASICO', name: 'Desempeño Básico', minScore: 3, maxScore: 3.9 },
    { code: 'ALTO', name: 'Desempeño Alto', minScore: 4, maxScore: 4.5 },
    { code: 'SUPERIOR', name: 'Desempeño Superior', minScore: 4.6, maxScore: 5 },
  ],
};

// --- Componentes de evaluación y nota del período -------------------------------

export interface EvaluationComponentInput {
  code: string;
  name: string;
  /** Peso del componente en la nota del período (%); todos suman 100. */
  weightPercent: number;
}

/** Problemas de los componentes del SIEE (lista vacía = válidos). */
export function validateComponents(components: readonly EvaluationComponentInput[]): string[] {
  if (components.length === 0) return ['Define al menos un componente de evaluación.'];
  const problems: string[] = [];
  const codes = components.map((c) => c.code.trim().toUpperCase());
  if (new Set(codes).size !== codes.length)
    problems.push('Cada componente debe tener un código distinto.');
  if (components.some((c) => c.name.trim() === ''))
    problems.push('Cada componente debe tener nombre.');
  if (components.some((c) => !(c.weightPercent > 0) || !hasValidPrecision(c.weightPercent, 2))) {
    problems.push('Cada componente debe pesar más de 0 %, con hasta 2 decimales.');
  }
  const total = components.reduce((sum, c) => sum + toUnits(c.weightPercent, 2), 0);
  if (total !== 10_000) {
    problems.push(
      `Los pesos de los componentes deben sumar 100 % (suman ${(total / 100).toString().replace('.', ',')} %).`,
    );
  }
  return problems;
}

/** Un único componente al 100 % para instituciones que no dividen la nota. */
export const DEFAULT_COMPONENTS: EvaluationComponentInput[] = [
  { code: 'GENERAL', name: 'General', weightPercent: 100 },
];

export interface ComponentScores {
  weightPercent: number;
  /** Notas del estudiante en las actividades del componente (sin las que no tienen nota). */
  scores: readonly number[];
}

/**
 * Nota del período (parcial o definitiva) según el SIEE:
 * 1. En cada componente, el promedio simple de las actividades con nota.
 * 2. La nota es el promedio de los componentes ponderado por su peso. Si un
 *    componente aún no tiene notas, su peso se reparte entre los demás (nota
 *    parcial); sin ninguna nota, el resultado es null ("sin datos", no 0).
 * 3. Se redondea una sola vez, al final, con los decimales y el modo del SIEE.
 */
export function computePeriodScore(
  components: readonly ComponentScores[],
  scale: Pick<GradingScale, 'decimals' | 'rounding'>,
): { score: number | null; componentsWithData: number } {
  let weighted = 0;
  let weights = 0;
  let componentsWithData = 0;
  for (const component of components) {
    if (component.scores.length === 0) continue;
    const average = component.scores.reduce((sum, s) => sum + s, 0) / component.scores.length;
    weighted += average * component.weightPercent;
    weights += component.weightPercent;
    componentsWithData++;
  }
  if (weights === 0) return { score: null, componentsWithData: 0 };
  return {
    score: roundScore(weighted / weights, scale.decimals, scale.rounding),
    componentsWithData,
  };
}

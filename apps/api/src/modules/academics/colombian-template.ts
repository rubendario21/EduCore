/**
 * Plantilla académica colombiana (opcional). Cada institución decide si la
 * aplica; todo lo que crea se puede editar o desactivar después.
 *
 * - Niveles y grados: Ley 115 de 1994, arts. 11, 15, 21, 22 y 27
 *   (preescolar, básica primaria, básica secundaria y media).
 * - Áreas obligatorias y fundamentales de la básica: art. 23. La media
 *   académica agrega ciencias económicas, políticas y filosofía (art. 31).
 * - El preescolar se organiza por dimensiones del desarrollo, no por áreas:
 *   la plantilla no le asigna áreas.
 *
 * La plantilla no fija intensidades horarias ni escalas de valoración: el
 * plan de estudios y el SIEE los define cada institución.
 */

export interface TemplateLevel {
  code: string;
  name: string;
  sortOrder: number;
}

export interface TemplateGrade {
  code: string;
  name: string;
  levelCode: string;
  sortOrder: number;
}

export interface TemplateArea {
  code: string;
  name: string;
  /** Asignaturas que se crean dentro del área. */
  subjects: Array<{ code: string; name: string }>;
}

export const COLOMBIAN_LEVELS: readonly TemplateLevel[] = [
  { code: 'PRE', name: 'Preescolar', sortOrder: 1 },
  { code: 'PRI', name: 'Básica primaria', sortOrder: 2 },
  { code: 'SEC', name: 'Básica secundaria', sortOrder: 3 },
  { code: 'MED', name: 'Media', sortOrder: 4 },
];

export const COLOMBIAN_GRADES: readonly TemplateGrade[] = [
  { code: 'PJ', name: 'Prejardín', levelCode: 'PRE', sortOrder: 1 },
  { code: 'J', name: 'Jardín', levelCode: 'PRE', sortOrder: 2 },
  { code: 'T', name: 'Transición', levelCode: 'PRE', sortOrder: 3 },
  { code: '1', name: 'Primero', levelCode: 'PRI', sortOrder: 1 },
  { code: '2', name: 'Segundo', levelCode: 'PRI', sortOrder: 2 },
  { code: '3', name: 'Tercero', levelCode: 'PRI', sortOrder: 3 },
  { code: '4', name: 'Cuarto', levelCode: 'PRI', sortOrder: 4 },
  { code: '5', name: 'Quinto', levelCode: 'PRI', sortOrder: 5 },
  { code: '6', name: 'Sexto', levelCode: 'SEC', sortOrder: 6 },
  { code: '7', name: 'Séptimo', levelCode: 'SEC', sortOrder: 7 },
  { code: '8', name: 'Octavo', levelCode: 'SEC', sortOrder: 8 },
  { code: '9', name: 'Noveno', levelCode: 'SEC', sortOrder: 9 },
  { code: '10', name: 'Décimo', levelCode: 'MED', sortOrder: 10 },
  { code: '11', name: 'Undécimo', levelCode: 'MED', sortOrder: 11 },
];

export const COLOMBIAN_AREAS: readonly TemplateArea[] = [
  {
    code: 'CN',
    name: 'Ciencias naturales y educación ambiental',
    subjects: [{ code: 'CN', name: 'Ciencias naturales' }],
  },
  {
    code: 'CS',
    name: 'Ciencias sociales, historia, geografía, constitución política y democracia',
    subjects: [{ code: 'CS', name: 'Ciencias sociales' }],
  },
  {
    code: 'ART',
    name: 'Educación artística y cultural',
    subjects: [{ code: 'ART', name: 'Educación artística' }],
  },
  {
    code: 'ETI',
    name: 'Educación ética y en valores humanos',
    subjects: [{ code: 'ETI', name: 'Ética y valores' }],
  },
  {
    code: 'EF',
    name: 'Educación física, recreación y deportes',
    subjects: [{ code: 'EF', name: 'Educación física' }],
  },
  {
    code: 'REL',
    name: 'Educación religiosa',
    subjects: [{ code: 'REL', name: 'Educación religiosa' }],
  },
  {
    code: 'HUM',
    name: 'Humanidades, lengua castellana e idiomas extranjeros',
    subjects: [
      { code: 'LC', name: 'Lengua castellana' },
      { code: 'ING', name: 'Inglés' },
    ],
  },
  { code: 'MAT', name: 'Matemáticas', subjects: [{ code: 'MAT', name: 'Matemáticas' }] },
  {
    code: 'TEC',
    name: 'Tecnología e informática',
    subjects: [{ code: 'TEC', name: 'Tecnología e informática' }],
  },
  {
    code: 'CEP',
    name: 'Ciencias económicas y políticas',
    subjects: [{ code: 'CEP', name: 'Ciencias económicas y políticas' }],
  },
  { code: 'FIL', name: 'Filosofía', subjects: [{ code: 'FIL', name: 'Filosofía' }] },
];

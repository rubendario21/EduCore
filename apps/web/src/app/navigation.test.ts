import { PERMISSIONS } from '@educore/shared';
import { describe, expect, it } from 'vitest';
import { readableTextOn } from '@/features/branding/branding';
import { visibleNavigation } from './navigation';

describe('visibleNavigation', () => {
  it('sin permisos solo muestra el inicio', () => {
    const sections = visibleNavigation(() => false);
    expect(sections.map((s) => s.items.map((i) => i.to))).toEqual([['/']]);
  });

  it('muestra solo las opciones permitidas y omite secciones vacías', () => {
    const allowed = new Set<string>([PERMISSIONS.USERS_READ, PERMISSIONS.AUDIT_READ]);
    const sections = visibleNavigation((p) => allowed.has(p));
    expect(sections.map((s) => s.title)).toEqual(['Principal', 'Administración']);
    expect(sections[1]!.items.map((i) => i.to)).toEqual(['/usuarios', '/auditoria']);
  });
});

describe('visibleNavigation con alcances', () => {
  it('un docente (alcance ASSIGNED) ve Mis cursos, pero no los listados institucionales', () => {
    const assigned = new Set<string>([
      PERMISSIONS.TEACHING_READ,
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.ENROLLMENTS_READ,
    ]);
    const sections = visibleNavigation((p, scope) => assigned.has(p) && scope !== 'ALL');
    const items = sections.flatMap((s) => s.items.map((i) => i.to));
    expect(items).toContain('/mis-cursos');
    expect(items).not.toContain('/estudiantes');
    expect(items).not.toContain('/matriculas');
    expect(items).not.toContain('/asignacion-academica');
  });

  it('el perfil ordena el menú: como Docente o Acudiente no aparecen los módulos administrativos', () => {
    const everything = () => true;
    const asTeacher = visibleNavigation(everything, 'TEACHER').flatMap((s) =>
      s.items.map((i) => i.to),
    );
    expect(asTeacher).toEqual(['/', '/mis-cursos']);
    const asGuardian = visibleNavigation(everything, 'GUARDIAN').flatMap((s) =>
      s.items.map((i) => i.to),
    );
    expect(asGuardian).toEqual(['/']);
  });

  it('con alcance institucional se ven los módulos de la Fase 2', () => {
    const sections = visibleNavigation(() => true);
    const items = sections.flatMap((s) => s.items.map((i) => i.to));
    for (const path of [
      '/estudiantes',
      '/acudientes',
      '/personal',
      '/admisiones',
      '/matriculas',
      '/importar-estudiantes',
      '/asignacion-academica',
      '/proteccion-datos',
    ]) {
      expect(items).toContain(path);
    }
  });
});

describe('readableTextOn (contraste de la marca)', () => {
  it('usa texto blanco sobre colores oscuros y oscuro sobre colores claros', () => {
    expect(readableTextOn('#2453C4')).toBe('#ffffff');
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn('#FFE066')).toBe('#101828');
    expect(readableTextOn('#FFFFFF')).toBe('#101828');
  });
});

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

describe('readableTextOn (contraste de la marca)', () => {
  it('usa texto blanco sobre colores oscuros y oscuro sobre colores claros', () => {
    expect(readableTextOn('#2453C4')).toBe('#ffffff');
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn('#FFE066')).toBe('#101828');
    expect(readableTextOn('#FFFFFF')).toBe('#101828');
  });
});

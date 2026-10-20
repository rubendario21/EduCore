import { describe, expect, it } from 'vitest';
import { landingOf, profilesOf, resolveProfile } from './profiles';

const user = (...codes: string[]) => ({ roles: codes.map((code) => ({ code, name: code })) });

describe('perfiles de ingreso', () => {
  it('deriva los perfiles de los roles de la cuenta', () => {
    expect(profilesOf(user('TEACHER'))).toEqual(['TEACHER']);
    expect(profilesOf(user('GUARDIAN', 'TEACHER'))).toEqual(['TEACHER', 'GUARDIAN']);
    // Cualquier rol administrativo o personalizado cuenta como Administrativo.
    expect(profilesOf(user('SECRETARY', 'MI_ROL'))).toEqual(['STAFF']);
    expect(profilesOf(user())).toEqual([]);
  });

  it('usa el perfil elegido solo si la cuenta lo tiene', () => {
    expect(resolveProfile(['TEACHER', 'GUARDIAN'], 'GUARDIAN')).toBe('GUARDIAN');
    // Elegir un perfil que no se tiene no da acceso a él: se entra con uno propio.
    expect(resolveProfile(['GUARDIAN'], 'STAFF')).toBe('GUARDIAN');
    expect(resolveProfile(['STAFF'], null)).toBe('STAFF');
    expect(resolveProfile([], 'STAFF')).toBeNull();
  });

  it('cada perfil llega a su pantalla', () => {
    expect(landingOf('TEACHER')).toBe('/mis-cursos');
    expect(landingOf('STAFF')).toBe('/');
    expect(landingOf('GUARDIAN')).toBe('/');
  });
});

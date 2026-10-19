import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from './password-policy';

describe('checkPasswordPolicy', () => {
  it('acepta una frase de contraseña larga sin exigir símbolos', () => {
    expect(checkPasswordPolicy('caballo bateria grapa correcta')).toEqual([]);
  });

  it('rechaza contraseñas cortas', () => {
    expect(checkPasswordPolicy('Ab1!xyz')).toContain('Debe tener al menos 10 caracteres.');
  });

  it('cuenta caracteres Unicode, no bytes', () => {
    expect(checkPasswordPolicy('ñandúñandú')).toEqual([]);
  });

  it('rechaza contraseñas comunes sin distinguir mayúsculas', () => {
    expect(checkPasswordPolicy('Colegio2026')).toContain(
      'Es una contraseña demasiado común. Elige otra.',
    );
    expect(checkPasswordPolicy('zzzzzzzzzzzz')).toContain(
      'Es una contraseña demasiado común. Elige otra.',
    );
  });

  it('rechaza contraseñas que contienen el correo o se basan en el nombre', () => {
    expect(
      checkPasswordPolicy('mi-rgutierrez-secreto', { email: 'rgutierrez@colegio.edu.co' }),
    ).toContain('No debe contener tu correo electrónico.');
    expect(checkPasswordPolicy('gutierrez1234', { lastNames: 'Gutiérrez Gutierrez' })).toContain(
      'No debe basarse en tu nombre.',
    );
  });

  it('rechaza contraseñas excesivamente largas', () => {
    expect(checkPasswordPolicy('a b'.repeat(50))).toContain('No puede superar 128 caracteres.');
  });
});

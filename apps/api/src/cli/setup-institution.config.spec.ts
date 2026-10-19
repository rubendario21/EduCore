import { describe, expect, it } from 'vitest';
import example from '../../setup/institution.example.json';
import { setupConfigSchema } from './setup-institution.config';

describe('Archivo de configuración inicial', () => {
  it('el archivo de ejemplo es válido (incluido el DV del NIT)', () => {
    expect(setupConfigSchema.safeParse(example).success).toBe(true);
  });

  it('rechaza un DV que no corresponde al NIT e indica el correcto', () => {
    const result = setupConfigSchema.safeParse({
      ...example,
      institution: { ...example.institution, taxIdDv: '0' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['institution', 'taxIdDv'],
      message: 'El dígito de verificación no corresponde al NIT (debería ser 5)',
    });
  });
});

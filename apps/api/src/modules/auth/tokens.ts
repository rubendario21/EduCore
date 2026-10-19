import { createHash, randomBytes } from 'node:crypto';

/**
 * Token opaco de 256 bits en base64url (seguro para URLs y cookies). Se entrega
 * al cliente una sola vez; en la base solo se guarda su hash.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 en hexadecimal. Basta un hash rápido (no Argon2) porque el token
 * tiene 256 bits de entropía: no es adivinable por fuerza bruta.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

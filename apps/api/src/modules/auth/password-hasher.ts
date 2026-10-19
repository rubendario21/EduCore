import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Parámetros Argon2id recomendados por OWASP (2024+): 19 MiB, 2 iteraciones,
 * paralelismo 1. Se guardan dentro del propio hash, así que pueden subirse en
 * el futuro y `needsRehash` actualizará los hashes antiguos al iniciar sesión.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordHasher {
  /** Hash precalculado para igualar el tiempo de respuesta cuando el usuario no existe. */
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      // Evita revelar por tiempo de respuesta si la cuenta existe o está activada.
      this.dummyHash ??= this.hash('educore-dummy-password-for-timing');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}

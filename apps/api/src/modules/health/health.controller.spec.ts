import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { type PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HealthController } from './health.controller';

function controllerWith(ping: () => Promise<number>) {
  return new HealthController({ ping: vi.fn(ping) } as unknown as PrismaService);
}

describe('HealthController', () => {
  it('informa la base de datos disponible con su latencia', async () => {
    const result = await controllerWith(async () => 4).check();
    expect(result).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up', latencyMs: 4 } },
    });
  });

  it('responde 503 sin filtrar el error interno cuando la base no responde', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const controller = controllerWith(async () => {
      throw new Error('password authentication failed for user "educore_app"');
    });
    const error = await controller.check().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    const appError = error as AppException;
    expect(appError.getStatus()).toBe(503);
    expect(appError.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(appError.details)).not.toContain('educore_app');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

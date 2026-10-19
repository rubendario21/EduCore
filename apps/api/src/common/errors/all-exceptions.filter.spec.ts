import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException, ValidationException } from './app.exception';

function createHost(requestId = 'req-123') {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: requestId, path: '/api/v1/prueba' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('respeta el código y los detalles de una AppException', () => {
    const { host, status, json } = createHost();
    filter.catch(
      new AppException(
        HttpStatus.CONFLICT,
        'ENROLLMENT_ALREADY_ACTIVE',
        'Ya existe una matrícula activa.',
        {
          enrollmentId: 'abc',
        },
      ),
      host,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'ENROLLMENT_ALREADY_ACTIVE',
        message: 'Ya existe una matrícula activa.',
        details: { enrollmentId: 'abc' },
        requestId: 'req-123',
      },
    });
  });

  it('formatea los errores de validación por campo', () => {
    const { host, status, json } = createHost();
    filter.catch(new ValidationException([{ field: 'email', messages: ['email inválido'] }]), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [{ field: 'email', messages: ['email inválido'] }],
      },
    });
  });

  it('traduce las HttpException de Nest sin filtrar su mensaje interno', () => {
    const { host, status, json } = createHost();
    filter.catch(new NotFoundException('Cannot GET /api/v1/secreto'), host);
    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0]?.[0];
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).not.toContain('/api/v1/secreto');
  });

  it('mapea los errores HTTP de middleware de Express (p. ej. 413 de body-parser)', () => {
    const { host, status, json } = createHost();
    filter.catch(
      Object.assign(new Error('request entity too large'), {
        status: 413,
        type: 'entity.too.large',
        expose: true,
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(413);
    expect(json.mock.calls[0]?.[0].error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'El contenido enviado supera el tamaño permitido.',
    });
  });

  it('oculta los detalles de errores inesperados y los registra', () => {
    const { host, status, json } = createHost();
    filter.catch(new Error('fallo de conexión a 10.0.0.5 con usuario admin'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(Logger.prototype.error).toHaveBeenCalledOnce();
  });

  it('no registra como inesperadas las AppException 5xx previstas', () => {
    const { host, status } = createHost();
    filter.catch(new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE'), host);
    expect(status).toHaveBeenCalledWith(503);
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('no registra como error los 4xx', () => {
    const { host } = createHost();
    filter.catch(new BadRequestException(), host);
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });
});

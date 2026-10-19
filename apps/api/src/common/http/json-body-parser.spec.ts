import { type Request, type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../errors/app.exception';
import { jsonParseErrorHandler } from './json-body-parser';

const req = {} as Request;
const res = {} as Response;

describe('jsonParseErrorHandler', () => {
  it('convierte el JSON malformado en una AppException INVALID_JSON', () => {
    const next = vi.fn();
    const parseError = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
      status: 400,
      type: 'entity.parse.failed',
    });

    jsonParseErrorHandler(parseError, req, res, next);

    const forwarded = next.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(AppException);
    expect(forwarded).toMatchObject({ code: 'INVALID_JSON' });
    expect((forwarded as AppException).getStatus()).toBe(400);
  });

  it('deja pasar sin cambios los demás errores (p. ej. 413)', () => {
    const next = vi.fn();
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });

    jsonParseErrorHandler(tooLarge, req, res, next);

    expect(next).toHaveBeenCalledWith(tooLarge);
  });
});

import { HttpStatus } from '@nestjs/common';
import { type ErrorRequestHandler, json, type RequestHandler } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/** Tamaño máximo de un cuerpo JSON. Los archivos se suben por multipart, no por JSON. */
export const JSON_BODY_LIMIT = '100kb';

/**
 * Convierte el error de JSON malformado de body-parser en una AppException.
 * Sin esto, Nest transforma el SyntaxError en un BadRequestException genérico
 * y se pierde la causa (ver @nestjs/core RoutesResolver.mapExternalException).
 */
export const jsonParseErrorHandler: ErrorRequestHandler = (err, _req, _res, next) => {
  if ((err as { type?: string } | undefined)?.type === 'entity.parse.failed') {
    next(
      new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_JSON,
        'El cuerpo de la solicitud no es un JSON válido.',
      ),
    );
    return;
  }
  next(err);
};

/**
 * Parser de cuerpos de la API: solo JSON (sin urlencoded). Reemplaza al que
 * Nest registra por defecto, que debe desactivarse con `bodyParser: false`.
 */
export function jsonBodyParser(): [RequestHandler, ErrorRequestHandler] {
  return [json({ limit: JSON_BODY_LIMIT }), jsonParseErrorHandler];
}

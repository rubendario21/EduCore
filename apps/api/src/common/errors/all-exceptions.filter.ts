import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { AppException, type ErrorBody } from './app.exception';
import { defaultMessages, ErrorCode, errorCodeForStatus } from './error-codes';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Errores lanzados por middleware de Express (p. ej. body-parser con un cuerpo
 * demasiado grande) antes de llegar a Nest: traen `status`, pero no son
 * HttpException. El JSON malformado se trata aparte en `json-body-parser.ts`.
 */
interface ExpressHttpError {
  status: number;
  expose?: boolean;
}

function isExpressHttpError(value: unknown): value is ExpressHttpError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ExpressHttpError).status === 'number' &&
    (value as ExpressHttpError).status >= 400 &&
    (value as ExpressHttpError).status < 500 &&
    (value as ExpressHttpError).expose === true
  );
}

/**
 * Filtro global: toda respuesta de error tiene la forma
 * `{ error: { code, message, details?, requestId } }`.
 * Los errores no controlados se registran completos en el log, pero al cliente
 * solo se le devuelve un mensaje genérico.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const normalized = this.normalize(exception);

    // Las AppException 5xx son fallos previstos (p. ej. dependencia caída) que
    // registra quien las lanza; aquí solo se registran los errores inesperados.
    if (normalized.status >= 500 && !(exception instanceof AppException)) {
      this.logger.error(
        { err: exception, requestId: request.id, path: request.path },
        'Error no controlado',
      );
    }

    const body: ErrorBody = {
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details !== undefined && { details: normalized.details }),
        ...(request.id && { requestId: String(request.id) }),
      },
    };

    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = errorCodeForStatus(status);
      // Los mensajes por defecto de Nest están en inglés y a veces revelan
      // detalles internos (p. ej. "Cannot GET /ruta"); se usa el texto propio.
      return { status, code, message: defaultMessages[code] };
    }

    // Red de seguridad: los servicios validan duplicados y referencias antes de
    // escribir, pero dos peticiones simultáneas pueden pasar la validación a la
    // vez; la restricción de la base decide y aquí se traduce a 409.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: 'Ya existe un registro con esos datos.',
        };
      }
      if (exception.code === 'P2003') {
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: 'El registro está relacionado con otros datos y no puede modificarse así.',
        };
      }
    }

    if (isExpressHttpError(exception)) {
      const code = errorCodeForStatus(exception.status);
      return { status: exception.status, code, message: defaultMessages[code] };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: defaultMessages.INTERNAL_ERROR,
    };
  }
}

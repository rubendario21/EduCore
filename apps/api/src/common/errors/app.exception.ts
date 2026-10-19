import { HttpException, HttpStatus } from '@nestjs/common';
import { defaultMessages, ErrorCode } from './error-codes';

export interface FieldError {
  field: string;
  messages: string[];
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Excepción de dominio con código estable. Los servicios la usan para errores
 * de negocio esperados (p. ej. `new AppException(409, 'ENROLLMENT_ALREADY_ACTIVE', '...')`).
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? defaultMessages[code as ErrorCode] ?? 'Error', status);
  }
}

export class ValidationException extends AppException {
  constructor(readonly fieldErrors: FieldError[]) {
    super(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, undefined, fieldErrors);
  }
}

import { HttpStatus } from '@nestjs/common';

/**
 * Códigos de error estables de la API. El frontend decide su comportamiento
 * con estos códigos, nunca con el texto del mensaje.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Código por defecto para cada estado HTTP cuando la excepción no trae uno propio. */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.BAD_REQUEST;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.METHOD_NOT_ALLOWED:
      return ErrorCode.METHOD_NOT_ALLOWED;
    case HttpStatus.CONFLICT:
      return ErrorCode.CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
  }
}

/** Mensajes en español para los casos genéricos. */
export const defaultMessages: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Los datos enviados no son válidos.',
  BAD_REQUEST: 'La solicitud no es válida.',
  INVALID_JSON: 'El cuerpo de la solicitud no es un JSON válido.',
  UNAUTHENTICATED: 'Debes iniciar sesión para continuar.',
  FORBIDDEN: 'No tienes permiso para realizar esta operación.',
  NOT_FOUND: 'El recurso solicitado no existe.',
  METHOD_NOT_ALLOWED: 'Método no permitido.',
  CONFLICT: 'La operación entra en conflicto con el estado actual del recurso.',
  PAYLOAD_TOO_LARGE: 'El contenido enviado supera el tamaño permitido.',
  UNSUPPORTED_MEDIA_TYPE: 'Tipo de contenido no soportado.',
  RATE_LIMITED: 'Demasiadas solicitudes. Intenta de nuevo en unos momentos.',
  INTERNAL_ERROR: 'Ocurrió un error inesperado. Si persiste, contacta al administrador.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible temporalmente.',
};

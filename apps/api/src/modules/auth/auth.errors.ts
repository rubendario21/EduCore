import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';

/** Errores de autenticación con códigos estables para la web. */
export const AuthErrors = {
  /** Mismo error para correo inexistente y contraseña incorrecta (no revela cuentas). */
  invalidCredentials: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'INVALID_CREDENTIALS',
      'El correo o la contraseña no son correctos.',
    ),

  accountLocked: (retryAfterSeconds: number) =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'ACCOUNT_LOCKED',
      `Tu cuenta está bloqueada temporalmente por varios intentos fallidos. Intenta de nuevo en ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minutos.`,
      { retryAfterSeconds },
    ),

  /** Solo se informa después de verificar la contraseña correcta. */
  accountSuspended: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'ACCOUNT_SUSPENDED',
      'Tu cuenta está suspendida. Comunícate con la institución.',
    ),

  unauthenticated: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
      'Debes iniciar sesión para continuar.',
    ),

  accessTokenExpired: () =>
    new AppException(HttpStatus.UNAUTHORIZED, 'ACCESS_TOKEN_EXPIRED', 'Tu sesión debe renovarse.'),

  sessionInvalid: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'SESSION_INVALID',
      'Tu sesión terminó. Inicia sesión de nuevo.',
    ),

  /** Otra pestaña renovó la sesión hace instantes: el cliente debe reintentar una vez. */
  sessionRotated: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      'SESSION_ROTATED',
      'La sesión se renovó en otra pestaña. Reintenta.',
    ),

  csrfCheckFailed: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'CSRF_CHECK_FAILED',
      'La solicitud no proviene de la aplicación de EduCore.',
    ),

  invalidOrExpiredToken: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'INVALID_OR_EXPIRED_TOKEN',
      'El enlace no es válido o ya venció. Solicita uno nuevo.',
    ),

  currentPasswordInvalid: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'CURRENT_PASSWORD_INVALID',
      'La contraseña actual no es correcta.',
    ),
};

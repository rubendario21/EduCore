import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';

export const AcademicErrors = {
  notFound: (what: string) =>
    new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} no existe.`),

  codeTaken: (what: string) =>
    new AppException(HttpStatus.CONFLICT, 'CODE_TAKEN', `Ya existe ${what} con ese código.`),

  inactiveReference: (what: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'INACTIVE_REFERENCE',
      `${what} está inactivo(a) y no puede usarse.`,
    ),

  inUse: (what: string, detail: string, count: number) =>
    new AppException(
      HttpStatus.CONFLICT,
      'IN_USE',
      `No se puede desactivar ${what}: tiene ${count} ${detail} activo(s).`,
      { count },
    ),

  yearTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_TAKEN',
      'Ya existe un año lectivo para ese año.',
    ),

  yearClosed: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_CLOSED',
      'El año lectivo está cerrado y no admite cambios.',
    ),

  yearActiveLocked: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_ACTIVE_LOCKED',
      'Con el año lectivo activo no se pueden agregar ni quitar períodos, ni cambiar sus pesos o fechas. Solo se pueden renombrar.',
    ),

  anotherYearActive: (year: number) =>
    new AppException(
      HttpStatus.CONFLICT,
      'ANOTHER_YEAR_ACTIVE',
      `El año ${year} está activo. Ciérralo antes de activar otro.`,
      { activeYear: year },
    ),

  notReadyToActivate: (problems: string[]) =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_NOT_READY',
      'El año lectivo aún no puede activarse.',
      { problems },
    ),

  invalidTransition: (from: string, to: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'INVALID_STATUS_TRANSITION',
      `No se puede pasar de ${from} a ${to}.`,
      { from, to },
    ),

  concurrentChange: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'CONCURRENT_CHANGE',
      'Otro usuario modificó este registro al mismo tiempo. Recarga e intenta de nuevo.',
    ),
};

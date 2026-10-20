import { HttpStatus } from '@nestjs/common';
import { AppException, ValidationException } from '../../common/errors/app.exception';

export const TeachingErrors = {
  notFound: (what: string) =>
    new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} no existe.`),

  yearClosed: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ACADEMIC_YEAR_CLOSED',
      'El año lectivo está cerrado y no admite cambios.',
    ),

  inactive: (what: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'INACTIVE_REFERENCE',
      `${what} está inactivo(a) y no puede usarse.`,
    ),

  curriculumExists: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'CURRICULUM_SUBJECT_EXISTS',
      'La asignatura ya está en el plan de estudios de ese grado y año.',
    ),

  curriculumInUse: (count: number) =>
    new AppException(
      HttpStatus.CONFLICT,
      'CURRICULUM_SUBJECT_IN_USE',
      `La asignatura tiene ${count} asignación(es) docente(s) en ese grado: no se puede quitar del plan.`,
      { count },
    ),

  notInCurriculum: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'SUBJECT_NOT_IN_CURRICULUM',
      'La asignatura no está en el plan de estudios del grado del grupo para ese año.',
    ),

  notATeacher: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'STAFF_NOT_TEACHER',
      'Solo se pueden asignar miembros del personal de tipo docente.',
    ),

  alreadyAssigned: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'SUBJECT_ALREADY_ASSIGNED',
      'La asignatura ya tiene un docente vigente en este grupo. Usa el reemplazo.',
    ),

  assignmentEnded: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'ASSIGNMENT_ENDED',
      'La asignación ya finalizó y no admite cambios.',
    ),

  sameTeacher: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'SAME_TEACHER',
      'El docente ya tiene asignada esta asignatura en el grupo.',
    ),

  invalid: (field: string, message: string) =>
    new ValidationException([{ field, messages: [message] }]),
};

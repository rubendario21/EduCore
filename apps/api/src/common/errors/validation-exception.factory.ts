import { type ValidationError } from 'class-validator';
import { type FieldError, ValidationException } from './app.exception';

/** Aplana los errores de class-validator (incluidos los anidados) a `campo.subcampo`. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own: FieldError[] = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function validationExceptionFactory(errors: ValidationError[]): ValidationException {
  return new ValidationException(flattenValidationErrors(errors));
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { toDateOnly } from '../../common/validation/colombia';
import { type Prisma } from '../../generated/prisma/client';
import { type PersonInputDto, type UpdatePersonDto } from './dto/people.dto';
import { PeopleRepository } from './people.repository';

type Tx = Prisma.TransactionClient;

export const PeopleErrors = {
  dataMismatch: (existingName: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'PERSON_DATA_MISMATCH',
      `Ya existe una persona con ese documento en la institución, pero con otro nombre (${existingName}). Verifica el documento o el nombre.`,
      { existingName },
    ),
  documentTaken: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'PERSON_DOCUMENT_TAKEN',
      'Ya existe otra persona con ese tipo y número de documento en la institución.',
    ),
};

/** Compara nombres sin distinguir mayúsculas, tildes ni espacios repetidos. */
export function sameName(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return normalize(a) === normalize(b);
}

function personData(input: Partial<PersonInputDto>) {
  return {
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    firstNames: input.firstNames,
    lastNames: input.lastNames,
    birthDate:
      input.birthDate === undefined
        ? undefined
        : input.birthDate
          ? toDateOnly(input.birthDate)
          : null,
    email: input.email === undefined ? undefined : (input.email?.toLowerCase() ?? null),
    phone: input.phone,
    address: input.address,
  };
}

/**
 * Una persona, varios papeles: si el documento ya existe en la institución se
 * REUTILIZA esa persona (p. ej. una docente que también es acudiente), siempre
 * que el nombre coincida; si no coincide, se rechaza para no mezclar dos
 * personas distintas por un error de digitación. Los datos de una persona
 * existente no se sobrescriben al reutilizarla.
 */
@Injectable()
export class PersonResolver {
  constructor(private readonly repository: PeopleRepository) {}

  async findOrCreate(institutionId: string, input: PersonInputDto, tx: Tx) {
    const existing = await this.repository.findPersonByDocument(
      institutionId,
      input.documentType,
      input.documentNumber,
      tx,
    );
    if (existing) {
      if (
        !sameName(existing.firstNames, input.firstNames) ||
        !sameName(existing.lastNames, input.lastNames)
      ) {
        throw PeopleErrors.dataMismatch(`${existing.firstNames} ${existing.lastNames}`);
      }
      return { person: existing, reused: true };
    }
    const person = await this.repository.createPerson(
      {
        institutionId,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        firstNames: input.firstNames,
        lastNames: input.lastNames,
        birthDate: input.birthDate ? toDateOnly(input.birthDate) : null,
        email: input.email?.toLowerCase() ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
      },
      tx,
    );
    return { person: { ...person, student: null, guardian: null, staff: null }, reused: false };
  }

  /** Actualiza la persona; el documento sigue siendo único en la institución. */
  async update(
    institutionId: string,
    personId: string,
    current: { documentType: string; documentNumber: string },
    input: UpdatePersonDto,
    tx: Tx,
  ) {
    const documentType = input.documentType ?? current.documentType;
    const documentNumber = input.documentNumber ?? current.documentNumber;
    if (documentType !== current.documentType || documentNumber !== current.documentNumber) {
      const other = await this.repository.findPersonByDocument(
        institutionId,
        documentType as PersonInputDto['documentType'],
        documentNumber,
        tx,
      );
      if (other && other.id !== personId) throw PeopleErrors.documentTaken();
    }
    return this.repository.updatePerson(personId, personData(input), tx);
  }
}

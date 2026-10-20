import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { EmptyToNull, IsCalendarDate, Trim } from '../../common/validation/decorators';
import {
  GUARDIAN_RELATIONSHIPS,
  type GuardianRelationship,
  PersonInputDto,
} from '../people/dto/people.dto';

export const ADMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'WAITLISTED',
  'APPROVED',
  'REJECTED',
  'ENROLLED',
  'WITHDRAWN',
] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const ADMISSION_DOCUMENT_TYPES = [
  'BIRTH_CERTIFICATE',
  'IDENTITY_DOCUMENT',
  'REPORT_CARD',
  'PHOTO',
  'GUARDIAN_IDENTITY',
  'OTHER',
] as const;
export type AdmissionDocumentType = (typeof ADMISSION_DOCUMENT_TYPES)[number];

const uuidMessage = (field: string) => ({ message: `${field} debe ser un identificador válido.` });

/** Datos del aspirante (se convierten en estudiante al matricular). */
export class ApplicantDto extends PickType(PersonInputDto, [
  'documentType',
  'documentNumber',
  'firstNames',
  'lastNames',
  'birthDate',
] as const) {}

/** Acudiente que presenta la solicitud (se vincula al matricular). */
export class AdmissionGuardianDto extends PickType(PersonInputDto, [
  'documentType',
  'documentNumber',
  'firstNames',
  'lastNames',
  'email',
  'phone',
] as const) {
  @ApiProperty({ enum: GUARDIAN_RELATIONSHIPS })
  @IsIn(GUARDIAN_RELATIONSHIPS, { message: 'Parentesco no válido.' })
  relationship: GuardianRelationship;
}

export class ListAdmissionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('academicYearId'))
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('gradeId'))
  gradeId?: string;

  @ApiPropertyOptional({ enum: ADMISSION_STATUSES })
  @IsOptional()
  @IsIn(ADMISSION_STATUSES, { message: 'Estado no válido.' })
  status?: AdmissionStatus;

  @ApiPropertyOptional({ description: 'Nombre o documento del aspirante' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateAdmissionDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('academicYearId'))
  academicYearId: string;

  @ApiProperty({ description: 'Grado al que aspira' })
  @IsUUID('all', uuidMessage('gradeId'))
  gradeId: string;

  @ApiProperty({ type: ApplicantDto })
  @ValidateNested()
  @Type(() => ApplicantDto)
  applicant: ApplicantDto;

  @ApiPropertyOptional({ type: AdmissionGuardianDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdmissionGuardianDto)
  guardian?: AdmissionGuardianDto;

  @ApiPropertyOptional({ nullable: true, description: 'Institución de procedencia' })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(200)
  previousSchool?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateAdmissionDto extends PartialType(
  PickType(CreateAdmissionDto, ['gradeId', 'previousSchool', 'notes'] as const),
) {
  @ApiPropertyOptional({ type: ApplicantDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApplicantDto)
  applicant?: ApplicantDto;

  @ApiPropertyOptional({ type: AdmissionGuardianDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdmissionGuardianDto)
  guardian?: AdmissionGuardianDto | null;
}

/** Nota opcional de una transición (enviar, revisar, dejar en espera, desistir). */
export class TransitionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

/** El rechazo exige un motivo. */
export class RejectDto {
  @ApiProperty({ description: 'Motivo del rechazo' })
  @Trim()
  @IsString()
  @MinLength(5, { message: 'Indica el motivo del rechazo (al menos 5 caracteres).' })
  @MaxLength(1000)
  note: string;
}

export class EnrollAdmittedDto {
  @ApiPropertyOptional({ description: 'Grupo donde se ubica (del mismo año y grado)' })
  @IsOptional()
  @IsUUID('all', uuidMessage('schoolGroupId'))
  schoolGroupId?: string;

  @ApiPropertyOptional({ description: 'Fecha de matrícula (por defecto, hoy)' })
  @IsOptional()
  @IsCalendarDate()
  enrolledOn?: string;
}

export class UploadAdmissionDocumentDto {
  @ApiProperty({ enum: ADMISSION_DOCUMENT_TYPES })
  @IsIn(ADMISSION_DOCUMENT_TYPES, { message: 'Tipo de documento no válido.' })
  documentType: AdmissionDocumentType;
}

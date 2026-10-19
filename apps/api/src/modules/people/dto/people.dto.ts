import { DOCUMENT_TYPES, type DocumentType } from '@educore/shared';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { EmptyToNull, IsCalendarDate, Trim } from '../../../common/validation/decorators';

export const STUDENT_STATUSES = ['ACTIVE', 'WITHDRAWN', 'GRADUATED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const GUARDIAN_RELATIONSHIPS = [
  'MOTHER',
  'FATHER',
  'GRANDPARENT',
  'SIBLING',
  'UNCLE_AUNT',
  'LEGAL_GUARDIAN',
  'OTHER',
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];
export const STAFF_TYPES = ['TEACHER', 'DIRECTIVE', 'ADMINISTRATIVE', 'SUPPORT'] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

/** Datos de la persona (comunes a estudiantes, acudientes y personal). */
export class PersonInputDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES, { message: 'Tipo de documento no válido.' })
  documentType: DocumentType;

  @ApiProperty({ example: '1012345678' })
  @Trim()
  @Matches(/^[A-Za-z0-9-]{3,30}$/, {
    message: 'El documento debe tener entre 3 y 30 letras, números o guiones.',
  })
  documentNumber: string;

  @ApiProperty({ example: 'Sofía' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Los nombres deben tener al menos 2 caracteres.' })
  @MaxLength(120)
  firstNames: string;

  @ApiProperty({ example: 'Martínez López' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Los apellidos deben tener al menos 2 caracteres.' })
  @MaxLength(120)
  lastNames: string;

  @ApiPropertyOptional({ nullable: true, example: '2014-03-09' })
  @IsOptional()
  @EmptyToNull()
  @IsCalendarDate({ message: 'La fecha de nacimiento no es válida (AAAA-MM-DD).' })
  birthDate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Correo de contacto (no es el de acceso)' })
  @IsOptional()
  @EmptyToNull()
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' })
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^[0-9+()\s-]{7,40}$/, { message: 'El teléfono no es válido.' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(300)
  address?: string | null;
}

export class UpdatePersonDto extends PartialType(PersonInputDto) {}

// --- Estudiantes ------------------------------------------------------------

export class ListStudentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca en nombres, apellidos, documento y código' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: STUDENT_STATUSES })
  @IsOptional()
  @IsIn(STUDENT_STATUSES, { message: 'Estado no válido.' })
  status?: StudentStatus;
}

export class CreateStudentDto {
  @ApiProperty({ type: PersonInputDto })
  @ValidateNested()
  @Type(() => PersonInputDto)
  person: PersonInputDto;

  @ApiPropertyOptional({ nullable: true, description: 'Código institucional opcional' })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^[A-Za-z0-9_-]{1,30}$/, {
    message: 'Hasta 30 letras, números, guiones o guiones bajos.',
  })
  code?: string | null;
}

export class UpdateStudentDto {
  @ApiPropertyOptional({ type: UpdatePersonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePersonDto)
  person?: UpdatePersonDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^[A-Za-z0-9_-]{1,30}$/, {
    message: 'Hasta 30 letras, números, guiones o guiones bajos.',
  })
  code?: string | null;

  @ApiPropertyOptional({ enum: STUDENT_STATUSES })
  @IsOptional()
  @IsIn(STUDENT_STATUSES, { message: 'Estado no válido.' })
  status?: StudentStatus;
}

class GuardianLinkFlagsDto {
  @ApiProperty({ enum: GUARDIAN_RELATIONSHIPS })
  @IsIn(GUARDIAN_RELATIONSHIPS, { message: 'Parentesco no válido.' })
  relationship: GuardianRelationship;

  @ApiPropertyOptional({ description: 'Acudiente principal (uno por estudiante)' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ description: 'Representante legal (autoriza el tratamiento de datos)' })
  @IsOptional()
  @IsBoolean()
  isLegalRepresentative?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  livesWithStudent?: boolean;
}

/** Vincula un acudiente existente (guardianId) o registra uno nuevo (person). */
export class LinkGuardianDto extends GuardianLinkFlagsDto {
  @ApiPropertyOptional({ description: 'Acudiente ya registrado' })
  @IsOptional()
  @IsUUID('all', { message: 'guardianId debe ser un identificador válido.' })
  guardianId?: string;

  @ApiPropertyOptional({
    type: PersonInputDto,
    description: 'Datos para registrar un acudiente nuevo',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonInputDto)
  person?: PersonInputDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  occupation?: string | null;
}

export class UpdateGuardianLinkDto extends PartialType(GuardianLinkFlagsDto) {}

// --- Acudientes -------------------------------------------------------------

export class ListGuardiansQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateGuardianDto {
  @ApiProperty({ type: PersonInputDto })
  @ValidateNested()
  @Type(() => PersonInputDto)
  person: PersonInputDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  occupation?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(150)
  workplace?: string | null;
}

export class UpdateGuardianDto {
  @ApiPropertyOptional({ type: UpdatePersonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePersonDto)
  person?: UpdatePersonDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  occupation?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(150)
  workplace?: string | null;
}

// --- Personal ---------------------------------------------------------------

export class ListStaffQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: STAFF_TYPES })
  @IsOptional()
  @IsIn(STAFF_TYPES, { message: 'Tipo de personal no válido.' })
  staffType?: StaffType;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'], { message: 'Estado no válido.' })
  status?: 'ACTIVE' | 'INACTIVE';
}

export class CreateStaffDto {
  @ApiProperty({ type: PersonInputDto })
  @ValidateNested()
  @Type(() => PersonInputDto)
  person: PersonInputDto;

  @ApiProperty({ enum: STAFF_TYPES })
  @IsIn(STAFF_TYPES, { message: 'Tipo de personal no válido.' })
  staffType: StaffType;

  @ApiPropertyOptional({ nullable: true, example: 'Docente de matemáticas' })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2024-01-15' })
  @IsOptional()
  @EmptyToNull()
  @IsCalendarDate({ message: 'La fecha de ingreso no es válida (AAAA-MM-DD).' })
  hireDate?: string | null;
}

export class UpdateStaffDto {
  @ApiPropertyOptional({ type: UpdatePersonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePersonDto)
  person?: UpdatePersonDto;

  @ApiPropertyOptional({ enum: STAFF_TYPES })
  @IsOptional()
  @IsIn(STAFF_TYPES, { message: 'Tipo de personal no válido.' })
  staffType?: StaffType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsCalendarDate({ message: 'La fecha de ingreso no es válida (AAAA-MM-DD).' })
  hireDate?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'], { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: 'ACTIVE' | 'INACTIVE';
}

// --- Acceso al portal -------------------------------------------------------

export class GrantAccessDto {
  @ApiProperty({ description: 'Correo de acceso a EduCore' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' })
  @MaxLength(254)
  email: string;
}

export class GrantStaffAccessDto extends GrantAccessDto {
  @ApiProperty({ example: ['TEACHER'], isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Asigna al menos un rol.' })
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { each: true, message: 'Código de rol no válido.' })
  roleCodes: string[];
}

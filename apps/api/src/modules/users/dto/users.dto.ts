import {
  DOCUMENT_TYPES,
  type DocumentType,
  MEMBERSHIP_STATUSES,
  type MembershipStatus,
} from '@educore/shared';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
/** Cadena vacía → null, para poder borrar campos opcionales desde un formulario. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

const ROLE_CODE = /^[A-Z][A-Z0-9_]{1,49}$/;

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca en nombres, apellidos, documento y correo' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: MEMBERSHIP_STATUSES })
  @IsOptional()
  @IsIn(MEMBERSHIP_STATUSES, { message: 'Estado no válido.' })
  status?: MembershipStatus;

  @ApiPropertyOptional({ example: 'TEACHER' })
  @IsOptional()
  @Matches(ROLE_CODE, { message: 'Código de rol no válido.' })
  roleCode?: string;
}

class PersonFieldsDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES, { message: 'Tipo de documento no válido.' })
  documentType: DocumentType;

  @ApiProperty({ example: '1012345678' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-]{3,30}$/, {
    message: 'El documento debe tener entre 3 y 30 letras, números o guiones.',
  })
  documentNumber: string;

  @ApiProperty({ example: 'Ana María' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Los nombres deben tener al menos 2 caracteres.' })
  @MaxLength(120)
  firstNames: string;

  @ApiProperty({ example: 'Rodríguez Pérez' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Los apellidos deben tener al menos 2 caracteres.' })
  @MaxLength(120)
  lastNames: string;

  @ApiPropertyOptional({ example: '1990-05-17', nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString({ strict: true }, { message: 'La fecha de nacimiento no es válida (AAAA-MM-DD).' })
  birthDate?: string | null;

  @ApiPropertyOptional({ example: '+57 300 000 0000', nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^[0-9+()\s-]{7,40}$/, { message: 'El teléfono no es válido.' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;
}

export class CreateUserDto extends PersonFieldsDto {
  @ApiProperty({ example: 'docente@colegio.edu.co' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: ['TEACHER'], isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Asigna al menos un rol.' })
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(ROLE_CODE, { each: true, message: 'Código de rol no válido.' })
  roleCodes: string[];
}

export class UpdateUserDto extends PartialType(PersonFieldsDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' })
  @MaxLength(254)
  email?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'], { message: 'El estado debe ser ACTIVE o SUSPENDED.' })
  status: 'ACTIVE' | 'SUSPENDED';
}

export class SetUserRolesDto {
  @ApiProperty({ example: ['TEACHER'], isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'El usuario debe conservar al menos un rol.' })
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(ROLE_CODE, { each: true, message: 'Código de rol no válido.' })
  roleCodes: string[];
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^[0-9+()\s-]{7,40}$/, { message: 'El teléfono no es válido.' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  address?: string | null;
}

// --- Respuestas -------------------------------------------------------------

export class UserRoleDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

export class UserDto {
  @ApiProperty({ description: 'Id de la cuenta (usuario)' }) id: string;
  @ApiProperty() membershipId: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: MEMBERSHIP_STATUSES }) status: MembershipStatus;
  @ApiProperty() firstNames: string;
  @ApiProperty() lastNames: string;
  @ApiProperty({ enum: DOCUMENT_TYPES }) documentType: DocumentType;
  @ApiProperty() documentNumber: string;
  @ApiProperty({ nullable: true, example: '1990-05-17' }) birthDate: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
  @ApiProperty({ nullable: true }) address: string | null;
  @ApiProperty({ type: [UserRoleDto] }) roles: UserRoleDto[];
  @ApiProperty({ nullable: true }) lastLoginAt: string | null;
  @ApiProperty() createdAt: string;
}

export class PageMetaDto {
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class UserPageDto {
  @ApiProperty({ type: [UserDto] }) data: UserDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}

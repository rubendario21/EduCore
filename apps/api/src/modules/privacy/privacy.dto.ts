import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  EmptyToNull,
  IsCalendarDate,
  Trim,
  UpperCode,
} from '../../common/validation/decorators';

export const CONSENT_METHODS = [
  'WRITTEN',
  'ELECTRONIC',
  'EMAIL',
  'RECORDED_CALL',
  'OTHER',
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

const uuidMessage = (field: string) => ({ message: `${field} debe ser un identificador válido.` });

// --- Políticas ---------------------------------------------------------------

export class PurposeInputDto {
  @ApiProperty({ example: 'IMAGEN' })
  @UpperCode()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ example: 'Uso de imagen en publicaciones institucionales' })
  @Trim()
  @IsString()
  @MinLength(3, { message: 'El nombre de la finalidad debe tener al menos 3 caracteres.' })
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({
    default: false,
    description: 'Necesaria para prestar el servicio educativo (informativo)',
  })
  @IsOptional()
  @IsBoolean({ message: 'required debe ser verdadero o falso.' })
  required?: boolean;
}

export class CreatePolicyDto {
  @ApiProperty({ example: '2027-1' })
  @Trim()
  @Matches(/^[A-Za-z0-9._-]{1,20}$/, {
    message: 'La versión debe tener hasta 20 letras, números, puntos o guiones.',
  })
  version: string;

  @ApiProperty({ example: 'Política de tratamiento de datos personales' })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: 'Texto completo de la política' })
  @Trim()
  @IsString()
  @MinLength(50, { message: 'El texto de la política debe tener al menos 50 caracteres.' })
  @MaxLength(100_000)
  content: string;

  @ApiProperty({ example: '2027-01-15' })
  @IsCalendarDate()
  effectiveFrom: string;

  @ApiProperty({ type: [PurposeInputDto] })
  @ValidateNested({ each: true })
  @Type(() => PurposeInputDto)
  @ArrayMinSize(1, { message: 'La política debe tener al menos una finalidad.' })
  @ArrayMaxSize(30)
  purposes: PurposeInputDto[];
}

export class UpdatePolicyDto extends PartialType(CreatePolicyDto) {}

// --- Autorizaciones ----------------------------------------------------------

export class DecisionInputDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('purposeId'))
  purposeId: string;

  @ApiProperty()
  @IsBoolean({ message: 'granted debe ser verdadero o falso.' })
  granted: boolean;
}

export class CreateConsentDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('studentId'))
  studentId: string;

  @ApiProperty({ description: 'Versión publicada de la política' })
  @IsUUID('all', uuidMessage('policyId'))
  policyId: string;

  @ApiProperty({
    description:
      'Persona que autoriza: un acudiente representante legal del estudiante, o el propio estudiante si es mayor de edad',
  })
  @IsUUID('all', uuidMessage('authorizerPersonId'))
  authorizerPersonId: string;

  @ApiProperty({ enum: CONSENT_METHODS })
  @IsIn(CONSENT_METHODS, { message: 'Medio de autorización no válido.' })
  method: ConsentMethod;

  @ApiProperty({ example: '2027-01-20', description: 'Fecha en que se otorgó' })
  @IsCalendarDate()
  consentedOn: string;

  @ApiProperty({ type: [DecisionInputDto], description: 'Una decisión por cada finalidad' })
  @ValidateNested({ each: true })
  @Type(() => DecisionInputDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  decisions: DecisionInputDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class RevokeConsentDto {
  @ApiPropertyOptional({ description: 'Fecha de la revocación (por defecto, hoy)' })
  @IsOptional()
  @IsCalendarDate()
  date?: string;

  @ApiProperty({ description: 'Motivo o solicitud del titular' })
  @Trim()
  @IsString()
  @MinLength(5, { message: 'Indica el motivo de la revocación (al menos 5 caracteres).' })
  @MaxLength(1000)
  reason: string;
}

export class ListConsentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('studentId'))
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('policyId'))
  policyId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'REVOKED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'REVOKED'], { message: 'Estado no válido.' })
  status?: 'ACTIVE' | 'REVOKED';
}

export class CoverageQueryDto extends OmitType(ListConsentsQueryDto, [
  'studentId',
  'status',
] as const) {}

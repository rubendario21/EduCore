import { RECORD_STATUSES, type RecordStatus } from '@educore/shared';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  EmptyToNull,
  Trim,
  UpperCode,
} from '../../../common/validation/decorators';

// --- Institución ------------------------------------------------------------

export class UpdateInstitutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(3, { message: 'El nombre legal debe tener al menos 3 caracteres.' })
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(200)
  tradeName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '900123456',
    description: 'NIT sin puntos ni DV',
  })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^\d{6,15}$/, {
    message: 'El NIT debe tener entre 6 y 15 dígitos, sin puntos ni dígito de verificación.',
  })
  taxId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '7' })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^\d$/, { message: 'El dígito de verificación es un solo número.' })
  taxIdDv?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Código DANE del establecimiento' })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^\d{6,20}$/, { message: 'El código DANE debe tener entre 6 y 20 dígitos.' })
  daneCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
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
  @IsUrl(
    { require_protocol: true, protocols: ['https', 'http'] },
    { message: 'El sitio web debe ser una URL completa (https://…).' },
  )
  @MaxLength(300)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  department?: string | null;
}

export class BrandingDto {
  @ApiPropertyOptional({ nullable: true, example: '#2453C4' })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'El color debe tener el formato #RRGGBB.' })
  primaryColor?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '#0E9384' })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'El color debe tener el formato #RRGGBB.' })
  accentColor?: string | null;
}

export class PreferencesDto {
  @ApiPropertyOptional({ description: 'Los acudientes pueden presentar excusas de inasistencia' })
  @IsOptional()
  @IsBoolean()
  guardianAbsenceExcusesEnabled?: boolean;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: 'America/Bogota' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ example: 'es-CO' })
  @IsOptional()
  @IsIn(['es-CO', 'es', 'en-US'], { message: 'Idioma no soportado.' })
  locale?: string;

  @ApiPropertyOptional({ example: 'COP' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda debe ser un código ISO 4217 (p. ej. COP).' })
  currency?: string;

  @ApiPropertyOptional({ type: BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;

  @ApiPropertyOptional({ type: PreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreferencesDto)
  preferences?: PreferencesDto;
}

// --- Sedes y jornadas -------------------------------------------------------

export class CreateCampusDto {
  @ApiProperty({ example: 'NORTE' })
  @UpperCode()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ example: 'Sede Norte' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isMain?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^\d{6,20}$/, { message: 'El código DANE debe tener entre 6 y 20 dígitos.' })
  daneCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @Matches(/^[0-9+()\s-]{7,40}$/, { message: 'El teléfono no es válido.' })
  phone?: string | null;
}

export class UpdateCampusDto extends PartialType(CreateCampusDto) {
  @ApiPropertyOptional({ enum: RECORD_STATUSES })
  @IsOptional()
  @IsIn(RECORD_STATUSES, { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: RecordStatus;
}

export class CreateShiftDto {
  @ApiProperty({ example: 'MANANA' })
  @UpperCode()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ example: 'Mañana' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(100)
  name: string;
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {
  @ApiPropertyOptional({ enum: RECORD_STATUSES })
  @IsOptional()
  @IsIn(RECORD_STATUSES, { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: RecordStatus;
}

// --- Respuestas -------------------------------------------------------------

export class SettingsViewDto {
  @ApiProperty() timezone: string;
  @ApiProperty() locale: string;
  @ApiProperty() currency: string;
  @ApiProperty({ type: BrandingDto }) branding: {
    primaryColor: string | null;
    accentColor: string | null;
  };
  @ApiProperty({ type: PreferencesDto }) preferences: { guardianAbsenceExcusesEnabled: boolean };
  @ApiProperty({ nullable: true }) logoUrl: string | null;
}

export class InstitutionViewDto {
  @ApiProperty() id: string;
  @ApiProperty() legalName: string;
  @ApiProperty({ nullable: true }) tradeName: string | null;
  @ApiProperty({ nullable: true }) taxId: string | null;
  @ApiProperty({ nullable: true }) taxIdDv: string | null;
  @ApiProperty({ nullable: true }) daneCode: string | null;
  @ApiProperty({ nullable: true }) email: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
  @ApiProperty({ nullable: true }) website: string | null;
  @ApiProperty({ nullable: true }) address: string | null;
  @ApiProperty({ nullable: true }) city: string | null;
  @ApiProperty({ nullable: true }) department: string | null;
  @ApiProperty() country: string;
  @ApiProperty({ type: SettingsViewDto }) settings: SettingsViewDto;
}

export class BrandingViewDto {
  @ApiProperty() name: string;
  @ApiProperty() legalName: string;
  @ApiProperty({ nullable: true }) primaryColor: string | null;
  @ApiProperty({ nullable: true }) accentColor: string | null;
  @ApiProperty({ nullable: true, description: 'Disponible cuando se habilite la carga del logo' })
  logoUrl: string | null;
}

export class CampusViewDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty() isMain: boolean;
  @ApiProperty({ nullable: true }) daneCode: string | null;
  @ApiProperty({ nullable: true }) address: string | null;
  @ApiProperty({ nullable: true }) city: string | null;
  @ApiProperty({ nullable: true }) phone: string | null;
  @ApiProperty({ enum: RECORD_STATUSES }) status: RecordStatus;
}

export class ShiftViewDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: RECORD_STATUSES }) status: RecordStatus;
}

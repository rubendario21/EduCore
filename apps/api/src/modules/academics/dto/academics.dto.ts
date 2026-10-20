import {
  ACADEMIC_PERIOD_STATUSES,
  ACADEMIC_YEAR_STATUSES,
  type AcademicPeriodStatus,
  type AcademicYearStatus,
  RECORD_STATUSES,
  type RecordStatus,
} from '@educore/shared';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  IsCalendarDate,
  Trim,
  UpperCode,
} from '../../../common/validation/decorators';

class CatalogItemDto {
  @ApiProperty({ example: 'PRIMARIA' })
  @UpperCode()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ example: 'Básica primaria' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(150)
  name: string;
}

// --- Niveles ----------------------------------------------------------------

export class CreateEducationLevelDto extends CatalogItemDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El orden debe ser un número entero.' })
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateEducationLevelDto extends PartialType(CreateEducationLevelDto) {
  @ApiPropertyOptional({ enum: RECORD_STATUSES })
  @IsOptional()
  @IsIn(RECORD_STATUSES, { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: RecordStatus;
}

// --- Grados -----------------------------------------------------------------

export class CreateGradeDto extends CatalogItemDto {
  @ApiProperty()
  @IsUUID('all', { message: 'educationLevelId debe ser un identificador válido.' })
  educationLevelId: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El orden debe ser un número entero.' })
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateGradeDto extends PartialType(CreateGradeDto) {
  @ApiPropertyOptional({ enum: RECORD_STATUSES })
  @IsOptional()
  @IsIn(RECORD_STATUSES, { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: RecordStatus;
}

export class ListGradesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'educationLevelId debe ser un identificador válido.' })
  educationLevelId?: string;
}

// --- Áreas y asignaturas ----------------------------------------------------

export class CreateSubjectAreaDto extends CatalogItemDto {}

export class UpdateSubjectAreaDto extends PartialType(CreateSubjectAreaDto) {
  @ApiPropertyOptional({ enum: RECORD_STATUSES })
  @IsOptional()
  @IsIn(RECORD_STATUSES, { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: RecordStatus;
}

export class CreateSubjectDto extends CatalogItemDto {
  @ApiProperty()
  @IsUUID('all', { message: 'subjectAreaId debe ser un identificador válido.' })
  subjectAreaId: string;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {
  @ApiPropertyOptional({ enum: RECORD_STATUSES })
  @IsOptional()
  @IsIn(RECORD_STATUSES, { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: RecordStatus;
}

export class ListSubjectsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'subjectAreaId debe ser un identificador válido.' })
  subjectAreaId?: string;
}

// --- Años lectivos y períodos ----------------------------------------------

export class CreateAcademicYearDto {
  @ApiProperty({ example: 2027 })
  @Type(() => Number)
  @IsInt({ message: 'El año debe ser un número entero.' })
  @Min(2000, { message: 'El año debe estar entre 2000 y 2100.' })
  @Max(2100, { message: 'El año debe estar entre 2000 y 2100.' })
  year: number;

  @ApiProperty({ example: 'Año lectivo 2027' })
  @Trim()
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres.' })
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '2027-01-25' })
  @IsCalendarDate()
  startsOn: string;

  @ApiProperty({ example: '2027-11-30' })
  @IsCalendarDate()
  endsOn: string;
}

export class UpdateAcademicYearDto extends PartialType(
  OmitType(CreateAcademicYearDto, ['year'] as const),
) {}

export class CreateAcademicPeriodDto {
  @ApiProperty({ example: 1, description: 'Número del período dentro del año (1, 2, 3…)' })
  @Type(() => Number)
  @IsInt({ message: 'El número debe ser un entero.' })
  @Min(1, { message: 'El número debe ser mayor o igual a 1.' })
  @Max(12)
  number: number;

  @ApiProperty({ example: 'Primer período' })
  @Trim()
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres.' })
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '2027-01-25' })
  @IsCalendarDate()
  startsOn: string;

  @ApiProperty({ example: '2027-04-02' })
  @IsCalendarDate()
  endsOn: string;

  @ApiProperty({ example: 25, description: 'Peso del período en la nota final (%)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El peso admite hasta 2 decimales.' })
  @Min(0.01, { message: 'El peso debe ser mayor que 0.' })
  @Max(100, { message: 'El peso no puede superar 100.' })
  weightPercent: number;
}

export class UpdateAcademicPeriodDto extends PartialType(CreateAcademicPeriodDto) {}

// --- Grupos -----------------------------------------------------------------

export class CreateSchoolGroupDto {
  @ApiProperty()
  @IsUUID('all', { message: 'academicYearId debe ser un identificador válido.' })
  academicYearId: string;

  @ApiProperty()
  @IsUUID('all', { message: 'gradeId debe ser un identificador válido.' })
  gradeId: string;

  @ApiProperty()
  @IsUUID('all', { message: 'campusId debe ser un identificador válido.' })
  campusId: string;

  @ApiProperty()
  @IsUUID('all', { message: 'shiftId debe ser un identificador válido.' })
  shiftId: string;

  @ApiProperty({ example: '601' })
  @UpperCode()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ example: 'Sexto A' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ nullable: true, example: 35 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La capacidad debe ser un número entero.' })
  @Min(1, { message: 'La capacidad debe ser mayor que 0.' })
  @Max(200)
  capacity?: number | null;
}

export class UpdateSchoolGroupDto extends PartialType(
  OmitType(CreateSchoolGroupDto, ['academicYearId'] as const),
) {
  @ApiPropertyOptional({ enum: RECORD_STATUSES })
  @IsOptional()
  @IsIn(RECORD_STATUSES, { message: 'El estado debe ser ACTIVE o INACTIVE.' })
  status?: RecordStatus;
}

export class ListSchoolGroupsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  gradeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  campusId?: string;
}

// --- Respuestas -------------------------------------------------------------

export class CatalogItemViewDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: RECORD_STATUSES }) status: RecordStatus;
}

export class EducationLevelViewDto extends CatalogItemViewDto {
  @ApiProperty() sortOrder: number;
}

export class GradeViewDto extends CatalogItemViewDto {
  @ApiProperty() sortOrder: number;
  @ApiProperty() educationLevelId: string;
  @ApiProperty() educationLevelName: string;
}

export class SubjectViewDto extends CatalogItemViewDto {
  @ApiProperty() subjectAreaId: string;
  @ApiProperty() subjectAreaName: string;
}

export class AcademicPeriodViewDto {
  @ApiProperty() id: string;
  @ApiProperty() academicYearId: string;
  @ApiProperty() number: number;
  @ApiProperty() name: string;
  @ApiProperty({ example: '2027-01-25' }) startsOn: string;
  @ApiProperty({ example: '2027-04-02' }) endsOn: string;
  @ApiProperty({ example: 25 }) weightPercent: number;
  @ApiProperty({ enum: ACADEMIC_PERIOD_STATUSES }) status: AcademicPeriodStatus;
}

export class AcademicYearViewDto {
  @ApiProperty() id: string;
  @ApiProperty() year: number;
  @ApiProperty() name: string;
  @ApiProperty() startsOn: string;
  @ApiProperty() endsOn: string;
  @ApiProperty({ enum: ACADEMIC_YEAR_STATUSES }) status: AcademicYearStatus;
  @ApiProperty({ description: 'Suma de los pesos de los períodos (%)' }) totalWeightPercent: number;
  @ApiProperty({ type: [AcademicPeriodViewDto] }) periods: AcademicPeriodViewDto[];
}

export class SchoolGroupViewDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) capacity: number | null;
  @ApiProperty({ enum: RECORD_STATUSES }) status: RecordStatus;
  @ApiProperty() academicYearId: string;
  @ApiProperty() academicYear: number;
  @ApiProperty() gradeId: string;
  @ApiProperty() gradeName: string;
  @ApiProperty() campusId: string;
  @ApiProperty() campusName: string;
  @ApiProperty() shiftId: string;
  @ApiProperty() shiftName: string;
}

export class ApplyTemplateDto {
  @ApiPropertyOptional({
    description: 'Solo simular: muestra qué se crearía sin guardar nada',
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'dryRun debe ser verdadero o falso.' })
  dryRun?: boolean;
}

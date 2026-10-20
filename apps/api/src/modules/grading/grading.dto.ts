import {
  PROMOTION_UNITS,
  type PromotionUnit,
  ROUNDING_MODES,
  type RoundingMode,
} from '@educore/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  EmptyToNull,
  Trim,
  UpperCode,
} from '../../common/validation/decorators';

const scoreMessage = { message: 'La nota debe ser un número entre -999 y 9999.' };
const score = () => (target: object, key: string) => {
  IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }, scoreMessage)(
    target,
    key,
  );
  Min(-999, scoreMessage)(target, key);
  Max(9999, scoreMessage)(target, key);
};

export class PerformanceLevelInputDto {
  @ApiProperty({ example: 'SUPERIOR' })
  @UpperCode()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ example: 'Desempeño Superior' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty({ example: 4.6 })
  @score()
  minScore: number;

  @ApiProperty({ example: 5 })
  @score()
  maxScore: number;
}

export class EvaluationComponentInputDto {
  @ApiProperty({ example: 'COGNITIVO' })
  @UpperCode()
  @Matches(CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiProperty({ example: 'Cognitivo' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty({ example: 60 })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El peso debe ser un porcentaje con hasta 2 decimales.' },
  )
  @Min(0.01)
  @Max(100)
  weightPercent: number;
}

/** Configuración completa del SIEE de un año (se reemplaza entera). */
export class GradingSchemeInputDto {
  @ApiProperty({ example: 1 })
  @score()
  minScore: number;

  @ApiProperty({ example: 5 })
  @score()
  maxScore: number;

  @ApiProperty({ example: 1, description: 'Decimales de las notas (0, 1 o 2)' })
  @IsInt({ message: 'Los decimales deben ser 0, 1 o 2.' })
  @Min(0, { message: 'Los decimales deben ser 0, 1 o 2.' })
  @Max(2, { message: 'Los decimales deben ser 0, 1 o 2.' })
  decimals: number;

  @ApiProperty({ example: 3 })
  @score()
  passingScore: number;

  @ApiProperty({ enum: ROUNDING_MODES })
  @IsIn(ROUNDING_MODES, { message: 'Modo de redondeo no válido.' })
  rounding: RoundingMode;

  @ApiProperty({ enum: PROMOTION_UNITS })
  @IsIn(PROMOTION_UNITS, { message: 'Unidad de promoción no válida.' })
  promotionUnit: PromotionUnit;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Máximo de áreas/asignaturas reprobadas para ser promovido',
  })
  @IsOptional()
  @IsInt({ message: 'Debe ser un número entero.' })
  @Min(0)
  @Max(50)
  maxFailedForPromotion?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Asistencia mínima (%) para aprobar' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Debe ser un porcentaje.' })
  @Min(0)
  @Max(100)
  minAttendancePercent?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiProperty({ type: [PerformanceLevelInputDto] })
  @ValidateNested({ each: true })
  @Type(() => PerformanceLevelInputDto)
  @ArrayMinSize(1, { message: 'Define al menos un nivel de desempeño.' })
  @ArrayMaxSize(10)
  levels: PerformanceLevelInputDto[];

  @ApiPropertyOptional({
    type: [EvaluationComponentInputDto],
    description:
      'Componentes de la nota del período (suman 100 %). Si se omite, se conservan los actuales (o "General" al 100 %).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EvaluationComponentInputDto)
  @ArrayMinSize(1, { message: 'Define al menos un componente de evaluación.' })
  @ArrayMaxSize(10)
  components?: EvaluationComponentInputDto[];
}

export class CopySchemeDto {
  @ApiProperty({ description: 'Año lectivo cuyo SIEE se copia' })
  @IsUUID('all', { message: 'fromAcademicYearId debe ser un identificador válido.' })
  fromAcademicYearId: string;
}

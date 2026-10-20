import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EmptyToNull, IsCalendarDate, Trim } from '../../common/validation/decorators';

const uuidMessage = (field: string) => ({ message: `${field} debe ser un identificador válido.` });

export class GradebookQueryDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('schoolGroupId'))
  schoolGroupId: string;

  @ApiProperty()
  @IsUUID('all', uuidMessage('subjectId'))
  subjectId: string;

  @ApiProperty()
  @IsUUID('all', uuidMessage('periodId'))
  periodId: string;
}

export class CreateAssessmentDto extends GradebookQueryDto {
  @ApiProperty({ description: 'Componente del SIEE al que pertenece' })
  @IsUUID('all', uuidMessage('componentId'))
  componentId: string;

  @ApiProperty({ example: 'Evaluación de fracciones' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'El título debe tener al menos 2 caracteres.' })
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2027-03-15' })
  @IsOptional()
  @EmptyToNull()
  @IsCalendarDate()
  dueOn?: string | null;
}

export class UpdateAssessmentDto extends PartialType(
  PickType(CreateAssessmentDto, ['componentId', 'title', 'description', 'dueOn'] as const),
) {}

export class GradeEntryDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('enrollmentId'))
  enrollmentId: string;

  @ApiProperty({ nullable: true, description: 'Nota en la escala del SIEE; null retira la nota' })
  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'La nota debe ser un número.' },
  )
  score: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}

export class SaveGradesDto {
  @ApiProperty({ type: [GradeEntryDto] })
  @ValidateNested({ each: true })
  @Type(() => GradeEntryDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  grades: GradeEntryDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Motivo del cambio (queda en el historial)' })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

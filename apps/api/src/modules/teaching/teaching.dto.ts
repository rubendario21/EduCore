import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { IsCalendarDate } from '../../common/validation/decorators';

const uuidMessage = (field: string) => ({ message: `${field} debe ser un identificador válido.` });
const hoursMessage = { message: 'La intensidad horaria debe ser un número entero de 1 a 40.' };

// --- Plan de estudios --------------------------------------------------------

export class ListCurriculumQueryDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('academicYearId'))
  academicYearId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('gradeId'))
  gradeId?: string;
}

export class CreateCurriculumSubjectDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('academicYearId'))
  academicYearId: string;

  @ApiProperty()
  @IsUUID('all', uuidMessage('gradeId'))
  gradeId: string;

  @ApiProperty()
  @IsUUID('all', uuidMessage('subjectId'))
  subjectId: string;

  @ApiProperty({ description: 'Horas semanales (1 a 40)' })
  @IsInt(hoursMessage)
  @Min(1, hoursMessage)
  @Max(40, hoursMessage)
  weeklyHours: number;
}

export class UpdateCurriculumSubjectDto {
  @ApiProperty({ description: 'Horas semanales (1 a 40)' })
  @IsInt(hoursMessage)
  @Min(1, hoursMessage)
  @Max(40, hoursMessage)
  weeklyHours: number;
}

export class CopyCurriculumDto {
  @ApiProperty({ description: 'Año lectivo cuyo plan se copia' })
  @IsUUID('all', uuidMessage('fromAcademicYearId'))
  fromAcademicYearId: string;

  @ApiProperty({ description: 'Año lectivo que recibe el plan' })
  @IsUUID('all', uuidMessage('toAcademicYearId'))
  toAcademicYearId: string;
}

// --- Asignación académica ----------------------------------------------------

export class ListAssignmentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('academicYearId'))
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('schoolGroupId'))
  schoolGroupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('staffMemberId'))
  staffMemberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('subjectId'))
  subjectId?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Incluir asignaciones finalizadas (historial). Por defecto solo las vigentes.',
  })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'includeEnded debe ser true o false.' })
  includeEnded?: 'true' | 'false';
}

export class CreateAssignmentDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('schoolGroupId'))
  schoolGroupId: string;

  @ApiProperty()
  @IsUUID('all', uuidMessage('subjectId'))
  subjectId: string;

  @ApiProperty({ description: 'Docente (miembro del personal de tipo docente)' })
  @IsUUID('all', uuidMessage('staffMemberId'))
  staffMemberId: string;

  @ApiPropertyOptional({ description: 'Desde cuándo dicta la asignatura (por defecto, hoy)' })
  @IsOptional()
  @IsCalendarDate()
  fromDate?: string;
}

export class ReplaceAssignmentDto {
  @ApiProperty({ description: 'Docente que asume la asignatura' })
  @IsUUID('all', uuidMessage('staffMemberId'))
  staffMemberId: string;

  @ApiPropertyOptional({ description: 'Fecha del reemplazo (por defecto, hoy)' })
  @IsOptional()
  @IsCalendarDate()
  effectiveDate?: string;
}

export class EndAssignmentDto {
  @ApiPropertyOptional({ description: 'Fecha de finalización (por defecto, hoy)' })
  @IsOptional()
  @IsCalendarDate()
  date?: string;
}

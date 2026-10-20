import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { EmptyToNull, IsCalendarDate, Trim } from '../../common/validation/decorators';

export const ENROLLMENT_STATUSES = [
  'PRE_ENROLLED',
  'ACTIVE',
  'WITHDRAWN',
  'TRANSFERRED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const WITHDRAWAL_REASONS = [
  'VOLUNTARY',
  'ACADEMIC',
  'DISCIPLINARY',
  'HEALTH',
  'RELOCATION',
  'ECONOMIC',
  'OTHER',
] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

const uuidMessage = (field: string) => ({ message: `${field} debe ser un identificador válido.` });

export class ListEnrollmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('academicYearId'))
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('gradeId'))
  gradeId?: string;

  @ApiPropertyOptional({ description: 'Grupo actual (ubicación vigente)' })
  @IsOptional()
  @IsUUID('all', uuidMessage('schoolGroupId'))
  schoolGroupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', uuidMessage('studentId'))
  studentId?: string;

  @ApiPropertyOptional({ enum: ENROLLMENT_STATUSES })
  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES, { message: 'Estado no válido.' })
  status?: EnrollmentStatus;

  @ApiPropertyOptional({ description: 'Nombre, documento o código del estudiante' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateEnrollmentDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('studentId'))
  studentId: string;

  @ApiProperty()
  @IsUUID('all', uuidMessage('academicYearId'))
  academicYearId: string;

  @ApiProperty()
  @IsUUID('all', uuidMessage('gradeId'))
  gradeId: string;

  @ApiPropertyOptional({ description: 'Grupo (opcional; puede asignarse después)' })
  @IsOptional()
  @IsUUID('all', uuidMessage('schoolGroupId'))
  schoolGroupId?: string;

  @ApiPropertyOptional({ enum: ['PRE_ENROLLED', 'ACTIVE'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['PRE_ENROLLED', 'ACTIVE'], {
    message: 'El estado inicial debe ser PRE_ENROLLED o ACTIVE.',
  })
  status?: 'PRE_ENROLLED' | 'ACTIVE';

  @ApiPropertyOptional({ description: 'Fecha de matrícula (por defecto, hoy)' })
  @IsOptional()
  @IsCalendarDate()
  enrolledOn?: string;
}

export class ChangePlacementDto {
  @ApiProperty()
  @IsUUID('all', uuidMessage('schoolGroupId'))
  schoolGroupId: string;

  @ApiPropertyOptional({ description: 'Desde cuándo rige el cambio (por defecto, hoy)' })
  @IsOptional()
  @IsCalendarDate()
  effectiveDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

export class WithdrawEnrollmentDto {
  @ApiProperty({ example: '2027-05-20' })
  @IsCalendarDate()
  date: string;

  @ApiProperty({ enum: WITHDRAWAL_REASONS })
  @IsIn(WITHDRAWAL_REASONS, { message: 'Motivo de retiro no válido.' })
  reason: WithdrawalReason;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(500)
  detail?: string | null;
}

export class TransferEnrollmentDto {
  @ApiProperty({ example: '2027-05-20' })
  @IsCalendarDate()
  date: string;

  @ApiProperty({ description: 'Institución de destino' })
  @Trim()
  @IsString()
  @MaxLength(300)
  destination: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EmptyToNull()
  @IsString()
  @MaxLength(180)
  detail?: string | null;
}

export class RenewEnrollmentsDto {
  @ApiProperty({ description: 'Año del que se renuevan las matrículas' })
  @IsUUID('all', uuidMessage('fromAcademicYearId'))
  fromAcademicYearId: string;

  @ApiProperty({ description: 'Año en el que se crean las prematrículas' })
  @IsUUID('all', uuidMessage('toAcademicYearId'))
  toAcademicYearId: string;

  @ApiProperty({ enum: ['NEXT', 'SAME'], description: 'Siguiente grado o mismo grado' })
  @IsIn(['NEXT', 'SAME'], { message: 'La estrategia debe ser NEXT o SAME.' })
  gradeStrategy: 'NEXT' | 'SAME';

  @ApiPropertyOptional({ description: 'Solo estos estudiantes (por defecto, todos)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true, message: 'Cada estudiante debe ser un identificador válido.' })
  studentIds?: string[];

  @ApiPropertyOptional({ description: 'Simular sin guardar (informe previo)', default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

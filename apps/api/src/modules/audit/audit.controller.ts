import { PERMISSIONS } from '@educore/shared';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto, type Paginated } from '../../common/pagination/pagination';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/auth.decorators';
import { AuditService } from './audit.service';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'users.account.created',
    description: 'Acción exacta o prefijo terminado en *',
  })
  @IsOptional()
  @Matches(/^[a-z_.]+\*?$/, { message: 'Acción no válida.' })
  action?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @Matches(/^[a-z_]{2,60}$/, { message: 'Tipo de entidad no válido.' })
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'entityId debe ser un UUID.' })
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'actorUserId debe ser un UUID.' })
  actorUserId?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsDateString({}, { message: 'from debe ser una fecha ISO 8601.' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59Z' })
  @IsOptional()
  @IsDateString({}, { message: 'to debe ser una fecha ISO 8601.' })
  to?: string;
}

export class AuditActorDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty({ nullable: true }) name: string | null;
}

export class AuditLogDto {
  @ApiProperty() id: string;
  @ApiProperty() action: string;
  @ApiProperty({ nullable: true }) entityType: string | null;
  @ApiProperty({ nullable: true }) entityId: string | null;
  @ApiProperty({ type: AuditActorDto, nullable: true }) actor: AuditActorDto | null;
  @ApiProperty({ nullable: true, type: Object }) changes: unknown;
  @ApiProperty({ nullable: true, type: Object }) metadata: unknown;
  @ApiProperty({ nullable: true }) ip: string | null;
  @ApiProperty({ nullable: true }) requestId: string | null;
  @ApiProperty() createdAt: string;
}

@ApiTags('Auditoría')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({
    summary: 'Consultar el registro de auditoría de la institución (más reciente primero)',
  })
  @ApiOkResponse({ description: 'Página de eventos de auditoría' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogDto>> {
    return this.audit.list(auth.institutionId, query);
  }
}

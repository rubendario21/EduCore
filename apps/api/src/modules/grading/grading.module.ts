import { PERMISSIONS } from '@educore/shared';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { CopySchemeDto, GradingSchemeInputDto } from './grading.dto';
import { GradingService } from './grading.service';

const uuid = new ParseUUIDPipe();

@ApiTags('SIEE')
@ApiBearerAuth()
@Controller('academic-years/:yearId/grading-scheme')
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ACADEMICS_READ)
  @ApiOperation({ summary: 'SIEE del año: escala, niveles de desempeño y reglas de promoción' })
  get(@CurrentAuth() auth: AuthContext, @Param('yearId', uuid) yearId: string) {
    return this.grading.get(auth, yearId);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.GRADING_MANAGE)
  @ApiOperation({
    summary: 'Crear o reemplazar el SIEE del año (se valida que los niveles cubran la escala)',
  })
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('yearId', uuid) yearId: string,
    @Body() body: GradingSchemeInputDto,
    @Client() client: ClientInfo,
  ) {
    return this.grading.save(auth, yearId, body, client);
  }

  @Post('copy')
  @RequirePermissions(PERMISSIONS.GRADING_MANAGE)
  @ApiOperation({ summary: 'Copiar el SIEE de otro año a este (si aún no lo tiene)' })
  copy(
    @CurrentAuth() auth: AuthContext,
    @Param('yearId', uuid) yearId: string,
    @Body() body: CopySchemeDto,
    @Client() client: ClientInfo,
  ) {
    return this.grading.copy(auth, yearId, body.fromAcademicYearId, client);
  }
}

@Module({
  controllers: [GradingController],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}

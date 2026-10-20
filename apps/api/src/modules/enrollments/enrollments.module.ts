import { PERMISSIONS } from '@educore/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { TeachingModule } from '../teaching/teaching.module';
import {
  ChangePlacementDto,
  CreateEnrollmentDto,
  ListEnrollmentsQueryDto,
  RenewEnrollmentsDto,
  TransferEnrollmentDto,
  WithdrawEnrollmentDto,
} from './enrollments.dto';
import { EnrollmentsRepository } from './enrollments.repository';
import { EnrollmentsService } from './enrollments.service';

const uuid = new ParseUUIDPipe();
const READ = PERMISSIONS.ENROLLMENTS_READ;
const MANAGE = PERMISSIONS.ENROLLMENTS_MANAGE;

@ApiTags('Matrícula')
@ApiBearerAuth()
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @RequirePermissions(READ)
  @ApiOperation({
    summary: 'Listar matrículas (filtros por año, grado, grupo, estudiante y estado)',
  })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListEnrollmentsQueryDto) {
    return this.enrollments.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Consultar una matrícula con su historial de grupos' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.enrollments.get(auth, id);
  }

  @Post()
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Matricular (o prematricular) a un estudiante en un año y grado' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateEnrollmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.enrollments.create(auth, body, client);
  }

  @Post('renewals')
  @RequirePermissions(MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar matrículas al año siguiente (con simulación previa)' })
  renew(
    @CurrentAuth() auth: AuthContext,
    @Body() body: RenewEnrollmentsDto,
    @Client() client: ClientInfo,
  ) {
    return this.enrollments.renew(auth, body, client);
  }

  @Post(':id/activate')
  @RequirePermissions(MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Formalizar una prematrícula' })
  activate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    return this.enrollments.activate(auth, id, client);
  }

  @Post(':id/cancel')
  @RequirePermissions(MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anular una prematrícula registrada por error (se conserva)' })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    return this.enrollments.cancel(auth, id, client);
  }

  @Post(':id/placement')
  @RequirePermissions(MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ubicar o cambiar de grupo (conserva el historial)' })
  changePlacement(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: ChangePlacementDto,
    @Client() client: ClientInfo,
  ) {
    return this.enrollments.changePlacement(auth, id, body, client);
  }

  @Post(':id/withdraw')
  @RequirePermissions(MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retirar al estudiante (fecha y motivo)' })
  withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: WithdrawEnrollmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.enrollments.withdraw(auth, id, body, client);
  }

  @Post(':id/transfer')
  @RequirePermissions(MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar el traslado a otra institución' })
  transfer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TransferEnrollmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.enrollments.transfer(auth, id, body, client);
  }
}

@Module({
  imports: [TeachingModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsRepository, EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}

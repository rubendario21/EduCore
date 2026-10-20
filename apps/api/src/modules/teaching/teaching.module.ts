import { PERMISSIONS } from '@educore/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { CurriculumService } from './curriculum.service';
import { TeachingAssignmentsService } from './teaching-assignments.service';
import { TeachingScope } from './teaching-scope.service';
import {
  CopyCurriculumDto,
  CreateAssignmentDto,
  CreateCurriculumSubjectDto,
  EndAssignmentDto,
  ListAssignmentsQueryDto,
  ListCurriculumQueryDto,
  ReplaceAssignmentDto,
  UpdateCurriculumSubjectDto,
} from './teaching.dto';
import { TeachingRepository } from './teaching.repository';

const uuid = new ParseUUIDPipe();
const P = PERMISSIONS;

@ApiTags('Plan de estudios')
@ApiBearerAuth()
@Controller('curriculum')
export class CurriculumController {
  constructor(private readonly curriculum: CurriculumService) {}

  @Get()
  @RequirePermissions(P.ACADEMICS_READ)
  @ApiOperation({ summary: 'Plan de estudios de un año (opcionalmente de un grado)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListCurriculumQueryDto) {
    return this.curriculum.list(auth, query);
  }

  @Post()
  @RequirePermissions(P.ACADEMICS_MANAGE)
  @ApiOperation({
    summary: 'Agregar una asignatura al plan de un grado, con su intensidad horaria',
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateCurriculumSubjectDto,
    @Client() client: ClientInfo,
  ) {
    return this.curriculum.create(auth, body, client);
  }

  @Post('copy')
  @RequirePermissions(P.ACADEMICS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Copiar el plan de estudios de un año a otro (sin duplicar)' })
  copy(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CopyCurriculumDto,
    @Client() client: ClientInfo,
  ) {
    return this.curriculum.copy(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(P.ACADEMICS_MANAGE)
  @ApiOperation({ summary: 'Cambiar la intensidad horaria' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateCurriculumSubjectDto,
    @Client() client: ClientInfo,
  ) {
    return this.curriculum.update(auth, id, body, client);
  }

  @Delete(':id')
  @RequirePermissions(P.ACADEMICS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quitar una asignatura del plan (solo si nunca tuvo docente asignado)' })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    await this.curriculum.remove(auth, id, client);
  }
}

@ApiTags('Asignación académica')
@ApiBearerAuth()
@Controller('teaching-assignments')
export class TeachingAssignmentsController {
  constructor(private readonly assignments: TeachingAssignmentsService) {}

  @Get()
  @RequirePermissions(P.TEACHING_READ)
  @ApiOperation({
    summary: 'Listar asignaciones (un docente con alcance ASSIGNED solo ve las suyas)',
  })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListAssignmentsQueryDto) {
    return this.assignments.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(P.TEACHING_READ)
  @ApiOperation({ summary: 'Consultar una asignación' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.assignments.get(auth, id);
  }

  @Get(':id/students')
  @RequirePermissions(P.TEACHING_READ)
  @ApiOperation({ summary: 'Lista de clase: estudiantes ubicados hoy en el grupo' })
  roster(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.assignments.roster(auth, id);
  }

  @Post()
  @RequirePermissions(P.TEACHING_MANAGE)
  @ApiOperation({ summary: 'Asignar un docente a una asignatura de un grupo' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateAssignmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.assignments.create(auth, body, client);
  }

  @Post(':id/replace')
  @RequirePermissions(P.TEACHING_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reemplazar al docente desde una fecha (conserva el historial)' })
  replace(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: ReplaceAssignmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.assignments.replace(auth, id, body, client);
  }

  @Post(':id/end')
  @RequirePermissions(P.TEACHING_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalizar la asignación' })
  end(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: EndAssignmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.assignments.end(auth, id, body, client);
  }
}

@Module({
  controllers: [CurriculumController, TeachingAssignmentsController],
  providers: [TeachingRepository, TeachingScope, CurriculumService, TeachingAssignmentsService],
  exports: [TeachingRepository, TeachingScope],
})
export class TeachingModule {}

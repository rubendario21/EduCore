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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { TeachingModule } from '../teaching/teaching.module';
import {
  CreateAssessmentDto,
  GradebookQueryDto,
  SaveGradesDto,
  UpdateAssessmentDto,
} from './gradebook.dto';
import { GradebookService } from './gradebook.service';

const uuid = new ParseUUIDPipe();
const P = PERMISSIONS;

@ApiTags('Notas')
@ApiBearerAuth()
@Controller()
export class GradebookController {
  constructor(private readonly gradebook: GradebookService) {}

  @Get('gradebook')
  @RequirePermissions(P.GRADES_READ)
  @ApiOperation({
    summary: 'Planilla de notas de una asignatura en un grupo y período (con la nota parcial)',
  })
  get(@CurrentAuth() auth: AuthContext, @Query() query: GradebookQueryDto) {
    return this.gradebook.gradebook(auth, query);
  }

  @Post('assessments')
  @RequirePermissions(P.GRADES_MANAGE)
  @ApiOperation({ summary: 'Crear una actividad evaluativa (período abierto)' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateAssessmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.gradebook.createAssessment(auth, body, client);
  }

  @Patch('assessments/:id')
  @RequirePermissions(P.GRADES_MANAGE)
  @ApiOperation({ summary: 'Editar una actividad (cambiar de componente solo si no tiene notas)' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateAssessmentDto,
    @Client() client: ClientInfo,
  ) {
    return this.gradebook.updateAssessment(auth, id, body, client);
  }

  @Delete('assessments/:id')
  @RequirePermissions(P.GRADES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una actividad sin notas' })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    await this.gradebook.deleteAssessment(auth, id, client);
  }

  @Put('assessments/:id/grades')
  @RequirePermissions(P.GRADES_MANAGE)
  @ApiOperation({
    summary: 'Registrar o cambiar notas de una actividad (todo o nada, con historial)',
  })
  saveGrades(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: SaveGradesDto,
    @Client() client: ClientInfo,
  ) {
    return this.gradebook.saveGrades(auth, id, body, client);
  }

  @Get('assessments/:id/grades/:enrollmentId/history')
  @RequirePermissions(P.GRADES_READ)
  @ApiOperation({ summary: 'Historial de la nota de un estudiante en una actividad' })
  history(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('enrollmentId', uuid) enrollmentId: string,
  ) {
    return this.gradebook.history(auth, id, enrollmentId);
  }
}

@Module({
  imports: [TeachingModule],
  controllers: [GradebookController],
  providers: [GradebookService],
})
export class GradebookModule {}

import { PERMISSIONS } from '@educore/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { AcademicYearsService } from './academic-years.service';
import { CatalogService } from './catalog.service';
import {
  AcademicYearViewDto,
  CatalogItemViewDto,
  CreateAcademicPeriodDto,
  CreateAcademicYearDto,
  CreateEducationLevelDto,
  CreateGradeDto,
  CreateSchoolGroupDto,
  CreateSubjectAreaDto,
  CreateSubjectDto,
  EducationLevelViewDto,
  GradeViewDto,
  ListGradesQueryDto,
  ListSchoolGroupsQueryDto,
  ListSubjectsQueryDto,
  SchoolGroupViewDto,
  SubjectViewDto,
  UpdateAcademicPeriodDto,
  UpdateAcademicYearDto,
  UpdateEducationLevelDto,
  UpdateGradeDto,
  UpdateSchoolGroupDto,
  UpdateSubjectAreaDto,
  UpdateSubjectDto,
} from './dto/academics.dto';
import { SchoolGroupsService } from './school-groups.service';

const uuid = new ParseUUIDPipe();
const READ = PERMISSIONS.ACADEMICS_READ;
const MANAGE = PERMISSIONS.ACADEMICS_MANAGE;
const YEARS = PERMISSIONS.ACADEMIC_YEARS_MANAGE;

@ApiTags('Estructura académica')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('education-levels')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Listar niveles educativos' })
  @ApiOkResponse({ type: [EducationLevelViewDto] })
  listLevels(@CurrentAuth() auth: AuthContext) {
    return this.catalog.listLevels(auth);
  }

  @Post('education-levels')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Crear un nivel educativo' })
  @ApiCreatedResponse({ type: EducationLevelViewDto })
  createLevel(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateEducationLevelDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.createLevel(auth, body, client);
  }

  @Patch('education-levels/:id')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Editar o desactivar un nivel educativo' })
  @ApiOkResponse({ type: EducationLevelViewDto })
  updateLevel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateEducationLevelDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.updateLevel(auth, id, body, client);
  }

  @Get('grades')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Listar grados' })
  @ApiOkResponse({ type: [GradeViewDto] })
  listGrades(@CurrentAuth() auth: AuthContext, @Query() query: ListGradesQueryDto) {
    return this.catalog.listGrades(auth, query.educationLevelId);
  }

  @Post('grades')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Crear un grado' })
  @ApiCreatedResponse({ type: GradeViewDto })
  createGrade(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateGradeDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.createGrade(auth, body, client);
  }

  @Patch('grades/:id')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Editar o desactivar un grado' })
  @ApiOkResponse({ type: GradeViewDto })
  updateGrade(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateGradeDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.updateGrade(auth, id, body, client);
  }

  @Get('subject-areas')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Listar áreas' })
  @ApiOkResponse({ type: [CatalogItemViewDto] })
  listAreas(@CurrentAuth() auth: AuthContext) {
    return this.catalog.listAreas(auth);
  }

  @Post('subject-areas')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Crear un área' })
  @ApiCreatedResponse({ type: CatalogItemViewDto })
  createArea(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateSubjectAreaDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.createArea(auth, body, client);
  }

  @Patch('subject-areas/:id')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Editar o desactivar un área' })
  @ApiOkResponse({ type: CatalogItemViewDto })
  updateArea(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateSubjectAreaDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.updateArea(auth, id, body, client);
  }

  @Get('subjects')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Listar asignaturas' })
  @ApiOkResponse({ type: [SubjectViewDto] })
  listSubjects(@CurrentAuth() auth: AuthContext, @Query() query: ListSubjectsQueryDto) {
    return this.catalog.listSubjects(auth, query.subjectAreaId);
  }

  @Post('subjects')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Crear una asignatura' })
  @ApiCreatedResponse({ type: SubjectViewDto })
  createSubject(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateSubjectDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.createSubject(auth, body, client);
  }

  @Patch('subjects/:id')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Editar o desactivar una asignatura' })
  @ApiOkResponse({ type: SubjectViewDto })
  updateSubject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateSubjectDto,
    @Client() client: ClientInfo,
  ) {
    return this.catalog.updateSubject(auth, id, body, client);
  }
}

@ApiTags('Años lectivos')
@ApiBearerAuth()
@Controller()
export class AcademicYearsController {
  constructor(private readonly years: AcademicYearsService) {}

  @Get('academic-years')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Listar años lectivos con sus períodos' })
  @ApiOkResponse({ type: [AcademicYearViewDto] })
  list(@CurrentAuth() auth: AuthContext) {
    return this.years.list(auth);
  }

  @Get('academic-years/:id')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Consultar un año lectivo' })
  @ApiOkResponse({ type: AcademicYearViewDto })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.years.get(auth, id);
  }

  @Post('academic-years')
  @RequirePermissions(YEARS)
  @ApiOperation({ summary: 'Crear un año lectivo (queda en planeación)' })
  @ApiCreatedResponse({ type: AcademicYearViewDto })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateAcademicYearDto,
    @Client() client: ClientInfo,
  ) {
    return this.years.create(auth, body, client);
  }

  @Patch('academic-years/:id')
  @RequirePermissions(YEARS)
  @ApiOperation({ summary: 'Editar nombre o fechas de un año lectivo' })
  @ApiOkResponse({ type: AcademicYearViewDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateAcademicYearDto,
    @Client() client: ClientInfo,
  ) {
    return this.years.update(auth, id, body, client);
  }

  @Post('academic-years/:id/activate')
  @RequirePermissions(YEARS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar el año lectivo (sus períodos deben sumar 100 %)' })
  @ApiOkResponse({ type: AcademicYearViewDto })
  activate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    return this.years.activate(auth, id, client);
  }

  @Post('academic-years/:id/close')
  @RequirePermissions(YEARS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar el año lectivo (queda de solo lectura)' })
  @ApiOkResponse({ type: AcademicYearViewDto })
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    return this.years.close(auth, id, client);
  }

  @Post('academic-years/:id/periods')
  @RequirePermissions(YEARS)
  @ApiOperation({ summary: 'Agregar un período (solo en años en planeación)' })
  @ApiCreatedResponse({ type: AcademicYearViewDto })
  createPeriod(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: CreateAcademicPeriodDto,
    @Client() client: ClientInfo,
  ) {
    return this.years.createPeriod(auth, id, body, client);
  }

  @Patch('academic-periods/:id')
  @RequirePermissions(YEARS)
  @ApiOperation({ summary: 'Editar un período (con el año activo, solo el nombre)' })
  @ApiOkResponse({ type: AcademicYearViewDto })
  updatePeriod(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateAcademicPeriodDto,
    @Client() client: ClientInfo,
  ) {
    return this.years.updatePeriod(auth, id, body, client);
  }

  @Delete('academic-periods/:id')
  @RequirePermissions(YEARS)
  @ApiOperation({ summary: 'Eliminar un período (solo en años en planeación)' })
  @ApiOkResponse({ type: AcademicYearViewDto })
  deletePeriod(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    return this.years.deletePeriod(auth, id, client);
  }
}

@ApiTags('Grupos')
@ApiBearerAuth()
@Controller('school-groups')
export class SchoolGroupsController {
  constructor(private readonly groups: SchoolGroupsService) {}

  @Get()
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Listar grupos (filtros por año, grado y sede)' })
  @ApiOkResponse({ type: [SchoolGroupViewDto] })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListSchoolGroupsQueryDto) {
    return this.groups.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(READ)
  @ApiOperation({ summary: 'Consultar un grupo' })
  @ApiOkResponse({ type: SchoolGroupViewDto })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.groups.get(auth, id);
  }

  @Post()
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Crear un grupo' })
  @ApiCreatedResponse({ type: SchoolGroupViewDto })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateSchoolGroupDto,
    @Client() client: ClientInfo,
  ) {
    return this.groups.create(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Editar o desactivar un grupo' })
  @ApiOkResponse({ type: SchoolGroupViewDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateSchoolGroupDto,
    @Client() client: ClientInfo,
  ) {
    return this.groups.update(auth, id, body, client);
  }
}

import { PERMISSIONS } from '@educore/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  CreateGuardianDto,
  CreateStaffDto,
  CreateStudentDto,
  GrantAccessDto,
  GrantStaffAccessDto,
  LinkGuardianDto,
  ListGuardiansQueryDto,
  ListStaffQueryDto,
  ListStudentsQueryDto,
  UpdateGuardianDto,
  UpdateGuardianLinkDto,
  UpdateStaffDto,
  UpdateStudentDto,
} from './dto/people.dto';
import { GuardiansService, StaffService } from './guardians-staff.service';
import { StudentsService } from './students.service';

const uuid = new ParseUUIDPipe();
const P = PERMISSIONS;

@ApiTags('Estudiantes')
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @RequirePermissions(P.STUDENTS_READ)
  @ApiOperation({ summary: 'Listar estudiantes' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListStudentsQueryDto) {
    return this.students.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(P.STUDENTS_READ)
  @ApiOperation({ summary: 'Consultar un estudiante con sus acudientes' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.students.get(auth, id);
  }

  @Post()
  @RequirePermissions(P.STUDENTS_MANAGE)
  @ApiOperation({
    summary: 'Registrar un estudiante (reutiliza la persona si el documento ya existe)',
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateStudentDto,
    @Client() client: ClientInfo,
  ) {
    return this.students.create(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(P.STUDENTS_MANAGE)
  @ApiOperation({ summary: 'Editar un estudiante (datos, código o estado)' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateStudentDto,
    @Client() client: ClientInfo,
  ) {
    return this.students.update(auth, id, body, client);
  }

  @Post(':id/guardians')
  @RequirePermissions(P.STUDENTS_MANAGE)
  @ApiOperation({ summary: 'Vincular un acudiente (existente o nuevo)' })
  link(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: LinkGuardianDto,
    @Client() client: ClientInfo,
  ) {
    return this.students.linkGuardian(auth, id, body, client);
  }

  @Patch(':id/guardians/:guardianId')
  @RequirePermissions(P.STUDENTS_MANAGE)
  @ApiOperation({ summary: 'Editar el vínculo con un acudiente' })
  updateLink(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('guardianId', uuid) guardianId: string,
    @Body() body: UpdateGuardianLinkDto,
    @Client() client: ClientInfo,
  ) {
    return this.students.updateGuardianLink(auth, id, guardianId, body, client);
  }

  @Delete(':id/guardians/:guardianId')
  @RequirePermissions(P.STUDENTS_MANAGE)
  @ApiOperation({ summary: 'Desvincular un acudiente (el acudiente sigue registrado)' })
  unlink(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('guardianId', uuid) guardianId: string,
    @Client() client: ClientInfo,
  ) {
    return this.students.unlinkGuardian(auth, id, guardianId, client);
  }

  @Post(':id/access')
  @RequirePermissions(P.STUDENTS_MANAGE, P.USERS_CREATE, P.USERS_ROLES_ASSIGN)
  @ApiOperation({ summary: 'Dar acceso al portal al estudiante (envía la activación)' })
  grantAccess(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: GrantAccessDto,
    @Client() client: ClientInfo,
  ) {
    return this.students.grantAccess(auth, id, body.email, client);
  }
}

@ApiTags('Acudientes')
@ApiBearerAuth()
@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  @RequirePermissions(P.GUARDIANS_READ)
  @ApiOperation({ summary: 'Listar acudientes' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListGuardiansQueryDto) {
    return this.guardians.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(P.GUARDIANS_READ)
  @ApiOperation({ summary: 'Consultar un acudiente con sus estudiantes' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.guardians.get(auth, id);
  }

  @Post()
  @RequirePermissions(P.GUARDIANS_MANAGE)
  @ApiOperation({
    summary: 'Registrar un acudiente (reutiliza la persona si el documento ya existe)',
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateGuardianDto,
    @Client() client: ClientInfo,
  ) {
    return this.guardians.create(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(P.GUARDIANS_MANAGE)
  @ApiOperation({ summary: 'Editar un acudiente' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateGuardianDto,
    @Client() client: ClientInfo,
  ) {
    return this.guardians.update(auth, id, body, client);
  }

  @Post(':id/access')
  @RequirePermissions(P.GUARDIANS_MANAGE, P.USERS_CREATE, P.USERS_ROLES_ASSIGN)
  @ApiOperation({ summary: 'Dar acceso al portal al acudiente (envía la activación)' })
  grantAccess(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: GrantAccessDto,
    @Client() client: ClientInfo,
  ) {
    return this.guardians.grantAccess(auth, id, body.email, client);
  }
}

@ApiTags('Personal')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions(P.STAFF_READ)
  @ApiOperation({ summary: 'Listar el personal (filtros por tipo y estado)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListStaffQueryDto) {
    return this.staff.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(P.STAFF_READ)
  @ApiOperation({ summary: 'Consultar un miembro del personal' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.staff.get(auth, id);
  }

  @Post()
  @RequirePermissions(P.STAFF_MANAGE)
  @ApiOperation({ summary: 'Registrar un miembro del personal' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateStaffDto,
    @Client() client: ClientInfo,
  ) {
    return this.staff.create(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(P.STAFF_MANAGE)
  @ApiOperation({ summary: 'Editar o desactivar un miembro del personal' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateStaffDto,
    @Client() client: ClientInfo,
  ) {
    return this.staff.update(auth, id, body, client);
  }

  @Post(':id/access')
  @RequirePermissions(P.STAFF_MANAGE, P.USERS_CREATE, P.USERS_ROLES_ASSIGN)
  @ApiOperation({ summary: 'Crear la cuenta de acceso del miembro del personal con sus roles' })
  grantAccess(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: GrantStaffAccessDto,
    @Client() client: ClientInfo,
  ) {
    return this.staff.grantAccess(auth, id, body.email, body.roleCodes, client);
  }
}

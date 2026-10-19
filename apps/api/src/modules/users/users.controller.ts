import { PERMISSIONS } from '@educore/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type Paginated } from '../../common/pagination/pagination';
import { Authenticated, RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import {
  CreateUserDto,
  ListUsersQueryDto,
  SetUserRolesDto,
  UpdateProfileDto,
  UpdateUserDto,
  UpdateUserStatusDto,
  UserDto,
  UserPageDto,
} from './dto/users.dto';
import { UsersService } from './users.service';

const uuid = new ParseUUIDPipe();

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Listar usuarios de la institución' })
  @ApiOkResponse({ type: UserPageDto })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListUsersQueryDto,
  ): Promise<Paginated<UserDto>> {
    return this.users.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Consultar un usuario' })
  @ApiOkResponse({ type: UserDto })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string): Promise<UserDto> {
    return this.users.get(auth, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_ROLES_ASSIGN)
  @ApiOperation({ summary: 'Crear un usuario (recibe un correo para activar su cuenta)' })
  @ApiCreatedResponse({ type: UserDto })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateUserDto,
    @Client() client: ClientInfo,
  ): Promise<UserDto> {
    return this.users.create(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ApiOperation({ summary: 'Editar los datos de un usuario' })
  @ApiOkResponse({ type: UserDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateUserDto,
    @Client() client: ClientInfo,
  ): Promise<UserDto> {
    return this.users.update(auth, id, body, client);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_STATUS)
  @ApiOperation({ summary: 'Suspender o reactivar un usuario (suspender cierra sus sesiones)' })
  @ApiOkResponse({ type: UserDto })
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateUserStatusDto,
    @Client() client: ClientInfo,
  ): Promise<UserDto> {
    return this.users.setStatus(auth, id, body.status, client);
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSIONS.USERS_ROLES_ASSIGN)
  @ApiOperation({ summary: 'Reemplazar los roles de un usuario' })
  @ApiOkResponse({ type: UserDto })
  setRoles(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: SetUserRolesDto,
    @Client() client: ClientInfo,
  ): Promise<UserDto> {
    return this.users.setRoles(auth, id, body.roleCodes, client);
  }

  @Post(':id/access-email')
  @RequirePermissions(PERMISSIONS.USERS_STATUS)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enviar el enlace de activación (cuenta invitada) o de recuperación (cuenta activa)',
  })
  @ApiAcceptedResponse()
  async sendAccessEmail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    const kind = await this.users.sendAccessEmail(auth, id, client);
    return { sent: kind };
  }
}

@ApiTags('Perfil')
@ApiBearerAuth()
@Controller('me/profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Consultar el perfil propio' })
  @ApiOkResponse({ type: UserDto })
  get(@CurrentAuth() auth: AuthContext): Promise<UserDto> {
    return this.users.getProfile(auth);
  }

  @Patch()
  @Authenticated()
  @ApiOperation({ summary: 'Editar el teléfono y la dirección propios' })
  @ApiOkResponse({ type: UserDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() body: UpdateProfileDto,
    @Client() client: ClientInfo,
  ): Promise<UserDto> {
    return this.users.updateProfile(auth, body, client);
  }
}

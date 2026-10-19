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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { RequirePermissions } from './authorization';
import { CreateRoleDto, PermissionDto, RoleDto, UpdateRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

const uuid = new ParseUUIDPipe();

@ApiTags('Roles y permisos')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Catálogo de permisos disponibles' })
  @ApiOkResponse({ type: [PermissionDto] })
  listPermissions(): PermissionDto[] {
    return this.roles.listPermissions();
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Listar los roles de la institución' })
  @ApiOkResponse({ type: [RoleDto] })
  list(@CurrentAuth() auth: AuthContext): Promise<RoleDto[]> {
    return this.roles.list(auth);
  }

  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Consultar un rol' })
  @ApiOkResponse({ type: RoleDto })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string): Promise<RoleDto> {
    return this.roles.get(auth, id);
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'Crear un rol personalizado' })
  @ApiCreatedResponse({ type: RoleDto })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateRoleDto,
    @Client() client: ClientInfo,
  ): Promise<RoleDto> {
    return this.roles.create(auth, body, client);
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'Editar un rol personalizado' })
  @ApiOkResponse({ type: RoleDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateRoleDto,
    @Client() client: ClientInfo,
  ): Promise<RoleDto> {
    return this.roles.update(auth, id, body, client);
  }

  @Delete('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un rol personalizado sin usuarios' })
  @ApiNoContentResponse()
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.roles.remove(auth, id, client);
  }
}

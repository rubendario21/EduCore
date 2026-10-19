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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { RequirePermissions } from '../access-control/authorization';
import { fileHeaders } from '../files/files.controller';
import { UPLOAD_RULES } from '../files/files.service';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth, Public } from '../auth/decorators/auth.decorators';
import {
  BrandingViewDto,
  CampusViewDto,
  CreateCampusDto,
  CreateShiftDto,
  InstitutionViewDto,
  ShiftViewDto,
  UpdateCampusDto,
  UpdateInstitutionDto,
  UpdateSettingsDto,
  UpdateShiftDto,
} from './dto/institution.dto';
import { InstitutionsService } from './institutions.service';

const uuid = new ParseUUIDPipe();

@ApiTags('Institución')
@ApiBearerAuth()
@Controller()
export class InstitutionsController {
  constructor(private readonly institutions: InstitutionsService) {}

  @Get('institution/branding')
  @Public()
  @ApiOperation({
    summary: 'Marca pública de la institución (para la pantalla de inicio de sesión)',
  })
  @ApiOkResponse({ type: BrandingViewDto })
  branding(): Promise<BrandingViewDto> {
    return this.institutions.branding();
  }

  @Get('institution/branding/logo')
  @Public()
  @ApiOperation({
    summary: 'Logo de la institución (público, para la pantalla de inicio de sesión)',
  })
  @ApiOkResponse({ description: 'Imagen PNG, JPEG o WebP' })
  async logo(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { file, stream } = await this.institutions.publicLogo();
    res.set(fileHeaders(file, { cache: 'public' }));
    return new StreamableFile(stream);
  }

  @Post('institution/logo')
  @RequirePermissions(PERMISSIONS.INSTITUTION_SETTINGS_UPDATE)
  @UseInterceptors(
    FileInterceptor('file', {
      // En memoria y con límites: un solo archivo y sin campos adicionales.
      limits: { fileSize: UPLOAD_RULES.institutionLogo.maxBytes, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Subir el logo (PNG, JPEG o WebP; máximo 2 MB)' })
  @ApiCreatedResponse({ type: InstitutionViewDto })
  uploadLogo(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Client() client: ClientInfo,
  ) {
    return this.institutions.uploadLogo(
      auth,
      file && { buffer: file.buffer, originalName: file.originalname },
      client,
    );
  }

  @Delete('institution/logo')
  @RequirePermissions(PERMISSIONS.INSTITUTION_SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Quitar el logo (el archivo se conserva por trazabilidad)' })
  @ApiOkResponse({ type: InstitutionViewDto })
  removeLogo(@CurrentAuth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.institutions.removeLogo(auth, client);
  }

  @Get('institution')
  @RequirePermissions(PERMISSIONS.INSTITUTION_READ)
  @ApiOperation({ summary: 'Datos y configuración de la institución' })
  @ApiOkResponse({ type: InstitutionViewDto })
  get(@CurrentAuth() auth: AuthContext): Promise<InstitutionViewDto> {
    return this.institutions.get(auth);
  }

  @Patch('institution')
  @RequirePermissions(PERMISSIONS.INSTITUTION_UPDATE)
  @ApiOperation({ summary: 'Editar los datos de la institución' })
  @ApiOkResponse({ type: InstitutionViewDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() body: UpdateInstitutionDto,
    @Client() client: ClientInfo,
  ) {
    return this.institutions.update(auth, body, client);
  }

  @Patch('institution/settings')
  @RequirePermissions(PERMISSIONS.INSTITUTION_SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Editar la configuración regional, la marca y las preferencias' })
  @ApiOkResponse({ type: InstitutionViewDto })
  updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Body() body: UpdateSettingsDto,
    @Client() client: ClientInfo,
  ) {
    return this.institutions.updateSettings(auth, body, client);
  }

  @Get('campuses')
  @RequirePermissions(PERMISSIONS.INSTITUTION_READ)
  @ApiOperation({ summary: 'Listar sedes' })
  @ApiOkResponse({ type: [CampusViewDto] })
  listCampuses(@CurrentAuth() auth: AuthContext): Promise<CampusViewDto[]> {
    return this.institutions.listCampuses(auth);
  }

  @Post('campuses')
  @RequirePermissions(PERMISSIONS.CAMPUSES_MANAGE)
  @ApiOperation({ summary: 'Crear una sede' })
  @ApiCreatedResponse({ type: CampusViewDto })
  createCampus(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateCampusDto,
    @Client() client: ClientInfo,
  ) {
    return this.institutions.createCampus(auth, body, client);
  }

  @Patch('campuses/:id')
  @RequirePermissions(PERMISSIONS.CAMPUSES_MANAGE)
  @ApiOperation({ summary: 'Editar, activar o desactivar una sede' })
  @ApiOkResponse({ type: CampusViewDto })
  updateCampus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateCampusDto,
    @Client() client: ClientInfo,
  ) {
    return this.institutions.updateCampus(auth, id, body, client);
  }

  @Get('shifts')
  @RequirePermissions(PERMISSIONS.INSTITUTION_READ)
  @ApiOperation({ summary: 'Listar jornadas' })
  @ApiOkResponse({ type: [ShiftViewDto] })
  listShifts(@CurrentAuth() auth: AuthContext): Promise<ShiftViewDto[]> {
    return this.institutions.listShifts(auth);
  }

  @Post('shifts')
  @RequirePermissions(PERMISSIONS.SHIFTS_MANAGE)
  @ApiOperation({ summary: 'Crear una jornada' })
  @ApiCreatedResponse({ type: ShiftViewDto })
  createShift(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateShiftDto,
    @Client() client: ClientInfo,
  ) {
    return this.institutions.createShift(auth, body, client);
  }

  @Patch('shifts/:id')
  @RequirePermissions(PERMISSIONS.SHIFTS_MANAGE)
  @ApiOperation({ summary: 'Editar, activar o desactivar una jornada' })
  @ApiOkResponse({ type: ShiftViewDto })
  updateShift(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateShiftDto,
    @Client() client: ClientInfo,
  ) {
    return this.institutions.updateShift(auth, id, body, client);
  }
}

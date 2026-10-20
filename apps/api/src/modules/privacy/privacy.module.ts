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
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { fileHeaders } from '../files/files.controller';
import { UPLOAD_RULES } from '../files/files.service';
import {
  CoverageQueryDto,
  CreateConsentDto,
  CreatePolicyDto,
  ListConsentsQueryDto,
  RevokeConsentDto,
  UpdatePolicyDto,
} from './privacy.dto';
import { PrivacyRepository } from './privacy.repository';
import { PrivacyService } from './privacy.service';

const uuid = new ParseUUIDPipe();
const P = PERMISSIONS;

@ApiTags('Protección de datos')
@ApiBearerAuth()
@Controller('data-policies')
export class DataPoliciesController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get()
  @RequirePermissions(P.PRIVACY_CONSENTS_READ)
  @ApiOperation({ summary: 'Versiones de la política de tratamiento de datos' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.privacy.listPolicies(auth);
  }

  @Get('current')
  @RequirePermissions(P.PRIVACY_CONSENTS_READ)
  @ApiOperation({ summary: 'Versión vigente (publicada y en vigor)' })
  current(@CurrentAuth() auth: AuthContext) {
    return this.privacy.currentPolicy(auth);
  }

  @Get(':id')
  @RequirePermissions(P.PRIVACY_CONSENTS_READ)
  @ApiOperation({ summary: 'Consultar una versión con sus finalidades' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.privacy.getPolicy(auth, id);
  }

  @Post()
  @RequirePermissions(P.PRIVACY_POLICIES_MANAGE)
  @ApiOperation({ summary: 'Crear una versión en borrador con sus finalidades' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreatePolicyDto,
    @Client() client: ClientInfo,
  ) {
    return this.privacy.createPolicy(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(P.PRIVACY_POLICIES_MANAGE)
  @ApiOperation({ summary: 'Editar un borrador (una versión publicada no cambia)' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdatePolicyDto,
    @Client() client: ClientInfo,
  ) {
    return this.privacy.updatePolicy(auth, id, body, client);
  }

  @Post(':id/publish')
  @RequirePermissions(P.PRIVACY_POLICIES_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publicar la versión (queda fija)' })
  publish(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Client() client: ClientInfo,
  ) {
    return this.privacy.publishPolicy(auth, id, client);
  }
}

@ApiTags('Protección de datos')
@ApiBearerAuth()
@Controller('data-consents')
export class DataConsentsController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get()
  @RequirePermissions(P.PRIVACY_CONSENTS_READ)
  @ApiOperation({ summary: 'Listar autorizaciones (por estudiante, versión o estado)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListConsentsQueryDto) {
    return this.privacy.listConsents(auth, query);
  }

  @Get('coverage')
  @RequirePermissions(P.PRIVACY_CONSENTS_READ)
  @ApiOperation({ summary: 'Estudiantes activos con y sin autorización vigente' })
  coverage(@CurrentAuth() auth: AuthContext, @Query() query: CoverageQueryDto) {
    return this.privacy.coverage(auth, query);
  }

  @Get(':id')
  @RequirePermissions(P.PRIVACY_CONSENTS_READ)
  @ApiOperation({ summary: 'Consultar una autorización con sus decisiones' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.privacy.getConsent(auth, id);
  }

  @Post()
  @RequirePermissions(P.PRIVACY_CONSENTS_MANAGE)
  @ApiOperation({ summary: 'Registrar una autorización de tratamiento de datos' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateConsentDto,
    @Client() client: ClientInfo,
  ) {
    return this.privacy.createConsent(auth, body, client);
  }

  @Post(':id/revoke')
  @RequirePermissions(P.PRIVACY_CONSENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revocar la autorización (queda el registro)' })
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: RevokeConsentDto,
    @Client() client: ClientInfo,
  ) {
    return this.privacy.revokeConsent(auth, id, body, client);
  }

  @Post(':id/evidence')
  @RequirePermissions(P.PRIVACY_CONSENTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_RULES.consentEvidence.maxBytes, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Adjuntar el soporte (PDF, PNG o JPEG; máximo 5 MB)' })
  attachEvidence(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Client() client: ClientInfo,
  ) {
    return this.privacy.attachEvidence(
      auth,
      id,
      file && { buffer: file.buffer, originalName: file.originalname },
      client,
    );
  }

  @Get(':id/evidence')
  @RequirePermissions(P.PRIVACY_CONSENTS_READ)
  @ApiOperation({ summary: 'Descargar el soporte de la autorización' })
  async evidence(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.privacy.evidenceFile(auth, id);
    res.set(fileHeaders(file, { cache: 'private' }));
    return new StreamableFile(stream);
  }
}

@Module({
  controllers: [DataPoliciesController, DataConsentsController],
  providers: [PrivacyRepository, PrivacyService],
})
export class PrivacyModule {}

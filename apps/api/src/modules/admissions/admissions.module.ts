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
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { fileHeaders } from '../files/files.controller';
import { UPLOAD_RULES } from '../files/files.service';
import { PeopleModule } from '../people/people.module';
import {
  ADMISSION_DOCUMENT_TYPES,
  CreateAdmissionDto,
  EnrollAdmittedDto,
  ListAdmissionsQueryDto,
  RejectDto,
  TransitionDto,
  UpdateAdmissionDto,
  UploadAdmissionDocumentDto,
} from './admissions.dto';
import { AdmissionsRepository } from './admissions.repository';
import { type AdmissionTransition, AdmissionsService } from './admissions.service';

const uuid = new ParseUUIDPipe();
const P = PERMISSIONS;

@ApiTags('Admisiones')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequirePermissions(P.ADMISSIONS_READ)
  @ApiOperation({ summary: 'Listar solicitudes (filtros por año, grado, estado y aspirante)' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListAdmissionsQueryDto) {
    return this.admissions.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(P.ADMISSIONS_READ)
  @ApiOperation({ summary: 'Consultar una solicitud con sus documentos e historial' })
  get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.admissions.get(auth, id);
  }

  @Post()
  @RequirePermissions(P.ADMISSIONS_MANAGE)
  @ApiOperation({ summary: 'Registrar una solicitud (queda en borrador)' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateAdmissionDto,
    @Client() client: ClientInfo,
  ) {
    return this.admissions.create(auth, body, client);
  }

  @Patch(':id')
  @RequirePermissions(P.ADMISSIONS_MANAGE)
  @ApiOperation({ summary: 'Editar una solicitud que no ha finalizado' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UpdateAdmissionDto,
    @Client() client: ClientInfo,
  ) {
    return this.admissions.update(auth, id, body, client);
  }

  // --- Transiciones ----------------------------------------------------------

  private move(
    auth: AuthContext,
    id: string,
    action: AdmissionTransition,
    body: TransitionDto,
    client: ClientInfo,
  ) {
    return this.admissions.transition(auth, id, action, body.note, client);
  }

  @Post(':id/submit')
  @RequirePermissions(P.ADMISSIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar la solicitud (borrador → enviada)' })
  submit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TransitionDto,
    @Client() client: ClientInfo,
  ) {
    return this.move(auth, id, 'submit', body, client);
  }

  @Post(':id/review')
  @RequirePermissions(P.ADMISSIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar la revisión (enviada → en revisión)' })
  review(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TransitionDto,
    @Client() client: ClientInfo,
  ) {
    return this.move(auth, id, 'review', body, client);
  }

  @Post(':id/waitlist')
  @RequirePermissions(P.ADMISSIONS_DECIDE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dejar en lista de espera' })
  waitlist(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TransitionDto,
    @Client() client: ClientInfo,
  ) {
    return this.move(auth, id, 'waitlist', body, client);
  }

  @Post(':id/approve')
  @RequirePermissions(P.ADMISSIONS_DECIDE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar la admisión' })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TransitionDto,
    @Client() client: ClientInfo,
  ) {
    return this.move(auth, id, 'approve', body, client);
  }

  @Post(':id/reject')
  @RequirePermissions(P.ADMISSIONS_DECIDE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar la admisión (con motivo)' })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: RejectDto,
    @Client() client: ClientInfo,
  ) {
    return this.move(auth, id, 'reject', body, client);
  }

  @Post(':id/withdraw')
  @RequirePermissions(P.ADMISSIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar que la familia desistió' })
  withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: TransitionDto,
    @Client() client: ClientInfo,
  ) {
    return this.move(auth, id, 'withdraw', body, client);
  }

  @Post(':id/enroll')
  // Matricular crea estudiante, acudiente y matrícula: exige todos esos permisos.
  @RequirePermissions(
    P.ADMISSIONS_MANAGE,
    P.STUDENTS_MANAGE,
    P.GUARDIANS_MANAGE,
    P.ENROLLMENTS_MANAGE,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Matricular al admitido (aprobada → matriculada)' })
  enroll(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: EnrollAdmittedDto,
    @Client() client: ClientInfo,
  ) {
    return this.admissions.enroll(auth, id, body, client);
  }

  // --- Documentos ------------------------------------------------------------

  @Post(':id/documents')
  @RequirePermissions(P.ADMISSIONS_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      // En memoria y con límites: un archivo y un solo campo (el tipo de documento).
      limits: { fileSize: UPLOAD_RULES.admissionDocument.maxBytes, files: 1, fields: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        documentType: { type: 'string', enum: [...ADMISSION_DOCUMENT_TYPES] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Adjuntar un documento (PDF, PNG o JPEG; máximo 5 MB)' })
  addDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: UploadAdmissionDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Client() client: ClientInfo,
  ) {
    return this.admissions.addDocument(
      auth,
      id,
      body.documentType,
      file && { buffer: file.buffer, originalName: file.originalname },
      client,
    );
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions(P.ADMISSIONS_MANAGE)
  @ApiOperation({ summary: 'Retirar un documento (el archivo se conserva)' })
  removeDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('documentId', uuid) documentId: string,
    @Client() client: ClientInfo,
  ) {
    return this.admissions.removeDocument(auth, id, documentId, client);
  }

  @Get(':id/documents/:documentId/file')
  @RequirePermissions(P.ADMISSIONS_READ)
  @ApiOperation({ summary: 'Descargar un documento de la solicitud' })
  async downloadDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('documentId', uuid) documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.admissions.documentFile(auth, id, documentId);
    res.set(fileHeaders(file, { cache: 'private' }));
    return new StreamableFile(stream);
  }
}

@Module({
  imports: [PeopleModule, EnrollmentsModule],
  controllers: [AdmissionsController],
  providers: [AdmissionsRepository, AdmissionsService],
})
export class AdmissionsModule {}

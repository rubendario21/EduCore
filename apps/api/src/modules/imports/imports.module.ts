import { PERMISSIONS } from '@educore/shared';
import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Module,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/authorization';
import { type AuthContext, type ClientInfo } from '../auth/auth.types';
import { Client, CurrentAuth } from '../auth/decorators/auth.decorators';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { FileErrors, sanitizeFileName } from '../files/files.service';
import { PeopleModule } from '../people/people.module';
import { StudentImportService } from './student-import.service';
import { MAX_IMPORT_BYTES } from './tabular-file';

const P = PERMISSIONS;

/** Un archivo en memoria, con límite de tamaño y sin campos adicionales. */
const uploadInterceptor = FileInterceptor('file', {
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 0 },
});

const uploadBody = {
  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
} as const;

function requireFile(file: Express.Multer.File | undefined) {
  if (!file) throw FileErrors.missing();
  return { buffer: file.buffer, name: sanitizeFileName(file.originalname) };
}

@ApiTags('Importación masiva')
@ApiBearerAuth()
@Controller('imports/students')
// Importar crea estudiantes, acudientes y matrículas: exige gestionar los tres.
@RequirePermissions(P.STUDENTS_MANAGE, P.GUARDIANS_MANAGE, P.ENROLLMENTS_MANAGE)
export class StudentImportController {
  constructor(private readonly imports: StudentImportService) {}

  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="plantilla-estudiantes.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Descargar la plantilla CSV (separada por punto y coma)' })
  template() {
    return this.imports.template();
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody(uploadBody)
  @ApiOperation({
    summary: 'Validar un archivo (CSV o XLSX) y obtener el informe por fila, sin guardar nada',
  })
  validate(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const { buffer, name } = requireFile(file);
    return this.imports.validate(auth, buffer, name);
  }

  @Post()
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody(uploadBody)
  @ApiOperation({
    summary: 'Importar el archivo: solo si no tiene errores, y todo o nada en una transacción',
  })
  import(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Client() client: ClientInfo,
  ) {
    const { buffer, name } = requireFile(file);
    return this.imports.import(auth, buffer, name, client);
  }
}

@Module({
  imports: [PeopleModule, EnrollmentsModule],
  controllers: [StudentImportController],
  providers: [StudentImportService],
})
export class ImportsModule {}

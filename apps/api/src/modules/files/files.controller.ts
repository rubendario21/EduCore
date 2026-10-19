import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { type StoredFile } from '../../generated/prisma/client';
import { EXTENSIONS, type DetectedType } from '../../infrastructure/storage/file-inspection';
import { Authenticated } from '../access-control/authorization';
import { type AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/auth.decorators';
import { FilesService } from './files.service';

/** Cabeceras seguras para servir un archivo almacenado. */
export function fileHeaders(
  file: StoredFile,
  options: { cache: 'private' | 'public' },
): Record<string, string> {
  const inline = file.mimeType.startsWith('image/');
  const extension = EXTENSIONS[file.mimeType as DetectedType] ?? 'bin';
  const name = encodeURIComponent(file.originalName.replace(/\.[^.]+$/, '') || 'archivo');
  return {
    'Content-Type': file.mimeType,
    'Content-Length': String(file.sizeBytes),
    // Nunca se interpreta como otro tipo (evita XSS con archivos manipulados).
    'X-Content-Type-Options': 'nosniff',
    // Ni scripts ni recursos externos aunque el navegador lo abra directamente.
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}.${extension}`,
    'Cache-Control': options.cache === 'public' ? 'public, max-age=86400' : 'private, no-store',
    ETag: `"${file.sha256}"`,
  };
}

@ApiTags('Archivos')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get(':id')
  @Authenticated()
  @ApiOperation({ summary: 'Descargar un archivo (el acceso depende de su clasificación)' })
  @ApiOkResponse({ description: 'Contenido del archivo' })
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.files.findDownloadable(auth, id);
    const stream = await this.files.open(file);
    res.set(fileHeaders(file, { cache: 'private' }));
    return new StreamableFile(stream);
  }
}

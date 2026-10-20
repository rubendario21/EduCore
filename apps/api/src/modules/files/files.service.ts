import { createHash, randomUUID } from 'node:crypto';
import { type Readable } from 'node:stream';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import {
  type FileClassification,
  type Prisma,
  type StoredFile,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { detectFileType, type DetectedType } from '../../infrastructure/storage/file-inspection';
import { STORAGE_DRIVER, type StorageDriver } from '../../infrastructure/storage/storage.driver';
import { type AuthContext } from '../auth/auth.types';

export const FileErrors = {
  empty: () => new AppException(HttpStatus.BAD_REQUEST, 'FILE_EMPTY', 'El archivo está vacío.'),
  missing: () => new AppException(HttpStatus.BAD_REQUEST, 'FILE_REQUIRED', 'Adjunta un archivo.'),
  tooLarge: (maxBytes: number) =>
    new AppException(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'FILE_TOO_LARGE',
      `El archivo supera el tamaño máximo permitido (${Math.round(maxBytes / 1024)} KB).`,
      { maxBytes },
    ),
  typeNotAllowed: (allowed: readonly DetectedType[]) =>
    new AppException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'FILE_TYPE_NOT_ALLOWED',
      'El tipo de archivo no está permitido. Revisa que el contenido corresponda al formato.',
      { allowed },
    ),
  notFound: () => new AppException(HttpStatus.NOT_FOUND, 'FILE_NOT_FOUND', 'El archivo no existe.'),
};

export interface UploadRule {
  allowedTypes: readonly DetectedType[];
  maxBytes: number;
  classification: FileClassification;
}

/** Reglas por uso. Cada módulo define las suyas (logo, documentos, soportes…). */
export const UPLOAD_RULES = {
  institutionLogo: {
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytes: 2 * 1024 * 1024,
    classification: 'INSTITUTIONAL',
  },
  admissionDocument: {
    allowedTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxBytes: 5 * 1024 * 1024,
    classification: 'PERSONAL',
  },
  consentEvidence: {
    allowedTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxBytes: 5 * 1024 * 1024,
    classification: 'PERSONAL',
  },
} as const satisfies Record<string, UploadRule>;

export interface IncomingFile {
  buffer: Buffer;
  originalName: string;
}

/** Nombre original seguro para guardar como dato: sin rutas ni caracteres de control. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'archivo';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return (clean || 'archivo').slice(0, 255);
}

/**
 * Archivos privados: valida, guarda el contenido en el almacenamiento y los
 * metadatos en la base. El contenido se escribe antes que el registro; si la
 * transacción falla queda un archivo huérfano inofensivo (nunca un registro
 * que apunte a un contenido inexistente).
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async store(
    params: {
      institutionId: string;
      actorUserId: string | null;
      file: IncomingFile | undefined;
      rule: UploadRule;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<StoredFile> {
    const { file, rule } = params;
    if (!file) throw FileErrors.missing();
    if (file.buffer.length === 0) throw FileErrors.empty();
    if (file.buffer.length > rule.maxBytes) throw FileErrors.tooLarge(rule.maxBytes);

    const detected = detectFileType(file.buffer);
    if (!detected || !rule.allowedTypes.includes(detected))
      throw FileErrors.typeNotAllowed(rule.allowedTypes);

    const now = new Date();
    const key = [
      'institutions',
      params.institutionId,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      randomUUID(),
    ].join('/');
    await this.storage.put(key, file.buffer, detected);

    return tx.storedFile.create({
      data: {
        institutionId: params.institutionId,
        storageDriver: this.storage.name,
        storageKey: key,
        originalName: sanitizeFileName(file.originalName),
        mimeType: detected,
        sizeBytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        classification: rule.classification,
        uploadedByUserId: params.actorUserId,
      },
    });
  }

  async open(file: StoredFile): Promise<Readable> {
    try {
      return await this.storage.read(file.storageKey);
    } catch {
      throw FileErrors.notFound();
    }
  }

  /**
   * Archivo de la institución, sin reglas de acceso propias: lo usa un módulo
   * que ya verificó el permiso sobre el registro dueño del archivo.
   */
  async findOwned(institutionId: string, id: string): Promise<StoredFile> {
    const file = await this.prisma.storedFile.findFirst({ where: { id, institutionId } });
    if (!file) throw FileErrors.notFound();
    return file;
  }

  /**
   * Archivo de la institución del usuario que este puede descargar.
   * - INSTITUTIONAL: cualquier miembro de la institución.
   * - PERSONAL / SENSITIVE: por ahora solo quien lo subió; cada módulo que los
   *   use (matrículas, excusas) definirá sus reglas de acceso por alcance.
   * Un archivo ajeno o no autorizado responde 404 (no revela que existe).
   */
  async findDownloadable(auth: AuthContext, id: string): Promise<StoredFile> {
    const file = await this.prisma.storedFile.findFirst({
      where: { id, institutionId: auth.institutionId },
    });
    if (!file) throw FileErrors.notFound();
    if (file.classification !== 'INSTITUTIONAL' && file.uploadedByUserId !== auth.userId) {
      throw FileErrors.notFound();
    }
    return file;
  }
}

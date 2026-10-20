import { HttpStatus } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import { readSheet } from 'read-excel-file/node';
import { AppException } from '../../common/errors/app.exception';

/** Tamaño máximo del archivo subido. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
/** Filas de datos admitidas por archivo (sin contar el encabezado). */
export const MAX_IMPORT_ROWS = 1000;
/**
 * Tamaño máximo del contenido descomprimido de un XLSX. Un XLSX es un ZIP:
 * se revisa antes de leerlo para rechazar archivos que se expanden de forma
 * desproporcionada (bombas ZIP).
 */
export const MAX_XLSX_EXPANDED_BYTES = 40 * 1024 * 1024;

export const TabularErrors = {
  empty: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'FILE_EMPTY',
      'El archivo está vacío o no tiene filas.',
    ),
  unsupported: () =>
    new AppException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'FILE_TYPE_NOT_ALLOWED',
      'El archivo debe ser CSV (separado por punto y coma o coma) o Excel (.xlsx).',
    ),
  unreadable: (detail: string) =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'FILE_UNREADABLE',
      `No se pudo leer el archivo: ${detail}`,
    ),
  tooManyRows: (rows: number) =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'TOO_MANY_ROWS',
      `El archivo tiene ${rows} filas; el máximo por importación es ${MAX_IMPORT_ROWS}. Divídelo en varios archivos.`,
      { rows, max: MAX_IMPORT_ROWS },
    ),
};

export interface TabularData {
  format: 'CSV' | 'XLSX';
  headers: string[];
  /** Filas de datos con su número en la hoja (el encabezado es la fila 1). */
  rows: Array<{ number: number; cells: string[] }>;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function isZip(buffer: Buffer): boolean {
  return ZIP_SIGNATURE.every((byte, i) => buffer[i] === byte);
}

/**
 * Suma los tamaños descomprimidos declarados en el directorio central del ZIP.
 * Lanza un error si el archivo no es un ZIP válido o se expande demasiado.
 */
export function checkZipExpansion(buffer: Buffer, maxBytes = MAX_XLSX_EXPANDED_BYTES): void {
  // Registro "fin del directorio central": firma 0x06054b50, al final del archivo
  // (seguido de un comentario de hasta 65 535 bytes).
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw TabularErrors.unreadable('el archivo Excel está dañado.');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw TabularErrors.unreadable('el archivo Excel está dañado.');
    }
    total += buffer.readUInt32LE(offset + 24);
    if (total > maxBytes) {
      throw TabularErrors.unreadable('el contenido del archivo Excel es demasiado grande.');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

/** Texto del CSV: UTF-8 (con o sin BOM) o, si no lo es, Windows-1252 (Excel en español). */
function decodeText(buffer: Buffer): string {
  if (buffer.includes(0)) throw TabularErrors.unsupported();
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Separador del CSV según la primera línea: punto y coma (Excel en español) o coma. */
function detectDelimiter(text: string): ';' | ',' {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = (char: string) => firstLine.split(char).length - 1;
  return count(';') >= count(',') ? ';' : ',';
}

/** Valor de una celda de Excel como texto (fechas en AAAA-MM-DD). */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'SI' : 'NO';
  return String(value).trim();
}

function finish(format: TabularData['format'], table: string[][]): TabularData {
  const numbered = table.map((cells, index) => ({ number: index + 1, cells }));
  const [header, ...data] = numbered;
  if (!header) throw TabularErrors.empty();
  const rows = data.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (rows.length === 0) throw TabularErrors.empty();
  if (rows.length > MAX_IMPORT_ROWS) throw TabularErrors.tooManyRows(rows.length);
  return {
    format,
    headers: header.cells.map((h) => h.trim()),
    rows: rows.map((r) => ({ number: r.number, cells: r.cells.map((c) => c.trim()) })),
  };
}

/** Lee un CSV o la primera hoja de un XLSX como tabla de textos. */
export async function readTabularFile(buffer: Buffer): Promise<TabularData> {
  if (buffer.length === 0) throw TabularErrors.empty();

  if (isZip(buffer)) {
    checkZipExpansion(buffer);
    let sheet: unknown[][];
    try {
      sheet = (await readSheet(buffer)) as unknown[][];
    } catch {
      throw TabularErrors.unreadable('no es un archivo Excel (.xlsx) válido.');
    }
    return finish(
      'XLSX',
      sheet.map((row) => row.map(cellText)),
    );
  }

  const text = decodeText(buffer).replace(/^\uFEFF/, '');
  let table: string[][];
  try {
    table = parseCsv(text, {
      delimiter: detectDelimiter(text),
      relax_column_count: true,
      bom: true,
    }) as string[][];
  } catch (error) {
    throw TabularErrors.unreadable(
      `el CSV tiene un error de formato${(error as { lines?: number }).lines ? ` cerca de la línea ${(error as { lines: number }).lines}` : ''}.`,
    );
  }
  return finish('CSV', table);
}

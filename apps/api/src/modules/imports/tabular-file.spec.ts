import { describe, expect, it } from 'vitest';
import { xlsx, zip } from '../../../test/setup/xlsx';
import { MAX_IMPORT_ROWS, readTabularFile } from './tabular-file';

describe('Importación: lectura de CSV y XLSX', () => {
  it('lee CSV separado por punto y coma con BOM, comillas y filas vacías', async () => {
    const csv = '\uFEFFnombres;apellidos\r\n"López; Ana";Ruiz\r\n;\r\n\r\nBruno;"Pérez ""B"""\r\n';
    const data = await readTabularFile(Buffer.from(csv, 'utf8'));
    expect(data.format).toBe('CSV');
    expect(data.headers).toEqual(['nombres', 'apellidos']);
    // Las filas vacías se omiten pero los números de fila se conservan.
    expect(data.rows).toEqual([
      { number: 2, cells: ['López; Ana', 'Ruiz'] },
      { number: 5, cells: ['Bruno', 'Pérez "B"'] },
    ]);
  });

  it('lee CSV separado por comas y guardado en Windows-1252 (Excel en español)', async () => {
    const latin1 = Buffer.from('nombres,apellidos\r\nSofía,Núñez\r\n', 'latin1');
    const data = await readTabularFile(latin1);
    expect(data.rows[0]!.cells).toEqual(['Sofía', 'Núñez']);
  });

  it('lee la primera hoja de un XLSX, con números como texto', async () => {
    const book = xlsx([
      ['numero_documento', 'nombres'],
      [1012345678, 'Sofía'],
    ]);
    const data = await readTabularFile(book);
    expect(data.format).toBe('XLSX');
    expect(data.rows).toEqual([{ number: 2, cells: ['1012345678', 'Sofía'] }]);
  });

  it('rechaza archivos vacíos, binarios, dañados, enormes o con demasiadas filas', async () => {
    await expect(readTabularFile(Buffer.alloc(0))).rejects.toMatchObject({ code: 'FILE_EMPTY' });
    await expect(readTabularFile(Buffer.from('nombres\r\n'))).rejects.toMatchObject({
      code: 'FILE_EMPTY',
    });
    await expect(readTabularFile(Buffer.from([0x00, 0x01, 0x02]))).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
    });
    await expect(
      readTabularFile(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)])),
    ).rejects.toMatchObject({ code: 'FILE_UNREADABLE' });

    // "Bomba ZIP": 60 MB de ceros que comprimidos ocupan unos pocos KB.
    const bomb = zip({ 'xl/worksheets/sheet1.xml': Buffer.alloc(60 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200 * 1024);
    await expect(readTabularFile(bomb)).rejects.toMatchObject({ code: 'FILE_UNREADABLE' });

    const many = `nombres\r\n${'Ana\r\n'.repeat(MAX_IMPORT_ROWS + 1)}`;
    await expect(readTabularFile(Buffer.from(many))).rejects.toMatchObject({
      code: 'TOO_MANY_ROWS',
    });
  });
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { type ImportReport } from '../imports.service';
import { ImportStudentsPage } from './import-students-page';

const report = (invalid: number): ImportReport => ({
  fileName: 'estudiantes.csv',
  format: 'CSV',
  sha256: 'x',
  totals: {
    rows: 2,
    valid: 2 - invalid,
    invalid,
    newPersons: 2 - invalid,
    reusedPersons: 0,
    guardians: 1,
    enrollments: 1,
  },
  ignoredColumns: invalid ? ['Color favorito'] : [],
  rows: [
    {
      row: 2,
      status: 'VALID',
      student: 'Sofía Martínez (TI 1)',
      errors: [],
      actions: ['Crear estudiante'],
    },
    invalid
      ? {
          row: 3,
          status: 'INVALID',
          student: '—',
          errors: [{ column: 'tipo_documento', message: 'Tipo de documento no válido.' }],
          actions: [],
        }
      : {
          row: 3,
          status: 'VALID',
          student: 'Tomás Martínez (TI 2)',
          errors: [],
          actions: ['Crear estudiante'],
        },
  ],
});

function renderPage() {
  return renderWithProviders(
    <MemoryRouter>
      <ImportStudentsPage />
    </MemoryRouter>,
  );
}

const file = new File(['tipo_documento;numero_documento\r\n'], 'estudiantes.csv', {
  type: 'text/csv',
});

describe('ImportStudentsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('con errores muestra el informe por fila y no permite importar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report(1)));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await userEvent.setup().upload(screen.getByLabelText('Archivo de estudiantes'), file);

    expect(await screen.findByText(/Tipo de documento no válido/)).toHaveTextContent(
      'tipo_documento',
    );
    expect(screen.getByText(/Columnas que no se reconocen/)).toHaveTextContent('Color favorito');
    expect(screen.getByRole('button', { name: /Importar 1 estudiante/ })).toBeDisabled();
    // Validar no guarda nada: solo se llamó al endpoint de validación.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/imports/students/validate');
  });

  it('sin errores permite importar y muestra el resultado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(report(0)))
      .mockResolvedValueOnce(jsonResponse({ imported: true, report: report(0) }, 201));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText('Archivo de estudiantes'), file);
    const button = await screen.findByRole('button', { name: /Importar 2 estudiante/ });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(await screen.findByText('Importación completada')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/\/imports\/students$/);
  });
});

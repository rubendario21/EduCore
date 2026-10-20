import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { GradingSchemeCard } from './grading-scheme-card';

const notDefined = () =>
  jsonResponse(
    {
      error: {
        code: 'GRADING_SCHEME_NOT_DEFINED',
        message: 'El año lectivo aún no tiene SIEE configurado.',
      },
    },
    404,
  );

describe('GradingSchemeCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('propone el ejemplo editable, valida al vuelo y guarda solo una escala coherente', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/academic-years')) return jsonResponse([]);
      if (init?.method === 'PUT')
        return jsonResponse({
          ...JSON.parse(String(init.body)),
          id: 's1',
          academicYear: {},
          updatedAt: '',
        });
      return notDefined();
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<GradingSchemeCard yearId="y1" editable />);
    const user = userEvent.setup();

    expect(await screen.findByText(/Precargamos como ejemplo/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Guardar SIEE' });
    expect(save).toBeEnabled();

    // Un hueco entre Bajo (hasta 2,9) y Básico (desde 3,1) bloquea el guardado y se explica.
    const from = screen.getAllByLabelText('Desde');
    await user.clear(from[1]!);
    await user.type(from[1]!, '3,1');
    expect(
      screen.getByText(/Hay un hueco entre "Desempeño Bajo" y "Desempeño Básico"/),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.clear(from[1]!);
    await user.type(from[1]!, '3');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ minScore: 1, maxScore: 5, decimals: 1, passingScore: 3 });
    expect(
      body.levels.map((l: { code: string; minScore: number }) => [l.code, l.minScore]),
    ).toEqual([
      ['BAJO', 1],
      ['BASICO', 3],
      ['ALTO', 4],
      ['SUPERIOR', 4.6],
    ]);
  });

  it('sin permiso solo informa que no hay SIEE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/academic-years') ? jsonResponse([]) : notDefined(),
      ),
    );
    renderWithProviders(<GradingSchemeCard yearId="y1" editable={false} />);
    expect(await screen.findByText('Este año aún no tiene SIEE configurado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar SIEE' })).not.toBeInTheDocument();
  });
});

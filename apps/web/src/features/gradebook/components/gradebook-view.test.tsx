import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { type Gradebook } from '../gradebook.service';
import { GradebookView } from './gradebook-view';

const year = {
  id: 'y1',
  year: 2027,
  name: 'Año 2027',
  startsOn: '2027-01-25',
  endsOn: '2027-11-30',
  status: 'ACTIVE',
  totalWeightPercent: 100,
  periods: [
    {
      id: 'p1',
      academicYearId: 'y1',
      number: 1,
      name: 'Primer período',
      startsOn: '2027-01-25',
      endsOn: '2027-11-30',
      weightPercent: 100,
      status: 'OPEN',
    },
  ],
};

const book: Gradebook = {
  group: { id: 'g1', code: '601', name: 'Sexto A' },
  subject: { id: 's1', code: 'MAT', name: 'Matemáticas' },
  period: { id: 'p1', number: 1, name: 'Primer período', status: 'OPEN' },
  scheme: {
    minScore: 1,
    maxScore: 5,
    decimals: 1,
    passingScore: 3,
    rounding: 'HALF_UP',
    levels: [],
    components: [
      { id: 'c1', code: 'COG', name: 'Cognitivo', weightPercent: 60 },
      { id: 'c2', code: 'PRO', name: 'Procedimental', weightPercent: 40 },
    ],
  },
  assessments: [
    { id: 'a1', componentId: 'c1', title: 'Quiz', description: null, dueOn: null, gradedCount: 1 },
    {
      id: 'a2',
      componentId: 'c2',
      title: 'Proyecto',
      description: null,
      dueOn: null,
      gradedCount: 0,
    },
  ],
  students: [
    {
      enrollmentId: 'e1',
      studentId: 'st1',
      code: null,
      firstNames: 'Ana',
      lastNames: 'López',
      documentType: 'TI',
      documentNumber: '1',
      inGroup: true,
      grades: { a1: 4, a2: null },
      comments: {},
      componentAverages: { c1: 4, c2: null },
      periodScore: 4,
      level: { code: 'ALTO', name: 'Alto' },
      passing: true,
    },
  ],
  canEdit: true,
};

describe('GradebookView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marca las notas fuera de escala y guarda los cambios agrupados por actividad', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return jsonResponse({ changed: 1 });
      if (url.includes('/gradebook')) return jsonResponse(book);
      return jsonResponse(year);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<GradebookView schoolGroupId="g1" subjectId="s1" academicYearId="y1" />);
    const user = userEvent.setup();

    const project = await screen.findByLabelText('Nota de Ana en Proyecto');
    expect(screen.getByText('Alto')).toBeInTheDocument();

    await user.type(project, '5,5');
    expect(screen.getByText(/fuera de la escala/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar notas' })).toBeDisabled();

    await user.clear(project);
    await user.type(project, '4,5');
    await user.type(screen.getByLabelText('Motivo del cambio'), 'Entrega tardía');
    await user.click(screen.getByRole('button', { name: 'Guardar notas' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(String(url)).toContain('/assessments/a2/grades');
    expect(JSON.parse(String(init!.body))).toEqual({
      grades: [{ enrollmentId: 'e1', score: 4.5 }],
      reason: 'Entrega tardía',
    });
  });

  it('en un período no abierto o sin permiso la planilla es de solo lectura', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/gradebook')
          ? jsonResponse({ ...book, canEdit: false, period: { ...book.period, status: 'CLOSED' } })
          : jsonResponse(year),
      ),
    );
    renderWithProviders(<GradebookView schoolGroupId="g1" subjectId="s1" academicYearId="y1" />);
    expect(await screen.findByText(/la planilla es de solo lectura/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nota de Ana en Proyecto')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nueva actividad/ })).not.toBeInTheDocument();
  });
});

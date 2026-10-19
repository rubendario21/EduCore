import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { SystemStatusCard } from './system-status-card';

describe('SystemStatusCard', () => {
  it('muestra API y base de datos disponibles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: 'ok',
          checks: { database: { status: 'up', latencyMs: 3 } },
          timestamp: '2026-10-18T22:00:00.000Z',
        }),
      ),
    );

    renderWithProviders(<SystemStatusCard />);

    expect(await screen.findByText('Disponible · 3 ms')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distingue la base de datos caída cuando la API responde 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'La base de datos no está disponible.',
              requestId: 'req-1',
            },
          },
          503,
        ),
      ),
    );

    renderWithProviders(<SystemStatusCard />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La base de datos no está disponible.',
    );
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('No disponible')).toBeInTheDocument();
  });

  it('informa cuando la API no responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderWithProviders(<SystemStatusCard />);

    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No fue posible conectar con el servidor');
  });
});

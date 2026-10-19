import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/render';
import { ApiError, apiClient, INVALID_RESPONSE, NETWORK_ERROR } from './api-client';

describe('apiClient', () => {
  it('llama a la ruta bajo /api/v1 con credenciales y devuelve el JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.get('/health')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('serializa el cuerpo como JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.post('/recurso', { nombre: 'Prueba' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"nombre":"Prueba"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('convierte el formato de error de la API en ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Los datos enviados no son válidos.',
              details: [{ field: 'email', messages: ['inválido'] }],
              requestId: 'req-1',
            },
          },
          400,
        ),
      ),
    );

    const error = await apiClient.get('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos.',
      requestId: 'req-1',
    });
  });

  it('distingue un fallo de red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiClient.get('/x')).rejects.toMatchObject({ status: 0, code: NETWORK_ERROR });
  });

  it('distingue una respuesta que no viene de la API (p. ej. 502 del proxy)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));
    await expect(apiClient.get('/x')).rejects.toMatchObject({
      status: 502,
      code: INVALID_RESPONSE,
    });
  });

  it('devuelve undefined en 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiClient.delete('/x')).resolves.toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/render';
import { apiClient, setAccessToken, setRefreshHandler } from './api-client';

const expired = () =>
  jsonResponse(
    { error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Tu sesión debe renovarse.' } },
    401,
  );

afterEach(() => {
  setAccessToken(null);
  setRefreshHandler(null);
});

describe('apiClient · sesión', () => {
  it('adjunta el token de acceso, salvo en peticiones anónimas', async () => {
    // Una respuesta nueva por llamada: el cuerpo de un Response solo se lee una vez.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('token-1');

    await apiClient.get('/privado');
    await apiClient.post('/auth/login', {}, { anonymous: true });

    const headersOf = (call: number) =>
      (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headersOf(0).Authorization).toBe('Bearer token-1');
    expect(headersOf(1).Authorization).toBeUndefined();
  });

  it('renueva la sesión una vez y reintenta cuando el token venció', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('viejo');
    const refresh = vi.fn(async () => {
      setAccessToken('nuevo');
      return 'nuevo';
    });
    setRefreshHandler(refresh);

    await expect(apiClient.get('/privado')).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledOnce();
    const retryHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(retryHeaders.Authorization).toBe('Bearer nuevo');
  });

  it('no reintenta si la renovación falla, ni en errores distintos al token vencido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(expired()));
    setRefreshHandler(async () => null);
    await expect(apiClient.get('/privado')).rejects.toMatchObject({ code: 'ACCESS_TOKEN_EXPIRED' });

    const refresh = vi.fn(async () => 'x');
    setRefreshHandler(refresh);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: 'FORBIDDEN', message: 'No.' } }, 403)),
    );
    await expect(apiClient.get('/privado')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('expone los errores de validación por campo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Los datos enviados no son válidos.',
              details: [{ field: 'email', messages: ['Correo inválido.'] }],
            },
          },
          400,
        ),
      ),
    );
    const error = await apiClient.post('/users', {}).catch((e: unknown) => e);
    expect((error as { fieldErrors: unknown }).fieldErrors).toEqual([
      { field: 'email', messages: ['Correo inválido.'] },
    ]);
  });
});

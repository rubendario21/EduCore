import { PERMISSIONS } from '@educore/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/lib/theme';
import { jsonResponse } from '@/test/render';
import { AuthProvider } from './auth-context';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission } from './components/route-guards';
import { LoginPage } from './pages/login-page';
import { type AuthSession } from './types';

const session: AuthSession = {
  accessToken: 'token',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'docente@colegio.edu.co',
    firstNames: 'Elena',
    lastNames: 'Gómez',
    institution: { id: 'i1', name: 'Colegio Ejemplo' },
    roles: [{ code: 'TEACHER', name: 'Docente' }],
    permissions: [{ code: PERMISSIONS.ACADEMICS_READ, scopes: ['ALL'] }],
  },
};

const unauthorized = () =>
  jsonResponse({ error: { code: 'SESSION_INVALID', message: 'Tu sesión terminó.' } }, 401);
const branding = () =>
  jsonResponse({
    name: 'Colegio Ejemplo',
    legalName: 'Colegio Ejemplo',
    primaryColor: null,
    accentColor: null,
    logoUrl: null,
  });

/** Simula la API: refresh (sesión o no), branding y login. */
function mockApi({ loggedIn, loginResult }: { loggedIn: boolean; loginResult?: Response }) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/auth/refresh')) return loggedIn ? jsonResponse(session) : unauthorized();
    if (url.endsWith('/institution/branding')) return branding();
    if (url.endsWith('/auth/login')) return loginResult ?? jsonResponse(session);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp(
  routes: Parameters<typeof createMemoryRouter>[0],
  initial: string,
  wrap = (n: ReactNode) => n,
) {
  const router = createMemoryRouter(routes, { initialEntries: [initial] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    wrap(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    ),
  );
  return router;
}

const appRoutes = [
  {
    path: '/iniciar-sesion',
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <p>Área privada</p>
      </RequireAuth>
    ),
  },
  {
    path: '/usuarios',
    element: (
      <RequireAuth>
        <RequirePermission permission={PERMISSIONS.USERS_READ}>
          <p>Lista de usuarios</p>
        </RequirePermission>
      </RequireAuth>
    ),
  },
];

describe('Autenticación en la web', () => {
  it('sin sesión, una ruta privada lleva al inicio de sesión', async () => {
    mockApi({ loggedIn: false });
    const router = renderApp(appRoutes, '/');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/iniciar-sesion');
  });

  it('recupera la sesión al cargar con UNA sola renovación, incluso en StrictMode', async () => {
    const fetchMock = mockApi({ loggedIn: true });
    renderApp(appRoutes, '/', (node) => <StrictMode>{node}</StrictMode>);
    expect(await screen.findByText('Área privada')).toBeInTheDocument();
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    expect((refreshCalls[0]![1] as RequestInit).headers).toMatchObject({ 'X-EduCore-CSRF': '1' });
  });

  it('valida el formulario de inicio de sesión antes de enviarlo', async () => {
    const fetchMock = mockApi({ loggedIn: false });
    const user = userEvent.setup();
    renderApp(appRoutes, '/iniciar-sesion');
    await user.click(await screen.findByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('Ingresa un correo electrónico válido.')).toBeInTheDocument();
    expect(screen.getByText('Ingresa tu contraseña.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/login'))).toBe(false);
  });

  it('muestra el error de la API y, con credenciales correctas, entra a la ruta solicitada', async () => {
    mockApi({
      loggedIn: false,
      loginResult: jsonResponse(
        {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'El correo o la contraseña no son correctos.',
          },
        },
        401,
      ),
    });
    const user = userEvent.setup();
    const router = renderApp(appRoutes, '/iniciar-sesion');

    await user.type(await screen.findByLabelText('Correo electrónico'), 'docente@colegio.edu.co');
    await user.type(screen.getByLabelText('Contraseña'), 'equivocada');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El correo o la contraseña no son correctos.',
    );

    mockApi({ loggedIn: false });
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText('Área privada')).toBeInTheDocument();
  });

  it('una ruta sin permiso muestra "Acceso denegado"', async () => {
    mockApi({ loggedIn: true });
    renderApp(appRoutes, '/usuarios');
    expect(await screen.findByRole('heading', { name: 'Acceso denegado' })).toBeInTheDocument();
    expect(screen.queryByText('Lista de usuarios')).not.toBeInTheDocument();
  });
});

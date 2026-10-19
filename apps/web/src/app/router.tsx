import { PERMISSIONS } from '@educore/shared';
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router';
import { AcademicYearPage } from '@/features/academics/pages/academic-year-page';
import { AcademicsPage } from '@/features/academics/pages/academics-page';
import { AuditPage } from '@/features/audit/pages/audit-page';
import {
  RedirectIfAuthenticated,
  RequireAuth,
  RequirePermission,
} from '@/features/auth/components/route-guards';
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page';
import { LoginPage } from '@/features/auth/pages/login-page';
import { SetPasswordPage } from '@/features/auth/pages/set-password-page';
import { HomePage } from '@/features/dashboard/dashboard-page';
import { InstitutionPage } from '@/features/institution/pages/institution-page';
import { ProfilePage } from '@/features/profile/pages/profile-page';
import { RoleEditorPage } from '@/features/roles/pages/role-editor-page';
import { RolesPage } from '@/features/roles/pages/roles-page';
import { SystemStatusPage } from '@/features/system/pages/system-status-page';
import { UserDetailPage } from '@/features/users/pages/user-detail-page';
import { UsersPage } from '@/features/users/pages/users-page';
import { AppShell } from '@/layouts/app-shell';
import { NotFoundPage } from '@/routes/not-found-page';
import { RouteErrorPage } from '@/routes/route-error-page';

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      // Rutas públicas de acceso.
      {
        element: (
          <RedirectIfAuthenticated>
            <Outlet />
          </RedirectIfAuthenticated>
        ),
        children: [
          { path: 'iniciar-sesion', element: <LoginPage /> },
          { path: 'recuperar-contrasena', element: <ForgotPasswordPage /> },
        ],
      },
      // Los enlaces de los correos funcionan con o sin sesión iniciada.
      { path: 'restablecer-contrasena', element: <SetPasswordPage mode="reset" /> },
      { path: 'activar-cuenta', element: <SetPasswordPage mode="activate" /> },

      // Aplicación (requiere sesión). Cada ruta comprueba además su permiso.
      {
        element: (
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <HomePage /> },
          { path: 'perfil', element: <ProfilePage /> },
          {
            path: 'usuarios',
            element: (
              <RequirePermission permission={PERMISSIONS.USERS_READ}>
                <Outlet />
              </RequirePermission>
            ),
            children: [
              { index: true, element: <UsersPage /> },
              { path: ':id', element: <UserDetailPage /> },
            ],
          },
          {
            path: 'roles',
            element: (
              <RequirePermission permission={PERMISSIONS.ROLES_READ}>
                <Outlet />
              </RequirePermission>
            ),
            children: [
              { index: true, element: <RolesPage /> },
              {
                path: 'nuevo',
                element: (
                  <RequirePermission permission={PERMISSIONS.ROLES_MANAGE}>
                    <RoleEditorPage />
                  </RequirePermission>
                ),
              },
              { path: ':id', element: <RoleEditorPage /> },
            ],
          },
          {
            path: 'institucion',
            element: (
              <RequirePermission permission={PERMISSIONS.INSTITUTION_READ}>
                <InstitutionPage />
              </RequirePermission>
            ),
          },
          {
            path: 'academico',
            element: (
              <RequirePermission permission={PERMISSIONS.ACADEMICS_READ}>
                <Outlet />
              </RequirePermission>
            ),
            children: [
              { index: true, element: <AcademicsPage /> },
              { path: 'anios/:id', element: <AcademicYearPage /> },
            ],
          },
          {
            path: 'auditoria',
            element: (
              <RequirePermission permission={PERMISSIONS.AUDIT_READ}>
                <AuditPage />
              </RequirePermission>
            ),
          },
          {
            path: 'sistema',
            element: (
              <RequirePermission permission={PERMISSIONS.INSTITUTION_SETTINGS_UPDATE}>
                <SystemStatusPage />
              </RequirePermission>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);

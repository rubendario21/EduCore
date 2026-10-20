import { type PermissionCode, PERMISSIONS } from '@educore/shared';
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router';
import { AcademicYearPage } from '@/features/academics/pages/academic-year-page';
import { AcademicsPage } from '@/features/academics/pages/academics-page';
import { AdmissionDetailPage } from '@/features/admissions/pages/admission-detail-page';
import { AdmissionsPage } from '@/features/admissions/pages/admissions-page';
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
import { EnrollmentDetailPage } from '@/features/enrollments/pages/enrollment-detail-page';
import { EnrollmentsPage } from '@/features/enrollments/pages/enrollments-page';
import { ImportStudentsPage } from '@/features/imports/pages/import-students-page';
import { InstitutionPage } from '@/features/institution/pages/institution-page';
import { GuardiansPage } from '@/features/people/pages/guardians-page';
import { StaffPage } from '@/features/people/pages/staff-page';
import { StudentDetailPage } from '@/features/people/pages/student-detail-page';
import { StudentsPage } from '@/features/people/pages/students-page';
import { PrivacyPage } from '@/features/privacy/pages/privacy-page';
import { ProfilePage } from '@/features/profile/pages/profile-page';
import { RoleEditorPage } from '@/features/roles/pages/role-editor-page';
import { RolesPage } from '@/features/roles/pages/roles-page';
import { SystemStatusPage } from '@/features/system/pages/system-status-page';
import { MyClassesPage, RosterPage } from '@/features/teaching/pages/my-classes-page';
import { TeachingPage } from '@/features/teaching/pages/teaching-page';
import { UserDetailPage } from '@/features/users/pages/user-detail-page';
import { UsersPage } from '@/features/users/pages/users-page';
import { AppShell } from '@/layouts/app-shell';
import { NotFoundPage } from '@/routes/not-found-page';
import { RouteErrorPage } from '@/routes/route-error-page';

/** Sección de la aplicación que exige un permiso (la API lo verifica de nuevo). */
function guarded(path: string, permission: PermissionCode, children: RouteObject[]): RouteObject {
  return {
    path,
    element: (
      <RequirePermission permission={permission}>
        <Outlet />
      </RequirePermission>
    ),
    children,
  };
}

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
          guarded('estudiantes', PERMISSIONS.STUDENTS_READ, [
            { index: true, element: <StudentsPage /> },
            { path: ':id', element: <StudentDetailPage /> },
          ]),
          guarded('acudientes', PERMISSIONS.GUARDIANS_READ, [
            { index: true, element: <GuardiansPage /> },
          ]),
          guarded('personal', PERMISSIONS.STAFF_READ, [{ index: true, element: <StaffPage /> }]),
          guarded('matriculas', PERMISSIONS.ENROLLMENTS_READ, [
            { index: true, element: <EnrollmentsPage /> },
            { path: ':id', element: <EnrollmentDetailPage /> },
          ]),
          guarded('admisiones', PERMISSIONS.ADMISSIONS_READ, [
            { index: true, element: <AdmissionsPage /> },
            { path: ':id', element: <AdmissionDetailPage /> },
          ]),
          guarded('importar-estudiantes', PERMISSIONS.STUDENTS_MANAGE, [
            { index: true, element: <ImportStudentsPage /> },
          ]),
          guarded('asignacion-academica', PERMISSIONS.TEACHING_READ, [
            { index: true, element: <TeachingPage /> },
          ]),
          guarded('mis-cursos', PERMISSIONS.TEACHING_READ, [
            { index: true, element: <MyClassesPage /> },
            { path: ':id', element: <RosterPage /> },
          ]),
          guarded('proteccion-datos', PERMISSIONS.PRIVACY_CONSENTS_READ, [
            { index: true, element: <PrivacyPage /> },
          ]),
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

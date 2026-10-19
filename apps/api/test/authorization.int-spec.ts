import { randomUUID } from 'node:crypto';
import { SYSTEM_ROLES } from '@educore/shared';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTHENTICATED_KEY, PERMISSIONS_KEY } from '../src/modules/access-control/authorization';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/auth.decorators';
import { createTestApp } from './setup/create-test-app';
import { resetDatabase } from './setup/database';
import { loginAs, seedInstitution, seedMember } from './setup/fixtures';

interface RouteInfo {
  method: string;
  path: string;
  access: 'public' | 'authenticated' | 'permissions' | 'UNDECLARED';
  permissions: string[];
}

/**
 * Únicas rutas públicas permitidas. Añadir una ruta pública exige añadirla
 * aquí a propósito (y justificarlo en la revisión del cambio).
 */
const EXPECTED_PUBLIC_ROUTES = [
  'GET /api/v1/health',
  'GET /api/v1/health/live',
  // La pantalla de inicio de sesión necesita el nombre y los colores antes de autenticar.
  'GET /api/v1/institution/branding',
  // El logo forma parte de la marca pública.
  'GET /api/v1/institution/branding/logo',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/password/forgot',
  'POST /api/v1/auth/password/reset',
  'POST /api/v1/auth/refresh',
];

function collectRoutes(app: NestExpressApplication): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    const controller = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
    if (!controller) continue;
    const basePath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const prototype = controller.prototype as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (methodPath === undefined) continue;

      const method =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? 'UNKNOWN';
      const path = `/api/v1/${[basePath, methodPath]
        .map((p) => p.replace(/^\/|\/$/g, ''))
        .filter(Boolean)
        .join('/')}`;
      const read = (key: string) =>
        Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
      const permissions = (read(PERMISSIONS_KEY) as string[] | undefined) ?? [];
      const access = read(IS_PUBLIC_KEY)
        ? 'public'
        : permissions.length > 0
          ? 'permissions'
          : read(AUTHENTICATED_KEY)
            ? 'authenticated'
            : 'UNDECLARED';
      routes.push({ method, path, access, permissions });
    }
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function call(app: NestExpressApplication, route: RouteInfo) {
  const path = route.path.replace(/:[A-Za-z]+/g, randomUUID());
  const agent = request(app.getHttpServer());
  switch (route.method) {
    case 'POST':
      return agent.post(path).send({});
    case 'PUT':
      return agent.put(path).send({});
    case 'PATCH':
      return agent.patch(path).send({});
    case 'DELETE':
      return agent.delete(path);
    default:
      return agent.get(path);
  }
}

describe('Autorización: inventario de rutas y matriz de acceso (integración)', () => {
  let app: NestExpressApplication;
  let routes: RouteInfo[];
  let noPermissionsToken: string;

  beforeAll(async () => {
    app = await createTestApp({ extraImports: [DiscoveryModule] });
    routes = collectRoutes(app);

    await resetDatabase();
    const institution = await seedInstitution(app);
    // El rol Estudiante no tiene permisos administrativos en la Fase 1.
    await seedMember(app, {
      institutionId: institution.id,
      email: 'estudiante@prueba.edu.co',
      password: 'una frase de acceso bastante larga',
      roleCode: SYSTEM_ROLES.STUDENT,
    });
    noPermissionsToken = await loginAs(
      app,
      'estudiante@prueba.edu.co',
      'una frase de acceso bastante larga',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('descubre las rutas de la API', () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it('TODAS las rutas declaran su acceso (@Public, @Authenticated o @RequirePermissions)', () => {
    const undeclared = routes
      .filter((r) => r.access === 'UNDECLARED')
      .map((r) => `${r.method} ${r.path}`);
    expect(undeclared, 'Rutas sin declaración de acceso').toEqual([]);
  });

  it('las rutas públicas son exactamente las previstas', () => {
    const publicRoutes = routes
      .filter((r) => r.access === 'public')
      .map((r) => `${r.method} ${r.path}`);
    expect(publicRoutes.sort()).toEqual([...EXPECTED_PUBLIC_ROUTES].sort());
  });

  it('cada ruta protegida responde 401 sin sesión', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access !== 'public')) {
      const res = await call(app, route);
      if (res.status !== 401) failures.push(`${route.method} ${route.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('cada ruta con permisos responde 403 a un usuario sin esos permisos', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'permissions')) {
      const res = await call(app, route).set('Authorization', `Bearer ${noPermissionsToken}`);
      if (res.status !== 403 || res.body.error?.code !== 'FORBIDDEN') {
        failures.push(`${route.method} ${route.path} → ${res.status} ${res.body.error?.code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('las rutas @Authenticated dejan pasar a cualquier usuario con sesión', async () => {
    for (const route of routes.filter((r) => r.access === 'authenticated' && r.method === 'GET')) {
      const res = await call(app, route).set('Authorization', `Bearer ${noPermissionsToken}`);
      // Pasa el control de acceso; con un id inexistente la respuesta legítima es 404.
      const expected = route.path.includes(':') ? 404 : 200;
      expect(res.status, `${route.method} ${route.path}`).toBe(expected);
    }
  });
});

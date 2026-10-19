-- =============================================================================
-- EduCore · Creación de roles y bases de datos (PostgreSQL 15+)
--
-- Crea:
--   educore_owner  Dueño del esquema. Solo se usa para ejecutar migraciones.
--   educore_app    Rol de la aplicación en tiempo de ejecución (solo DML).
--   educore_dev    Base de datos de desarrollo.
--   educore_test   Base de datos para pruebas de integración.
--
-- Las contraseñas NO están en este archivo. Se leen de las variables de
-- entorno EDUCORE_OWNER_PASSWORD y EDUCORE_APP_PASSWORD (o de variables psql
-- -v owner_password=... / -v app_password=...).
--
-- Forma recomendada en desarrollo (genera los .env y ejecuta este script):
--   npm run db:setup:local
--
-- Ejecución manual (como superusuario; es idempotente):
--   EDUCORE_OWNER_PASSWORD=... EDUCORE_APP_PASSWORD=... \
--     psql -U postgres -h localhost -d postgres -f infra/db/01-create-roles-and-databases.sql
--
-- No elimina ni modifica datos existentes. Si los roles ya existen, solo
-- actualiza sus contraseñas y atributos.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?owner_password}
\else
  \getenv owner_password EDUCORE_OWNER_PASSWORD
\endif
\if :{?app_password}
\else
  \getenv app_password EDUCORE_APP_PASSWORD
\endif

\if :{?owner_password}
\else
  \echo 'Falta la contraseña de educore_owner (EDUCORE_OWNER_PASSWORD).'
  \quit
\endif
\if :{?app_password}
\else
  \echo 'Falta la contraseña de educore_app (EDUCORE_APP_PASSWORD).'
  \quit
\endif

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
SELECT 'CREATE ROLE educore_owner LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_owner')
\gexec

SELECT 'CREATE ROLE educore_app LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app')
\gexec

-- CREATEDB solo para el owner: `prisma migrate dev` necesita crear una base
-- temporal ("shadow database"). En producción se usa `prisma migrate deploy`,
-- que no la requiere, y este atributo puede retirarse (ver docs/operacion).
ALTER ROLE educore_owner WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'owner_password';
ALTER ROLE educore_app   WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

-- ---------------------------------------------------------------------------
-- Bases de datos
-- ---------------------------------------------------------------------------
SELECT 'CREATE DATABASE educore_dev OWNER educore_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'educore_dev')
\gexec

SELECT 'CREATE DATABASE educore_test OWNER educore_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'educore_test')
\gexec

-- Zona horaria por defecto de las sesiones. Las columnas usan timestamptz,
-- así que esto solo afecta a la presentación en consultas manuales.
ALTER DATABASE educore_dev  SET timezone TO 'America/Bogota';
ALTER DATABASE educore_test SET timezone TO 'America/Bogota';

-- Nadie más que los roles de EduCore puede conectarse.
REVOKE ALL ON DATABASE educore_dev  FROM PUBLIC;
REVOKE ALL ON DATABASE educore_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE educore_dev  TO educore_app;
GRANT CONNECT, TEMPORARY ON DATABASE educore_test TO educore_app;

-- ---------------------------------------------------------------------------
-- Privilegios dentro de cada base
-- ---------------------------------------------------------------------------
\connect educore_dev
\ir 02-grant-app-privileges.sql

\connect educore_test
\ir 02-grant-app-privileges.sql

\echo 'EduCore: roles y bases de datos listos.'

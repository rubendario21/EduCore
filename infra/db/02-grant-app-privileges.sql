-- =============================================================================
-- EduCore · Privilegios de la base actual (incluido desde 01-...sql).
-- También sirve para preparar una base nueva (p. ej. producción):
--   psql -U postgres -d <base> -f infra/db/02-grant-app-privileges.sql
-- =============================================================================

-- El esquema public pertenece al owner. Nadie más puede crear objetos en él.
ALTER SCHEMA public OWNER TO educore_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO educore_app;

-- Objetos ya existentes (si los hubiera).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO educore_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO educore_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO educore_app;

-- Objetos que las migraciones creen en el futuro (como educore_owner).
ALTER DEFAULT PRIVILEGES FOR ROLE educore_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO educore_app;
ALTER DEFAULT PRIVILEGES FOR ROLE educore_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO educore_app;
ALTER DEFAULT PRIVILEGES FOR ROLE educore_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO educore_app;

-- Las tablas de solo inserción (p. ej. audit_log) revocan UPDATE/DELETE a
-- educore_app en su propia migración.

-- =============================================================================
-- EduCore · Migración 0004 · Búsqueda de personas sin distinguir tildes
-- Agrega una columna DERIVADA (search_text) calculada por la base de datos y
-- la rellena para las personas existentes. No modifica ningún dato original.
-- =============================================================================

-- unaccent es una extensión "trusted": la puede crear el dueño de la base.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- AlterTable
ALTER TABLE "person" ADD COLUMN "search_text" TEXT;

-- Normaliza: minúsculas, sin tildes, espacios simples.
CREATE OR REPLACE FUNCTION person_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := regexp_replace(
    lower(unaccent(coalesce(NEW.first_names, '') || ' ' || coalesce(NEW.last_names, '') || ' ' || coalesce(NEW.document_number, ''))),
    '\s+', ' ', 'g'
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER person_search_text_trigger
  BEFORE INSERT OR UPDATE OF first_names, last_names, document_number ON "person"
  FOR EACH ROW EXECUTE FUNCTION person_search_text();

-- Relleno de las filas existentes (dispara el trigger; solo calcula search_text).
UPDATE "person" SET first_names = first_names;

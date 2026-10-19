-- =============================================================================
-- EduCore · Migración 0001 · Núcleo (institución, acceso, auditoría, estructura académica)
-- Generada por Prisma y completada a mano con las reglas que Prisma no expresa
-- (ver la sección "Reglas de integridad adicionales" al final).
-- =============================================================================

-- Extensiones (ambas son "trusted": las puede crear el dueño de la base, sin superusuario).
-- citext: correos sin distinguir mayúsculas. btree_gist: restricciones de no solapamiento.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "institution_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('RC', 'TI', 'CC', 'CE', 'NUIP', 'PPT', 'PEP', 'PA');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "permission_scope" AS ENUM ('ALL', 'ASSIGNED', 'OWN', 'LINKED');

-- CreateEnum
CREATE TYPE "password_token_purpose" AS ENUM ('ACTIVATION', 'RESET');

-- CreateEnum
CREATE TYPE "academic_year_status" AS ENUM ('PLANNING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "academic_period_status" AS ENUM ('PLANNED', 'OPEN', 'CLOSED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "institution" (
    "id" UUID NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "trade_name" VARCHAR(200),
    "tax_id" VARCHAR(20),
    "tax_id_dv" VARCHAR(1),
    "dane_code" VARCHAR(20),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "website" VARCHAR(300),
    "address" VARCHAR(300),
    "city" VARCHAR(120),
    "department" VARCHAR(120),
    "country" CHAR(2) NOT NULL DEFAULT 'CO',
    "status" "institution_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institution_settings" (
    "institution_id" UUID NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'es-CO',
    "currency" CHAR(3) NOT NULL DEFAULT 'COP',
    "branding" JSONB NOT NULL DEFAULT '{}',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "institution_settings_pkey" PRIMARY KEY ("institution_id")
);

-- CreateTable
CREATE TABLE "campus" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "dane_code" VARCHAR(20),
    "address" VARCHAR(300),
    "city" VARCHAR(120),
    "phone" VARCHAR(40),
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "document_type" "document_type" NOT NULL,
    "document_number" VARCHAR(30) NOT NULL,
    "first_names" VARCHAR(120) NOT NULL,
    "last_names" VARCHAR(120) NOT NULL,
    "birth_date" DATE,
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "address" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_institution" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "description" VARCHAR(300) NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "scope" "permission_scope" NOT NULL DEFAULT 'ALL',

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "membership_role" (
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_user_id" UUID,

    CONSTRAINT "membership_role_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "rotated_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(40),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "password_token_purpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "institution_id" UUID,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60),
    "entity_id" UUID,
    "changes" JSONB,
    "metadata" JSONB,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "academic_year_status" NOT NULL DEFAULT 'PLANNING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_period" (
    "id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "weight_percent" DECIMAL(5,2) NOT NULL,
    "status" "academic_period_status" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academic_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_level" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "education_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "education_level_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_group" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "school_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_area" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subject_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "subject_area_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campus_institution_id_code_key" ON "campus"("institution_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shift_institution_id_code_key" ON "shift"("institution_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "person_institution_id_last_names_first_names_idx" ON "person"("institution_id", "last_names", "first_names");

-- CreateIndex
CREATE UNIQUE INDEX "person_institution_id_document_type_document_number_key" ON "person"("institution_id", "document_type", "document_number");

-- CreateIndex
CREATE UNIQUE INDEX "user_institution_person_id_key" ON "user_institution"("person_id");

-- CreateIndex
CREATE INDEX "user_institution_institution_id_status_idx" ON "user_institution"("institution_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_institution_user_id_institution_id_key" ON "user_institution"("user_id", "institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_institution_id_code_key" ON "role"("institution_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE INDEX "membership_role_role_id_idx" ON "membership_role"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_session_refresh_token_hash_key" ON "user_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_session_family_id_idx" ON "user_session"("family_id");

-- CreateIndex
CREATE INDEX "user_session_user_id_idx" ON "user_session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_token_token_hash_key" ON "password_token"("token_hash");

-- CreateIndex
CREATE INDEX "password_token_user_id_purpose_idx" ON "password_token"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "audit_log_institution_id_created_at_idx" ON "audit_log"("institution_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_institution_id_year_key" ON "academic_year"("institution_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "academic_period_academic_year_id_number_key" ON "academic_period"("academic_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "education_level_institution_id_code_key" ON "education_level"("institution_id", "code");

-- CreateIndex
CREATE INDEX "grade_education_level_id_idx" ON "grade"("education_level_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_institution_id_code_key" ON "grade"("institution_id", "code");

-- CreateIndex
CREATE INDEX "school_group_academic_year_id_grade_id_idx" ON "school_group"("academic_year_id", "grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_group_institution_id_academic_year_id_campus_id_code_key" ON "school_group"("institution_id", "academic_year_id", "campus_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subject_area_institution_id_code_key" ON "subject_area"("institution_id", "code");

-- CreateIndex
CREATE INDEX "subject_subject_area_id_idx" ON "subject"("subject_area_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_institution_id_code_key" ON "subject"("institution_id", "code");

-- AddForeignKey
ALTER TABLE "institution_settings" ADD CONSTRAINT "institution_settings_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus" ADD CONSTRAINT "campus_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_institution" ADD CONSTRAINT "user_institution_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_institution" ADD CONSTRAINT "user_institution_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_institution" ADD CONSTRAINT "user_institution_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "user_institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role" ADD CONSTRAINT "membership_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "user_institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_token" ADD CONSTRAINT "password_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year" ADD CONSTRAINT "academic_year_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_period" ADD CONSTRAINT "academic_period_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "education_level" ADD CONSTRAINT "education_level_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_education_level_id_fkey" FOREIGN KEY ("education_level_id") REFERENCES "education_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_group" ADD CONSTRAINT "school_group_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_group" ADD CONSTRAINT "school_group_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_group" ADD CONSTRAINT "school_group_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_group" ADD CONSTRAINT "school_group_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_group" ADD CONSTRAINT "school_group_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_area" ADD CONSTRAINT "subject_area_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject" ADD CONSTRAINT "subject_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject" ADD CONSTRAINT "subject_subject_area_id_fkey" FOREIGN KEY ("subject_area_id") REFERENCES "subject_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Reglas de integridad adicionales (escritas a mano; Prisma no las genera)
-- Se aplican en la base de datos para que ningún error de la aplicación pueda
-- dejar datos inconsistentes. Documentadas en docs/fases/fase-1-nucleo.md.
-- =============================================================================

-- Institución
ALTER TABLE "institution"
  ADD CONSTRAINT "institution_tax_id_dv_check" CHECK ("tax_id_dv" IS NULL OR "tax_id_dv" ~ '^[0-9]$');

-- Una sola sede principal por institución.
CREATE UNIQUE INDEX "campus_one_main_per_institution"
  ON "campus" ("institution_id") WHERE "is_main";

-- Años lectivos: fechas coherentes, año razonable y un solo año ACTIVO por institución.
ALTER TABLE "academic_year"
  ADD CONSTRAINT "academic_year_dates_check" CHECK ("ends_on" > "starts_on"),
  ADD CONSTRAINT "academic_year_year_check" CHECK ("year" BETWEEN 2000 AND 2100);

CREATE UNIQUE INDEX "academic_year_one_active_per_institution"
  ON "academic_year" ("institution_id") WHERE "status" = 'ACTIVE';

-- Períodos: fechas coherentes, número positivo, peso entre 0 y 100 y sin solaparse
-- dentro del mismo año (rango de fechas inclusivo en ambos extremos).
ALTER TABLE "academic_period"
  ADD CONSTRAINT "academic_period_dates_check" CHECK ("ends_on" >= "starts_on"),
  ADD CONSTRAINT "academic_period_number_check" CHECK ("number" >= 1),
  ADD CONSTRAINT "academic_period_weight_check" CHECK ("weight_percent" > 0 AND "weight_percent" <= 100),
  ADD CONSTRAINT "academic_period_no_overlap"
    EXCLUDE USING gist ("academic_year_id" WITH =, daterange("starts_on", "ends_on", '[]') WITH &&);

-- Grupos: capacidad positiva cuando se define.
ALTER TABLE "school_group"
  ADD CONSTRAINT "school_group_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);

-- Seguridad de cuentas: contadores no negativos.
ALTER TABLE "user"
  ADD CONSTRAINT "user_failed_login_count_check" CHECK ("failed_login_count" >= 0);

-- Auditoría de solo inserción: el rol de la aplicación no puede modificarla ni
-- borrarla. Se condiciona a que el rol exista (en otros entornos puede llamarse
-- distinto; ver infra/db/02-grant-app-privileges.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM educore_app;
  END IF;
END
$$;

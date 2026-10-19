-- =============================================================================
-- EduCore · Migración 0003 · Comunidad educativa (estudiantes, acudientes, personal)
-- Solo agrega estructuras: no modifica ni elimina datos existentes.
-- =============================================================================

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('ACTIVE', 'WITHDRAWN', 'GRADUATED');

-- CreateEnum
CREATE TYPE "guardian_relationship" AS ENUM ('MOTHER', 'FATHER', 'GRANDPARENT', 'SIBLING', 'UNCLE_AUNT', 'LEGAL_GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "staff_type" AS ENUM ('TEACHER', 'DIRECTIVE', 'ADMINISTRATIVE', 'SUPPORT');

-- CreateTable
CREATE TABLE "student" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "code" VARCHAR(30),
    "status" "student_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "occupation" VARCHAR(120),
    "workplace" VARCHAR(150),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardian" (
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "relationship" "guardian_relationship" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_legal_representative" BOOLEAN NOT NULL DEFAULT false,
    "lives_with_student" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_guardian_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "staff_member" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "staff_type" "staff_type" NOT NULL,
    "title" VARCHAR(120),
    "hire_date" DATE,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_person_id_key" ON "student"("person_id");

-- CreateIndex
CREATE INDEX "student_institution_id_status_idx" ON "student"("institution_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_institution_id_code_key" ON "student"("institution_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_person_id_key" ON "guardian"("person_id");

-- CreateIndex
CREATE INDEX "guardian_institution_id_idx" ON "guardian"("institution_id");

-- CreateIndex
CREATE INDEX "student_guardian_guardian_id_idx" ON "student_guardian"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_member_person_id_key" ON "staff_member"("person_id");

-- CreateIndex
CREATE INDEX "staff_member_institution_id_staff_type_status_idx" ON "staff_member"("institution_id", "staff_type", "status");

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas de integridad adicionales (escritas a mano)
-- Un único acudiente principal por estudiante.
CREATE UNIQUE INDEX "student_guardian_one_primary_per_student"
  ON "student_guardian" ("student_id") WHERE "is_primary";

-- El código del estudiante, cuando existe, no puede estar vacío.
ALTER TABLE "student"
  ADD CONSTRAINT "student_code_not_blank_check" CHECK ("code" IS NULL OR length(trim("code")) > 0);

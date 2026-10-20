-- =============================================================================
-- EduCore · Migración 0005 · Matrícula y ubicación en grupos
-- Solo agrega estructuras: no modifica ni elimina datos existentes.
-- =============================================================================

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('PRE_ENROLLED', 'ACTIVE', 'WITHDRAWN', 'TRANSFERRED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "withdrawal_reason" AS ENUM ('VOLUNTARY', 'ACADEMIC', 'DISCIPLINARY', 'HEALTH', 'RELOCATION', 'ECONOMIC', 'OTHER');

-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'PRE_ENROLLED',
    "enrolled_on" DATE NOT NULL,
    "ended_on" DATE,
    "withdrawal_reason" "withdrawal_reason",
    "end_detail" VARCHAR(500),
    "previous_enrollment_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_placement" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "school_group_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_placement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrollment_institution_id_academic_year_id_status_idx" ON "enrollment"("institution_id", "academic_year_id", "status");

-- CreateIndex
CREATE INDEX "enrollment_student_id_idx" ON "enrollment"("student_id");

-- CreateIndex
CREATE INDEX "group_placement_enrollment_id_idx" ON "group_placement"("enrollment_id");

-- CreateIndex
CREATE INDEX "group_placement_school_group_id_to_date_idx" ON "group_placement"("school_group_id", "to_date");

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_previous_enrollment_id_fkey" FOREIGN KEY ("previous_enrollment_id") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_placement" ADD CONSTRAINT "group_placement_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_placement" ADD CONSTRAINT "group_placement_school_group_id_fkey" FOREIGN KEY ("school_group_id") REFERENCES "school_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas de integridad adicionales (escritas a mano)

-- Una sola matrícula vigente por estudiante y año lectivo.
CREATE UNIQUE INDEX "enrollment_one_current_per_student_year"
  ON "enrollment" ("student_id", "academic_year_id")
  WHERE "status" IN ('PRE_ENROLLED', 'ACTIVE');

-- Una sola ubicación abierta (sin fecha de fin) por matrícula.
CREATE UNIQUE INDEX "group_placement_one_open_per_enrollment"
  ON "group_placement" ("enrollment_id")
  WHERE "to_date" IS NULL;

ALTER TABLE "group_placement"
  ADD CONSTRAINT "group_placement_dates_check" CHECK ("to_date" IS NULL OR "to_date" >= "from_date");

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_dates_check" CHECK ("ended_on" IS NULL OR "ended_on" >= "enrolled_on"),
  -- Retiro y traslado siempre registran la fecha.
  ADD CONSTRAINT "enrollment_end_requires_date_check"
    CHECK ("status" NOT IN ('WITHDRAWN', 'TRANSFERRED') OR "ended_on" IS NOT NULL);

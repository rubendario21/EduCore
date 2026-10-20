-- CreateEnum
CREATE TYPE "admission_status" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'WAITLISTED', 'APPROVED', 'REJECTED', 'ENROLLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "admission_document_type" AS ENUM ('BIRTH_CERTIFICATE', 'IDENTITY_DOCUMENT', 'REPORT_CARD', 'PHOTO', 'GUARDIAN_IDENTITY', 'OTHER');

-- CreateTable
CREATE TABLE "admission_application" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "grade_id" UUID NOT NULL,
    "status" "admission_status" NOT NULL DEFAULT 'DRAFT',
    "applicant_document_type" "document_type" NOT NULL,
    "applicant_document_number" VARCHAR(30) NOT NULL,
    "applicant_first_names" VARCHAR(120) NOT NULL,
    "applicant_last_names" VARCHAR(120) NOT NULL,
    "applicant_birth_date" DATE,
    "previous_school" VARCHAR(200),
    "guardian_document_type" "document_type",
    "guardian_document_number" VARCHAR(30),
    "guardian_first_names" VARCHAR(120),
    "guardian_last_names" VARCHAR(120),
    "guardian_relationship" "guardian_relationship",
    "guardian_email" VARCHAR(254),
    "guardian_phone" VARCHAR(30),
    "notes" VARCHAR(1000),
    "decision_note" VARCHAR(1000),
    "decided_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "student_id" UUID,
    "enrollment_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admission_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_document" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "document_type" "admission_document_type" NOT NULL,
    "stored_file_id" UUID NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_status_change" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "admission_status",
    "to_status" "admission_status" NOT NULL,
    "note" VARCHAR(1000),
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_status_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admission_application_enrollment_id_key" ON "admission_application"("enrollment_id");

-- CreateIndex
CREATE INDEX "admission_application_institution_id_academic_year_id_statu_idx" ON "admission_application"("institution_id", "academic_year_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admission_application_institution_id_academic_year_id_numbe_key" ON "admission_application"("institution_id", "academic_year_id", "number");

-- CreateIndex
CREATE INDEX "admission_document_application_id_idx" ON "admission_document"("application_id");

-- CreateIndex
CREATE INDEX "admission_status_change_application_id_changed_at_idx" ON "admission_status_change"("application_id", "changed_at");

-- AddForeignKey
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_application" ADD CONSTRAINT "admission_application_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_document" ADD CONSTRAINT "admission_document_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "admission_application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_document" ADD CONSTRAINT "admission_document_stored_file_id_fkey" FOREIGN KEY ("stored_file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_status_change" ADD CONSTRAINT "admission_status_change_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "admission_application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas de integridad adicionales (escritas a mano)

-- Una sola solicitud en curso (o admitida) por aspirante y año lectivo.
CREATE UNIQUE INDEX "admission_application_one_open_per_applicant_year"
  ON "admission_application" ("academic_year_id", "applicant_document_type", "applicant_document_number")
  WHERE "status" NOT IN ('REJECTED', 'WITHDRAWN');

ALTER TABLE "admission_application"
  ADD CONSTRAINT "admission_application_number_check" CHECK ("number" >= 1),
  -- El acudiente se registra completo o no se registra.
  ADD CONSTRAINT "admission_application_guardian_complete_check" CHECK (
    ("guardian_document_type" IS NULL AND "guardian_document_number" IS NULL
      AND "guardian_first_names" IS NULL AND "guardian_last_names" IS NULL
      AND "guardian_relationship" IS NULL)
    OR
    ("guardian_document_type" IS NOT NULL AND "guardian_document_number" IS NOT NULL
      AND "guardian_first_names" IS NOT NULL AND "guardian_last_names" IS NOT NULL
      AND "guardian_relationship" IS NOT NULL)
  ),
  -- Un rechazo siempre registra su motivo.
  ADD CONSTRAINT "admission_application_rejection_note_check"
    CHECK ("status" <> 'REJECTED' OR "decision_note" IS NOT NULL),
  -- Una solicitud matriculada apunta a su estudiante y su matrícula.
  ADD CONSTRAINT "admission_application_enrolled_check"
    CHECK ("status" <> 'ENROLLED' OR ("student_id" IS NOT NULL AND "enrollment_id" IS NOT NULL));

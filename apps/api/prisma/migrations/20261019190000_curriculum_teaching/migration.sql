-- CreateTable
CREATE TABLE "curriculum_subject" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "weekly_hours" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "curriculum_subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_assignment" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "school_group_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teaching_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "curriculum_subject_academic_year_id_grade_id_idx" ON "curriculum_subject"("academic_year_id", "grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_subject_institution_id_academic_year_id_grade_id_key" ON "curriculum_subject"("institution_id", "academic_year_id", "grade_id", "subject_id");

-- CreateIndex
CREATE INDEX "teaching_assignment_staff_member_id_to_date_idx" ON "teaching_assignment"("staff_member_id", "to_date");

-- CreateIndex
CREATE INDEX "teaching_assignment_school_group_id_subject_id_idx" ON "teaching_assignment"("school_group_id", "subject_id");

-- AddForeignKey
ALTER TABLE "curriculum_subject" ADD CONSTRAINT "curriculum_subject_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_subject" ADD CONSTRAINT "curriculum_subject_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_subject" ADD CONSTRAINT "curriculum_subject_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_subject" ADD CONSTRAINT "curriculum_subject_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_school_group_id_fkey" FOREIGN KEY ("school_group_id") REFERENCES "school_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas de integridad adicionales (escritas a mano)

-- Intensidad horaria semanal razonable (1 a 40 horas).
ALTER TABLE "curriculum_subject"
  ADD CONSTRAINT "curriculum_subject_weekly_hours_check" CHECK ("weekly_hours" BETWEEN 1 AND 40);

-- Una asignatura de un grupo tiene un único docente vigente.
CREATE UNIQUE INDEX "teaching_assignment_one_current_per_group_subject"
  ON "teaching_assignment" ("school_group_id", "subject_id")
  WHERE "to_date" IS NULL;

ALTER TABLE "teaching_assignment"
  ADD CONSTRAINT "teaching_assignment_dates_check" CHECK ("to_date" IS NULL OR "to_date" >= "from_date");

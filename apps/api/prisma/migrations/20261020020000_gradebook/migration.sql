-- CreateTable
CREATE TABLE "evaluation_component" (
    "id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "weight_percent" DECIMAL(5,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "evaluation_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "school_group_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(1000),
    "due_on" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_record" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "score" DECIMAL(6,2),
    "comment" VARCHAR(500),
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grade_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_record_change" (
    "id" UUID NOT NULL,
    "grade_record_id" UUID NOT NULL,
    "previous_score" DECIMAL(6,2),
    "new_score" DECIMAL(6,2),
    "reason" VARCHAR(500),
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_record_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_component_scheme_id_code_key" ON "evaluation_component"("scheme_id", "code");

-- CreateIndex
CREATE INDEX "assessment_school_group_id_subject_id_period_id_idx" ON "assessment"("school_group_id", "subject_id", "period_id");

-- CreateIndex
CREATE INDEX "grade_record_enrollment_id_idx" ON "grade_record"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_record_assessment_id_enrollment_id_key" ON "grade_record"("assessment_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "grade_record_change_grade_record_id_changed_at_idx" ON "grade_record_change"("grade_record_id", "changed_at");

-- AddForeignKey
ALTER TABLE "evaluation_component" ADD CONSTRAINT "evaluation_component_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "grading_scheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_school_group_id_fkey" FOREIGN KEY ("school_group_id") REFERENCES "school_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "academic_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "evaluation_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_record" ADD CONSTRAINT "grade_record_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_record" ADD CONSTRAINT "grade_record_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_record_change" ADD CONSTRAINT "grade_record_change_grade_record_id_fkey" FOREIGN KEY ("grade_record_id") REFERENCES "grade_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas de integridad adicionales (escritas a mano)

ALTER TABLE "evaluation_component"
  ADD CONSTRAINT "evaluation_component_weight_check"
    CHECK ("weight_percent" > 0 AND "weight_percent" <= 100);

-- Los SIEE ya configurados reciben un único componente "General" al 100 %.
INSERT INTO "evaluation_component" ("id", "scheme_id", "code", "name", "weight_percent", "sort_order")
SELECT gen_random_uuid(), "id", 'GENERAL', 'General', 100, 0 FROM "grading_scheme";

-- Una nota siempre está dentro de la escala del SIEE de su año lectivo.
CREATE OR REPLACE FUNCTION grade_record_score_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  scale RECORD;
BEGIN
  IF NEW.score IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT gs.min_score, gs.max_score INTO scale
  FROM assessment a
  JOIN academic_period p ON p.id = a.period_id
  JOIN grading_scheme gs ON gs.academic_year_id = p.academic_year_id
  WHERE a.id = NEW.assessment_id;
  IF scale IS NULL OR NEW.score < scale.min_score OR NEW.score > scale.max_score THEN
    RAISE EXCEPTION 'La nota % está fuera de la escala del SIEE', NEW.score
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER grade_record_score_guard_trigger
  BEFORE INSERT OR UPDATE OF score ON "grade_record"
  FOR EACH ROW EXECUTE FUNCTION grade_record_score_guard();

-- El historial de notas es de solo inserción.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "grade_record_change" FROM educore_app;
  END IF;
END
$$;

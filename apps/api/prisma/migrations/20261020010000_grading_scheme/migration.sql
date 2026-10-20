-- CreateEnum
CREATE TYPE "rounding_mode" AS ENUM ('HALF_UP', 'TRUNCATE');

-- CreateEnum
CREATE TYPE "promotion_unit" AS ENUM ('AREA', 'SUBJECT');

-- CreateTable
CREATE TABLE "grading_scheme" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "min_score" DECIMAL(6,2) NOT NULL,
    "max_score" DECIMAL(6,2) NOT NULL,
    "decimals" INTEGER NOT NULL,
    "passing_score" DECIMAL(6,2) NOT NULL,
    "rounding" "rounding_mode" NOT NULL DEFAULT 'HALF_UP',
    "promotion_unit" "promotion_unit" NOT NULL DEFAULT 'AREA',
    "max_failed_for_promotion" INTEGER,
    "min_attendance_percent" DECIMAL(5,2),
    "notes" VARCHAR(4000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grading_scheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_level" (
    "id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "min_score" DECIMAL(6,2) NOT NULL,
    "max_score" DECIMAL(6,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "performance_level_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grading_scheme_academic_year_id_key" ON "grading_scheme"("academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_level_scheme_id_code_key" ON "performance_level"("scheme_id", "code");

-- AddForeignKey
ALTER TABLE "grading_scheme" ADD CONSTRAINT "grading_scheme_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_scheme" ADD CONSTRAINT "grading_scheme_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_level" ADD CONSTRAINT "performance_level_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "grading_scheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Reglas de integridad adicionales (escritas a mano)

ALTER TABLE "grading_scheme"
  ADD CONSTRAINT "grading_scheme_decimals_check" CHECK ("decimals" BETWEEN 0 AND 2),
  ADD CONSTRAINT "grading_scheme_range_check" CHECK ("min_score" < "max_score"),
  ADD CONSTRAINT "grading_scheme_passing_check" CHECK ("passing_score" BETWEEN "min_score" AND "max_score"),
  ADD CONSTRAINT "grading_scheme_max_failed_check"
    CHECK ("max_failed_for_promotion" IS NULL OR "max_failed_for_promotion" >= 0),
  ADD CONSTRAINT "grading_scheme_attendance_check"
    CHECK ("min_attendance_percent" IS NULL OR "min_attendance_percent" BETWEEN 0 AND 100);

ALTER TABLE "performance_level"
  ADD CONSTRAINT "performance_level_range_check" CHECK ("min_score" <= "max_score");

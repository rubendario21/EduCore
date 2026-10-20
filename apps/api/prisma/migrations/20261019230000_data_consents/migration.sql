-- CreateEnum
CREATE TYPE "data_policy_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "consent_authorizer_role" AS ENUM ('LEGAL_REPRESENTATIVE', 'TITULAR');

-- CreateEnum
CREATE TYPE "consent_method" AS ENUM ('WRITTEN', 'ELECTRONIC', 'EMAIL', 'RECORDED_CALL', 'OTHER');

-- CreateTable
CREATE TABLE "data_policy" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "status" "data_policy_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_policy_purpose" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(1000),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "data_policy_purpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_consent" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "authorizer_person_id" UUID NOT NULL,
    "authorizer_role" "consent_authorizer_role" NOT NULL,
    "method" "consent_method" NOT NULL,
    "consented_on" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "evidence_file_id" UUID,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_on" DATE,
    "revocation_reason" VARCHAR(1000),
    "revoked_by_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "data_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_consent_decision" (
    "id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "purpose_id" UUID NOT NULL,
    "granted" BOOLEAN NOT NULL,

    CONSTRAINT "data_consent_decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_policy_institution_id_version_key" ON "data_policy"("institution_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "data_policy_purpose_policy_id_code_key" ON "data_policy_purpose"("policy_id", "code");

-- CreateIndex
CREATE INDEX "data_consent_institution_id_policy_id_idx" ON "data_consent"("institution_id", "policy_id");

-- CreateIndex
CREATE INDEX "data_consent_student_id_idx" ON "data_consent"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_consent_decision_consent_id_purpose_id_key" ON "data_consent_decision"("consent_id", "purpose_id");

-- AddForeignKey
ALTER TABLE "data_policy" ADD CONSTRAINT "data_policy_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_policy_purpose" ADD CONSTRAINT "data_policy_purpose_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "data_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent" ADD CONSTRAINT "data_consent_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent" ADD CONSTRAINT "data_consent_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent" ADD CONSTRAINT "data_consent_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "data_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent" ADD CONSTRAINT "data_consent_authorizer_person_id_fkey" FOREIGN KEY ("authorizer_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent" ADD CONSTRAINT "data_consent_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "stored_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent_decision" ADD CONSTRAINT "data_consent_decision_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "data_consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_consent_decision" ADD CONSTRAINT "data_consent_decision_purpose_id_fkey" FOREIGN KEY ("purpose_id") REFERENCES "data_policy_purpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas de integridad adicionales (escritas a mano)

-- Una sola autorización vigente (no revocada) por estudiante y versión de la política.
CREATE UNIQUE INDEX "data_consent_one_active_per_student_policy"
  ON "data_consent" ("student_id", "policy_id")
  WHERE "revoked_at" IS NULL;

ALTER TABLE "data_policy"
  ADD CONSTRAINT "data_policy_published_check"
    CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);

ALTER TABLE "data_consent"
  -- La revocación se registra completa: fecha, motivo y momento del registro.
  ADD CONSTRAINT "data_consent_revocation_check" CHECK (
    ("revoked_at" IS NULL AND "revoked_on" IS NULL AND "revocation_reason" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_on" IS NOT NULL AND "revocation_reason" IS NOT NULL)
  ),
  ADD CONSTRAINT "data_consent_revocation_date_check"
    CHECK ("revoked_on" IS NULL OR "revoked_on" >= "consented_on");

-- Una política publicada no se modifica ni se borra (ni sus finalidades).
CREATE OR REPLACE FUNCTION data_policy_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'La política % está publicada y no se puede modificar', OLD.version
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER data_policy_guard_trigger
  BEFORE UPDATE OR DELETE ON "data_policy"
  FOR EACH ROW EXECUTE FUNCTION data_policy_guard();

CREATE OR REPLACE FUNCTION data_policy_purpose_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  policy_status data_policy_status;
BEGIN
  SELECT status INTO policy_status FROM data_policy
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.policy_id ELSE OLD.policy_id END;
  IF policy_status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Las finalidades de una política publicada no se modifican'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER data_policy_purpose_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON "data_policy_purpose"
  FOR EACH ROW EXECUTE FUNCTION data_policy_purpose_guard();

-- Una autorización no se edita: solo admite, una vez, el soporte y la revocación.
CREATE OR REPLACE FUNCTION data_consent_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.institution_id, NEW.student_id, NEW.policy_id, NEW.authorizer_person_id,
      NEW.authorizer_role, NEW.method, NEW.consented_on, NEW.notes,
      NEW.recorded_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.institution_id, OLD.student_id, OLD.policy_id, OLD.authorizer_person_id,
      OLD.authorizer_role, OLD.method, OLD.consented_on, OLD.notes,
      OLD.recorded_by_user_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Una autorización registrada no se modifica'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.evidence_file_id IS NOT NULL AND NEW.evidence_file_id IS DISTINCT FROM OLD.evidence_file_id THEN
    RAISE EXCEPTION 'El soporte de la autorización no se reemplaza'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND
     (NEW.revoked_at, NEW.revoked_on, NEW.revocation_reason, NEW.revoked_by_user_id)
     IS DISTINCT FROM
     (OLD.revoked_at, OLD.revoked_on, OLD.revocation_reason, OLD.revoked_by_user_id)
  THEN
    RAISE EXCEPTION 'La revocación de la autorización no se modifica'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER data_consent_guard_trigger
  BEFORE UPDATE ON "data_consent"
  FOR EACH ROW EXECUTE FUNCTION data_consent_guard();

-- Cada decisión corresponde a una finalidad de la misma versión de la política.
CREATE OR REPLACE FUNCTION data_consent_decision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM data_consent c
    JOIN data_policy_purpose p ON p.policy_id = c.policy_id
    WHERE c.id = NEW.consent_id AND p.id = NEW.purpose_id
  ) THEN
    RAISE EXCEPTION 'La finalidad no pertenece a la política de la autorización'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER data_consent_decision_guard_trigger
  BEFORE INSERT ON "data_consent_decision"
  FOR EACH ROW EXECUTE FUNCTION data_consent_decision_guard();

-- Las autorizaciones y sus decisiones no se borran; las decisiones tampoco se editan.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE DELETE, TRUNCATE ON TABLE "data_consent" FROM educore_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "data_consent_decision" FROM educore_app;
  END IF;
END
$$;

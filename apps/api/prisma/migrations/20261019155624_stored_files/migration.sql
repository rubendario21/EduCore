-- =============================================================================
-- EduCore · Migración 0002 · Archivos (metadatos) y logo institucional
-- Solo agrega estructuras: no modifica ni elimina datos existentes.
-- El contenido de los archivos vive en el almacenamiento privado, no aquí.
-- =============================================================================

-- CreateEnum
CREATE TYPE "file_classification" AS ENUM ('INSTITUTIONAL', 'PERSONAL', 'SENSITIVE');

-- AlterTable
ALTER TABLE "institution_settings" ADD COLUMN     "logo_file_id" UUID;

-- CreateTable
CREATE TABLE "stored_file" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "storage_driver" VARCHAR(20) NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "classification" "file_classification" NOT NULL,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stored_file_institution_id_created_at_idx" ON "stored_file"("institution_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_institution_id_storage_key_key" ON "stored_file"("institution_id", "storage_key");

-- AddForeignKey
ALTER TABLE "institution_settings" ADD CONSTRAINT "institution_settings_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "stored_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas de integridad adicionales (escritas a mano)
ALTER TABLE "stored_file"
  ADD CONSTRAINT "stored_file_size_check" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "stored_file_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

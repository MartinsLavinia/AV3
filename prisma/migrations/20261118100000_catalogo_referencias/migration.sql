-- Add canonical match key and deactivation audit fields to the existing catalog.
ALTER TABLE "ReferenciaRecuperacao"
ADD COLUMN "assinaturaCriterio" TEXT;

UPDATE "ReferenciaRecuperacao"
SET "assinaturaCriterio" =
    "tipo"::TEXT || '|' || "estadoFisico"::TEXT || '|' ||
    COALESCE(LOWER(BTRIM("marca")), '*') || '|' ||
    COALESCE(LOWER(BTRIM("modelo")), '*');

ALTER TABLE "ReferenciaRecuperacao"
ALTER COLUMN "assinaturaCriterio" SET NOT NULL;

ALTER TABLE "ReferenciaRecuperacao"
ADD COLUMN "encerradaPor" TEXT,
ADD COLUMN "motivoEncerramento" TEXT;

CREATE INDEX "ReferenciaRecuperacao_assinaturaCriterio_versao_idx"
ON "ReferenciaRecuperacao"("assinaturaCriterio", "versao");

-- At most one current reference can exist for a normalized criterion signature.
CREATE UNIQUE INDEX "ReferenciaRecuperacao_assinaturaCriterio_ativa_key"
ON "ReferenciaRecuperacao"("assinaturaCriterio")
WHERE "ativa" = true;

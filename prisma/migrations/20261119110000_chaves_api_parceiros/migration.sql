CREATE TYPE "EscopoChaveApi" AS ENUM (
  'RASTREAMENTO_LEITURA',
  'LOTES_CRIACAO',
  'RELATORIOS_LEITURA'
);

CREATE TABLE "ChaveApiParceiro" (
  "id" UUID NOT NULL,
  "organizacaoId" UUID NOT NULL,
  "nome" TEXT NOT NULL,
  "prefixo" TEXT NOT NULL,
  "segredoHash" TEXT NOT NULL,
  "permissoes" "EscopoChaveApi"[] NOT NULL DEFAULT ARRAY[]::"EscopoChaveApi"[],
  "criadaPor" TEXT NOT NULL,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "ultimaUtilizacaoEm" TIMESTAMP(3),
  "revogadaEm" TIMESTAMP(3),
  "revogadaPor" TEXT,
  "motivoRevogacao" TEXT,

  CONSTRAINT "ChaveApiParceiro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChaveApiParceiro_segredoHash_key"
ON "ChaveApiParceiro"("segredoHash");

CREATE INDEX "ChaveApiParceiro_organizacaoId_criadaEm_idx"
ON "ChaveApiParceiro"("organizacaoId", "criadaEm");

CREATE INDEX "ChaveApiParceiro_organizacaoId_revogadaEm_expiraEm_idx"
ON "ChaveApiParceiro"("organizacaoId", "revogadaEm", "expiraEm");

ALTER TABLE "ChaveApiParceiro"
ADD CONSTRAINT "ChaveApiParceiro_organizacaoId_fkey"
FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

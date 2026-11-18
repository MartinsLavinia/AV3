-- CreateEnum
CREATE TYPE "TipoEventoTriagem" AS ENUM ('INICIADA', 'CONCLUIDA');

-- CreateTable
CREATE TABLE "TriagemEvento" (
    "id" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "tipo" "TipoEventoTriagem" NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsavel" TEXT NOT NULL,

    CONSTRAINT "TriagemEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TriagemEvento_equipamentoId_dataHora_idx" ON "TriagemEvento"("equipamentoId", "dataHora");
CREATE INDEX "TriagemEvento_tipo_dataHora_idx" ON "TriagemEvento"("tipo", "dataHora");
CREATE INDEX "TriagemEvento_responsavel_dataHora_idx" ON "TriagemEvento"("responsavel", "dataHora");

-- AddForeignKey
ALTER TABLE "TriagemEvento" ADD CONSTRAINT "TriagemEvento_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

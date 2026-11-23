-- Registra solicitações públicas assíncronas e garante execução analítica idempotente.
CREATE TYPE "StatusTarefaAnalitica" AS ENUM ('AGUARDANDO', 'PROCESSANDO', 'CONCLUIDA', 'FALHA');

CREATE TABLE "TarefaAnalitica" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "chaveApiId" UUID NOT NULL,
    "tipo" "TipoRelatorioAnalitico" NOT NULL,
    "status" "StatusTarefaAnalitica" NOT NULL DEFAULT 'AGUARDANDO',
    "chaveIdempotencia" TEXT NOT NULL,
    "hashRequisicao" TEXT NOT NULL,
    "parametros" JSONB,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadaEm" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    CONSTRAINT "TarefaAnalitica_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TarefaAnalitica_organizacaoId_chaveIdempotencia_key" ON "TarefaAnalitica"("organizacaoId", "chaveIdempotencia");
CREATE INDEX "TarefaAnalitica_organizacaoId_criadaEm_idx" ON "TarefaAnalitica"("organizacaoId", "criadaEm");
CREATE INDEX "TarefaAnalitica_status_criadaEm_idx" ON "TarefaAnalitica"("status", "criadaEm");
ALTER TABLE "ExecucaoAnalitica" ADD COLUMN "tarefaId" UUID;
ALTER TABLE "TarefaAnalitica" ADD CONSTRAINT "TarefaAnalitica_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TarefaAnalitica" ADD CONSTRAINT "TarefaAnalitica_chaveApiId_fkey" FOREIGN KEY ("chaveApiId") REFERENCES "ChaveApiParceiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecucaoAnalitica" ADD CONSTRAINT "ExecucaoAnalitica_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "TarefaAnalitica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ExecucaoAnalitica_tarefaId_key" ON "ExecucaoAnalitica"("tarefaId");

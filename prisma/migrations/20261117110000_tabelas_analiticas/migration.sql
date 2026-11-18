-- CreateEnum
CREATE TYPE "TipoRelatorioAnalitico" AS ENUM (
    'EFICIENCIA_OPERACIONAL',
    'VALOR_RECUPERACAO',
    'VIDA_UTIL_REMANESCENTE'
);

-- CreateTable
CREATE TABLE "HistoricoEstadoFisico" (
    "id" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "estadoAnterior" "EstadoFisico" NOT NULL,
    "estadoNovo" "EstadoFisico" NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsavel" TEXT NOT NULL,
    "justificativa" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "HistoricoEstadoFisico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenciaRecuperacao" (
    "id" UUID NOT NULL,
    "grupoId" UUID NOT NULL,
    "tipo" "TipoEquipamento" NOT NULL,
    "estadoFisico" "EstadoFisico" NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "valorEstimado" DECIMAL(12,2) NOT NULL,
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "fonte" TEXT NOT NULL,
    "justificativa" TEXT NOT NULL,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteAte" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,
    "criadaPor" TEXT,
    CONSTRAINT "ReferenciaRecuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecucaoAnalitica" (
    "id" UUID NOT NULL,
    "tipo" "TipoRelatorioAnalitico" NOT NULL,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodoInicio" TIMESTAMP(3),
    "periodoFim" TIMESTAMP(3),
    "quantidadeAmostras" INTEGER NOT NULL DEFAULT 0,
    "versaoAlgoritmo" TEXT NOT NULL,
    "parametros" JSONB,
    "resultado" JSONB NOT NULL,
    "referenciasUsadas" JSONB,
    "solicitadoPor" TEXT,
    CONSTRAINT "ExecucaoAnalitica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricoEstadoFisico_equipamentoId_dataHora_idx" ON "HistoricoEstadoFisico"("equipamentoId", "dataHora");
CREATE INDEX "HistoricoEstadoFisico_estadoNovo_dataHora_idx" ON "HistoricoEstadoFisico"("estadoNovo", "dataHora");
CREATE INDEX "HistoricoEstadoFisico_responsavel_dataHora_idx" ON "HistoricoEstadoFisico"("responsavel", "dataHora");
CREATE INDEX "ReferenciaRecuperacao_tipo_estadoFisico_ativa_idx" ON "ReferenciaRecuperacao"("tipo", "estadoFisico", "ativa");
CREATE INDEX "ReferenciaRecuperacao_marca_modelo_ativa_idx" ON "ReferenciaRecuperacao"("marca", "modelo", "ativa");
CREATE INDEX "ReferenciaRecuperacao_vigenteDesde_vigenteAte_idx" ON "ReferenciaRecuperacao"("vigenteDesde", "vigenteAte");
CREATE UNIQUE INDEX "ReferenciaRecuperacao_grupoId_versao_key" ON "ReferenciaRecuperacao"("grupoId", "versao");
CREATE INDEX "ExecucaoAnalitica_tipo_geradoEm_idx" ON "ExecucaoAnalitica"("tipo", "geradoEm");
CREATE INDEX "ExecucaoAnalitica_periodoInicio_periodoFim_idx" ON "ExecucaoAnalitica"("periodoInicio", "periodoFim");

-- AddForeignKey
ALTER TABLE "HistoricoEstadoFisico"
ADD CONSTRAINT "HistoricoEstadoFisico_equipamentoId_fkey"
FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

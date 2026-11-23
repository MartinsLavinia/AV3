import type { FastifyInstance, RouteShorthandOptions } from "fastify";
import { EscopoChaveApi } from "../generated/prisma/enums.js";
import { permitirChaveApiParceiro } from "../plugins/apiParceiro.js";
import { ApiParceiroController } from "../controllers/ApiParceiroController.js";

const schemaErro = {
  type: "object", properties: { mensagem: { type: "string" } }, required: ["mensagem"],
  examples: [{ mensagem: "Requisição inválida." }],
} as const;
const schemaRateLimit = {
  type: "object", properties: { statusCode: { type: "integer", example: 429 }, error: { type: "string", example: "Too Many Requests" }, message: { type: "string", example: "Rate limit exceeded, retry in 1 minute" } },
  required: ["statusCode", "error", "message"],
  examples: [{ statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded, retry in 1 minute" }],
} as const;

function schemaResposta(exemplo: Record<string, unknown>) {
  return { type: "object", additionalProperties: true, examples: [exemplo] } as const;
}

const schemaResultadoPendente = {
  type: "object",
  properties: {
    mensagem: { type: "string", example: "O relatório ainda não está disponível." },
    status: { type: "string", enum: ["AGUARDANDO", "PROCESSANDO", "FALHA"] },
  },
  required: ["mensagem", "status"],
  examples: [{ mensagem: "O relatório ainda não está disponível.", status: "PROCESSANDO" }],
} as const;

function opcoesPublicas(escopo: EscopoChaveApi, descricao: string, schema: Record<string, unknown>): RouteShorthandOptions {
  const respostaSucesso = (schema.response ?? {}) as Record<string, unknown>;
  return {
    schema: {
      ...schema, tags: ["Parceiros v1"],
      description: `${descricao} A resposta é sempre limitada à organização vinculada à chave.`,
      security: [{ apiKeyAuth: [] }],
      response: { ...respostaSucesso, 400: schemaErro, 401: schemaErro, 403: schemaErro, 404: schemaErro, 429: schemaRateLimit, 500: schemaErro },
    },
    preHandler: permitirChaveApiParceiro(escopo),
  };
}

const schemaTarefa = {
  type: "object", additionalProperties: false, required: ["tipo"],
  properties: {
    tipo: { type: "string", enum: ["EFICIENCIA_OPERACIONAL", "VALOR_RECUPERACAO", "VIDA_UTIL_REMANESCENTE"] },
    filtros: {
      type: "object", additionalProperties: false,
      properties: {
        dataInicio: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)?$" },
        dataFim: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)?$" },
      },
    },
  },
  examples: [
    { tipo: "EFICIENCIA_OPERACIONAL", filtros: { dataInicio: "2026-11-01", dataFim: "2026-11-30" } },
    { tipo: "VALOR_RECUPERACAO" },
  ],
} as const;

export async function apiParceiroRoutes(app: FastifyInstance) {
  const controller = new ApiParceiroController();
  app.get("/equipamentos/:identificador/rastreamento", opcoesPublicas(EscopoChaveApi.RASTREAMENTO_LEITURA,
    "Consulta rastreamento e movimentações de equipamento por UUID ou código de barras.", {
      summary: "Consultar rastreamento de equipamento",
      params: { type: "object", additionalProperties: false, required: ["identificador"], properties: { identificador: { type: "string", minLength: 1, maxLength: 120 } } },
      response: { 200: schemaResposta({
        id: "6f660e04-98ab-4b54-9c5f-618b05c609ef", codigoBarrasInterno: "GC-2026-0001", tipo: "NOTEBOOK",
        marca: "Dell", modelo: "Latitude", anoFabricacao: 2022, estadoFisico: "USADO_LEVE", pesoQuilogramas: 2.4,
        loteId: "6a5af315-eaa2-4b86-bddb-8740a0d8589c", posicaoNoLote: 1, statusRastreamento: "EM_DESMONTE", versao: 3,
        lote: { id: "6a5af315-eaa2-4b86-bddb-8740a0d8589c", notaFiscal: "NF-2026-001", dataEntrada: "2026-11-01T12:00:00.000Z", organizacaoId: "784fe42a-35c2-44c0-beb9-2b4823aefb3c" },
        movimentacoes: [{ id: "226e81bb-5918-4e65-8cca-33406845e907", equipamentoId: "6f660e04-98ab-4b54-9c5f-618b05c609ef", dataHora: "2026-11-02T12:00:00.000Z", origem: "TRIAGEM", destino: "EM_DESMONTE", responsavel: "gestor@greencode.local", observacao: "Triagem concluída", versao: 1 }],
      }), 400: schemaErro, 401: schemaErro, 403: schemaErro, 404: schemaErro, 429: schemaRateLimit, 500: schemaErro },
    }), controller.rastrearEquipamento);

  app.post("/lotes", opcoesPublicas(EscopoChaveApi.LOTES_CRIACAO,
    "Submete lote para a organização vinculada à chave; organizacaoId fornecido pelo parceiro é ignorado.", {
      summary: "Submeter lote para a própria organização",
      body: { type: "object", additionalProperties: false, required: ["notaFiscal", "transportadora"], properties: {
        notaFiscal: { type: "string", minLength: 1, maxLength: 120 }, transportadora: { type: "string", minLength: 1, maxLength: 120 },
        dataEntrada: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T.*)?$" }, observacoes: { type: "string", maxLength: 2000 },
      }, examples: [{ notaFiscal: "NF-2026-001", transportadora: "Transportadora Exemplo", dataEntrada: "2026-11-20", observacoes: "Coleta do mês" }] },
      response: { 201: schemaResposta({
        id: "6a5af315-eaa2-4b86-bddb-8740a0d8589c", dataEntrada: "2026-11-01T12:00:00.000Z",
        organizacaoId: "784fe42a-35c2-44c0-beb9-2b4823aefb3c", notaFiscal: "NF-2026-001", transportadora: "Transportadora Exemplo",
        statusProcessamento: "RECEBIDO", observacoes: "Coleta do mês", versao: 1, equipamentos: [],
      }), 400: schemaErro, 401: schemaErro, 403: schemaErro, 404: schemaErro, 409: schemaErro, 429: schemaRateLimit, 500: schemaErro },
    }), controller.criarLote);

  app.post("/relatorios", opcoesPublicas(EscopoChaveApi.RELATORIOS_LEITURA,
    "Enfileira a geração de relatório limitado aos dados da organização da chave. Idempotency-Key torna reenvios seguros; use os endereços retornados para consultar status e resultado.", {
      summary: "Solicitar relatório analítico assíncrono",
      headers: { type: "object", required: ["Idempotency-Key"], properties: { "Idempotency-Key": { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" } } },
      body: schemaTarefa,
      response: { 202: schemaResposta({
        tarefaId: "187e160d-5e40-48e2-92c4-775b49390f6b", tipo: "EFICIENCIA_OPERACIONAL", status: "AGUARDANDO",
        criadaEm: "2026-11-23T15:00:00.000Z", repetida: false,
        consultarStatus: "/api/v1/public/relatorios/tarefas/187e160d-5e40-48e2-92c4-775b49390f6b",
        consultarResultado: "/api/v1/public/relatorios/tarefas/187e160d-5e40-48e2-92c4-775b49390f6b/resultado",
      }), 400: schemaErro, 401: schemaErro, 403: schemaErro, 409: schemaErro, 429: schemaRateLimit, 500: schemaErro },
    }), controller.solicitarRelatorio);

  const paramsId = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
  app.get("/relatorios/tarefas/:id", opcoesPublicas(EscopoChaveApi.RELATORIOS_LEITURA,
    "Consulta status de tarefa analítica pertencente à organização vinculada à chave.", {
      summary: "Consultar status da tarefa", params: paramsId,
      response: { 200: schemaResposta({
        tarefaId: "187e160d-5e40-48e2-92c4-775b49390f6b", tipo: "EFICIENCIA_OPERACIONAL", status: "CONCLUIDA",
        criadaEm: "2026-11-23T15:00:00.000Z", iniciadaEm: "2026-11-23T15:00:01.000Z", concluidaEm: "2026-11-23T15:00:03.000Z",
        tentativas: 1, erro: null, execucaoAnaliticaId: "2eaa2307-6c5d-4d1d-aa30-0189a4d37ce8",
      }), 401: schemaErro, 403: schemaErro, 404: schemaErro, 429: schemaRateLimit, 500: schemaErro },
    }), controller.consultarTarefa);

  app.get("/relatorios/tarefas/:id/resultado", opcoesPublicas(EscopoChaveApi.RELATORIOS_LEITURA,
    "Retorna o snapshot persistido após a conclusão da tarefa, sempre dentro do escopo da organização da chave.", {
      summary: "Consultar resultado da tarefa", params: paramsId,
      response: { 200: schemaResposta({
        tarefaId: "187e160d-5e40-48e2-92c4-775b49390f6b", execucaoAnaliticaId: "2eaa2307-6c5d-4d1d-aa30-0189a4d37ce8",
        geradoEm: "2026-11-23T15:00:03.000Z", resultado: {
          geradoEm: "2026-11-23T15:00:03.000Z", criterio: "Duração entre entrada do lote e a conclusão da triagem.",
          resumo: { lotesConcluidos: 8, tempoMedioHoras: 22.4, tempoMedianoHoras: 20.1, desvioPadraoPopulacionalHoras: 6.2 },
          porOperador: [], porPeriodo: [], lotes: [],
        },
      }), 401: schemaErro, 403: schemaErro, 404: schemaErro, 409: schemaResultadoPendente, 429: schemaRateLimit, 500: schemaErro },
    }), controller.consultarResultado);
}

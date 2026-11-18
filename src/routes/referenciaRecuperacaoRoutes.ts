import type { FastifyInstance } from "fastify";
import { EstadoFisico, PapelUsuario, TipoEquipamento } from "../generated/prisma/enums.js";
import { permitirPapeis } from "../plugins/jwt.js";
import { ReferenciaRecuperacaoController } from "../controllers/ReferenciaRecuperacaoController.js";

const schemaId = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" } },
} as const;

const schemaCriacao = {
  type: "object",
  additionalProperties: false,
  required: ["tipo", "estadoFisico", "valorEstimado", "fonte", "justificativa"],
  properties: {
    tipo: { type: "string", enum: Object.values(TipoEquipamento) },
    estadoFisico: { type: "string", enum: Object.values(EstadoFisico) },
    marca: { type: "string", maxLength: 120 },
    modelo: { type: "string", maxLength: 120 },
    valorEstimado: { type: "number", minimum: 0, maximum: 9_999_999_999.99 },
    moeda: { type: "string", pattern: "^[A-Za-z]{3}$" },
    fonte: { type: "string", minLength: 1, maxLength: 500 },
    justificativa: { type: "string", minLength: 1, maxLength: 2000 },
  },
} as const;

const schemaRevisao = {
  type: "object",
  additionalProperties: false,
  required: ["versao", "valorEstimado", "fonte", "justificativa"],
  properties: {
    versao: { type: "integer", minimum: 1 },
    valorEstimado: { type: "number", minimum: 0, maximum: 9_999_999_999.99 },
    moeda: { type: "string", pattern: "^[A-Za-z]{3}$" },
    fonte: { type: "string", minLength: 1, maxLength: 500 },
    justificativa: { type: "string", minLength: 1, maxLength: 2000 },
  },
} as const;

const schemaEncerramento = {
  type: "object",
  additionalProperties: false,
  required: ["versao", "motivo"],
  properties: {
    versao: { type: "integer", minimum: 1 },
    motivo: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

export async function referenciaRecuperacaoRoutes(app: FastifyInstance) {
  const controller = new ReferenciaRecuperacaoController();
  const somenteAdministrador = permitirPapeis(PapelUsuario.ADMINISTRADOR);

  app.get("/referencias-recuperacao", { preHandler: somenteAdministrador }, controller.listar);
  app.post("/referencias-recuperacao", { schema: { body: schemaCriacao }, preHandler: somenteAdministrador }, controller.criar);
  app.post("/referencias-recuperacao/:id/revisoes", {
    schema: { params: schemaId, body: schemaRevisao },
    preHandler: somenteAdministrador,
  }, controller.revisar);
  app.post("/referencias-recuperacao/:id/encerrar", {
    schema: { params: schemaId, body: schemaEncerramento },
    preHandler: somenteAdministrador,
  }, controller.encerrar);
}

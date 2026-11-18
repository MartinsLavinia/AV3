import type { FastifyInstance } from "fastify";
import { PapelUsuario } from "../generated/prisma/enums.js";
import { HistoricoAnaliticoController } from "../controllers/HistoricoAnaliticoController.js";
import { permitirPapeis } from "../plugins/jwt.js";

const schemaLista = {
  type: "object",
  additionalProperties: false,
  properties: {
    tipo: { type: "string", enum: ["EFICIENCIA_OPERACIONAL", "VALOR_RECUPERACAO", "VIDA_UTIL_REMANESCENTE"] },
    dataInicio: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)?$" },
    dataFim: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)?$" },
    pagina: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", pattern: "^[1-9]\\d*$" }] },
    limite: { anyOf: [{ type: "integer", minimum: 1, maximum: 100 }, { type: "string", pattern: "^[1-9]\\d*$" }] },
  },
} as const;

const schemaId = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" } },
} as const;

export async function historicoAnaliticoRoutes(app: FastifyInstance) {
  const controller = new HistoricoAnaliticoController();
  const somenteAuditor = { preHandler: permitirPapeis(PapelUsuario.AUDITOR) };
  app.get("/analises/execucoes", { ...somenteAuditor, schema: { querystring: schemaLista } }, controller.listar);
  app.get("/analises/execucoes/:id", { ...somenteAuditor, schema: { params: schemaId } }, controller.obter);
}

import type { FastifyInstance } from "fastify";
import { PapelUsuario } from "../generated/prisma/enums.js";
import { AnaliseOperacionalController } from "../controllers/AnaliseOperacionalController.js";
import { permitirPapeis } from "../plugins/jwt.js";

const schemaConsulta = {
  type: "object",
  additionalProperties: false,
  properties: {
    dataInicio: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)?$" },
    dataFim: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)?$" },
  },
} as const;

export async function analiseOperacionalRoutes(app: FastifyInstance) {
  const controller = new AnaliseOperacionalController();
  app.get("/analises/eficiencia-operacional", {
    schema: { querystring: schemaConsulta },
    preHandler: permitirPapeis(PapelUsuario.AUDITOR),
  }, controller.gerarRelatorio);
}

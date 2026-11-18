import type { FastifyInstance } from "fastify";
import { PapelUsuario } from "../generated/prisma/enums.js";
import { AnaliseVidaUtilController } from "../controllers/AnaliseVidaUtilController.js";
import { permitirPapeis } from "../plugins/jwt.js";

export async function analiseVidaUtilRoutes(app: FastifyInstance) {
  const controller = new AnaliseVidaUtilController();
  app.get("/analises/vida-util-remanescente", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {} } },
    preHandler: permitirPapeis(PapelUsuario.AUDITOR),
  }, controller.gerarRelatorio);
}

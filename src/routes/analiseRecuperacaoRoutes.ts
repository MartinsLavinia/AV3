import type { FastifyInstance } from "fastify";
import { PapelUsuario } from "../generated/prisma/enums.js";
import { AnaliseRecuperacaoController } from "../controllers/AnaliseRecuperacaoController.js";
import { permitirPapeis } from "../plugins/jwt.js";

export async function analiseRecuperacaoRoutes(app: FastifyInstance) {
  const controller = new AnaliseRecuperacaoController();
  app.get("/analises/valor-recuperacao", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {} } },
    preHandler: permitirPapeis(PapelUsuario.AUDITOR),
  }, controller.gerarRelatorio);
}

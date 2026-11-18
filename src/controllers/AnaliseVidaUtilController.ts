import type { FastifyReply, FastifyRequest } from "fastify";
import { AnaliseVidaUtilService } from "../services/AnaliseVidaUtilService.js";

export class AnaliseVidaUtilController {
  constructor(private readonly analises = new AnaliseVidaUtilService()) {}

  gerarRelatorio = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.code(200).send(await this.analises.gerarRelatorio(request.user.email));
    } catch (erro) {
      request.log.error(erro);
      return reply.code(500).send({ mensagem: "Não foi possível gerar a análise de vida útil remanescente." });
    }
  };
}

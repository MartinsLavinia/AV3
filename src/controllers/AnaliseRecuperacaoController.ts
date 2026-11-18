import type { FastifyReply, FastifyRequest } from "fastify";
import { AnaliseRecuperacaoService } from "../services/AnaliseRecuperacaoService.js";

export class AnaliseRecuperacaoController {
  constructor(private readonly analises = new AnaliseRecuperacaoService()) {}

  gerarRelatorio = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.code(200).send(await this.analises.gerarRelatorio(request.user.email));
    } catch (erro) {
      request.log.error(erro);
      return reply.code(500).send({ mensagem: "Não foi possível gerar a análise de valor estimado de recuperação." });
    }
  };
}

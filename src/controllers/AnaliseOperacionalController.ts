import type { FastifyReply, FastifyRequest } from "fastify";
import { AnaliseOperacionalService, ErroValidacaoAnaliseOperacional } from "../services/AnaliseOperacionalService.js";

export class AnaliseOperacionalController {
  constructor(private readonly analises = new AnaliseOperacionalService()) {}

  gerarRelatorio = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const resultado = await this.analises.gerarRelatorio(request.query as Record<string, unknown>, request.user.email);
      return reply.code(200).send(resultado);
    } catch (erro) {
      if (erro instanceof ErroValidacaoAnaliseOperacional) return reply.code(400).send({ mensagem: erro.message });
      request.log.error(erro);
      return reply.code(500).send({ mensagem: "Não foi possível gerar a análise operacional." });
    }
  };
}

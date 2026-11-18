import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ErroValidacaoHistoricoAnalitico,
  ExecucaoAnaliticaNaoEncontradaError,
  HistoricoAnaliticoService,
} from "../services/HistoricoAnaliticoService.js";

export class HistoricoAnaliticoController {
  constructor(private readonly historico = new HistoricoAnaliticoService()) {}

  listar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.code(200).send(await this.historico.listar(request.query as Record<string, unknown>));
    } catch (erro) {
      if (erro instanceof ErroValidacaoHistoricoAnalitico) return reply.code(400).send({ mensagem: erro.message });
      request.log.error(erro);
      return reply.code(500).send({ mensagem: "Não foi possível consultar o histórico analítico." });
    }
  };

  obter = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      return reply.code(200).send(await this.historico.obter(id));
    } catch (erro) {
      if (erro instanceof ErroValidacaoHistoricoAnalitico) return reply.code(400).send({ mensagem: erro.message });
      if (erro instanceof ExecucaoAnaliticaNaoEncontradaError) return reply.code(404).send({ mensagem: "Execução analítica não encontrada." });
      request.log.error(erro);
      return reply.code(500).send({ mensagem: "Não foi possível consultar a execução analítica." });
    }
  };
}

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CriterioReferenciaAtivoDuplicadoError,
  ErroValidacaoReferencia,
  ReferenciaRecuperacaoNaoEncontradaError,
  ReferenciaRecuperacaoService,
  VersaoReferenciaRecuperacaoConflitanteError,
  type DadosCriacaoReferencia,
  type DadosEncerramentoReferencia,
  type DadosRevisaoReferencia,
} from "../services/ReferenciaRecuperacaoService.js";

export class ReferenciaRecuperacaoController {
  constructor(private readonly referencias = new ReferenciaRecuperacaoService()) {}

  listar = async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.code(200).send({ referencias: await this.referencias.listar() });
    } catch (erro) {
      _request.log.error(erro);
      return reply.code(500).send({ mensagem: "Não foi possível listar as referências de recuperação." });
    }
  };

  criar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const referencia = await this.referencias.criar(request.body as DadosCriacaoReferencia, request.user.email);
      return reply.code(201).send({ mensagem: "Referência de recuperação cadastrada.", referencia });
    } catch (erro) {
      return this.responderErro(request, reply, erro, "cadastrar a referência");
    }
  };

  revisar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const resultado = await this.referencias.revisar(id, request.body as DadosRevisaoReferencia, request.user.email);
      return reply.code(201).send({ mensagem: "Nova versão da referência criada.", ...resultado });
    } catch (erro) {
      return this.responderErro(request, reply, erro, "revisar a referência");
    }
  };

  encerrar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const referencia = await this.referencias.encerrar(id, request.body as DadosEncerramentoReferencia, request.user.email);
      return reply.code(200).send({ mensagem: "Referência encerrada sem exclusão do histórico.", referencia });
    } catch (erro) {
      return this.responderErro(request, reply, erro, "encerrar a referência");
    }
  };

  private responderErro(request: FastifyRequest, reply: FastifyReply, erro: unknown, operacao: string) {
    if (erro instanceof ErroValidacaoReferencia) return reply.code(400).send({ mensagem: erro.message });
    if (erro instanceof ReferenciaRecuperacaoNaoEncontradaError) return reply.code(404).send({ mensagem: "Referência de recuperação não encontrada." });
    if (erro instanceof VersaoReferenciaRecuperacaoConflitanteError) return reply.code(409).send({ mensagem: "A referência foi alterada ou encerrada. Consulte o catálogo e tente novamente com a versão ativa." });
    if (erro instanceof CriterioReferenciaAtivoDuplicadoError) return reply.code(409).send({ mensagem: "Já existe uma referência ativa para este tipo, estado físico, marca e modelo." });
    request.log.error(erro, `Falha ao ${operacao}.`);
    return reply.code(500).send({ mensagem: `Não foi possível ${operacao}.` });
  }
}

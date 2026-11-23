import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ChaveApiParceiroService,
  ChaveApiJaRevogadaError,
  ChaveApiNaoEncontradaError,
  ErroValidacaoChaveApi,
  OrganizacaoChaveApiInativaError,
  OrganizacaoChaveApiNaoEncontradaError,
  type DadosNovaChaveApi,
  type DadosRenovacaoChaveApi,
} from "../services/ChaveApiParceiroService.js";

export class ChaveApiParceiroController {
  constructor(private readonly chaves = new ChaveApiParceiroService()) {}

  listar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { organizacaoId } = request.query as { organizacaoId?: string };
      return reply.code(200).send({ chaves: await this.chaves.listar(organizacaoId) });
    } catch (erro) {
      return this.responderErro(request, reply, erro, "listar as chaves");
    }
  };

  criar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { organizacaoId } = request.params as { organizacaoId: string };
      const criada = await this.chaves.criar(organizacaoId, request.body as DadosNovaChaveApi, request.user.email);
      return reply.code(201).send({ mensagem: "Chave de API criada.", ...criada });
    } catch (erro) {
      return this.responderErro(request, reply, erro, "criar a chave");
    }
  };

  revogar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { motivo } = request.body as { motivo: unknown };
      const resultado = await this.chaves.revogar(id, motivo, request.user.email);
      return reply.code(200).send({ mensagem: "Chave de API revogada.", chave: resultado });
    } catch (erro) {
      return this.responderErro(request, reply, erro, "revogar a chave");
    }
  };

  renovar = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const renovada = await this.chaves.renovar(id, request.body as DadosRenovacaoChaveApi, request.user.email);
      return reply.code(201).send({ mensagem: "Chave de API renovada.", ...renovada });
    } catch (erro) {
      return this.responderErro(request, reply, erro, "renovar a chave");
    }
  };

  private responderErro(request: FastifyRequest, reply: FastifyReply, erro: unknown, operacao: string) {
    if (erro instanceof ErroValidacaoChaveApi) return reply.code(400).send({ mensagem: erro.message });
    if (erro instanceof OrganizacaoChaveApiNaoEncontradaError) return reply.code(404).send({ mensagem: "Organização não encontrada." });
    if (erro instanceof OrganizacaoChaveApiInativaError) return reply.code(409).send({ mensagem: "Não é possível criar chaves para uma organização inativa." });
    if (erro instanceof ChaveApiNaoEncontradaError) return reply.code(404).send({ mensagem: "Chave de API não encontrada." });
    if (erro instanceof ChaveApiJaRevogadaError) return reply.code(409).send({ mensagem: "A chave já foi revogada ou substituída." });
    request.log.error(erro, `Falha ao ${operacao}.`);
    return reply.code(500).send({ mensagem: `Não foi possível ${operacao}.` });
  }
}

import type { FastifyReply, FastifyRequest } from "fastify";
import { EscopoChaveApi } from "../generated/prisma/enums.js";
import { AutenticacaoChaveApiParceiroService } from "../services/AutenticacaoChaveApiParceiroService.js";

const autenticacao = new AutenticacaoChaveApiParceiroService();

export function permitirChaveApiParceiro(escopo: EscopoChaveApi) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const identidade = await autenticacao.autenticar(request.headers["x-api-key"]);
      if (!identidade) return reply.code(401).send({ mensagem: "Chave de API ausente, inválida, expirada ou revogada." });
      if (!identidade.permissoes.includes(escopo)) {
        return reply.code(403).send({ mensagem: "A chave não possui permissão para esta operação." });
      }
      if (!(await autenticacao.registrarUtilizacao(identidade.chaveId))) {
        return reply.code(401).send({ mensagem: "Chave de API ausente, inválida, expirada ou revogada." });
      }
      request.apiParceiro = identidade;
    } catch (erro) {
      request.log.error(erro, "Falha ao autenticar chave de API parceira.");
      return reply.code(500).send({ mensagem: "Não foi possível autenticar a integração parceira." });
    }
  };
}

export function chaveParaRateLimit(request: FastifyRequest) {
  const valor = request.headers["x-api-key"];
  if (typeof valor === "string") {
    const id = /^gc_live_([0-9a-f-]{36})\./i.exec(valor)?.[1];
    if (id) return `api-key:${id.toLowerCase()}`;
  }
  return `ip:${request.ip}`;
}

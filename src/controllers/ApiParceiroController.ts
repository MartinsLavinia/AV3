import type { FastifyReply, FastifyRequest } from "fastify";
import {
  AuditoriaService,
  EquipamentoRastreadoNaoEncontradoError,
  ErroValidacaoAuditoria,
} from "../services/AuditoriaService.js";
import {
  ErroValidacaoLote,
  LoteService,
  OrganizacaoDoLoteInativaError,
  OrganizacaoDoLoteNaoEncontradaError,
  type DadosNovoLote,
} from "../services/LoteService.js";
import { ChaveIdempotenciaConflitanteError, ErroValidacaoTarefaAnalitica, TarefaAnaliticaService } from "../services/TarefaAnaliticaService.js";

export class ApiParceiroController {
  constructor(
    private readonly auditoria = new AuditoriaService(),
    private readonly lotes = new LoteService(),
    private readonly tarefas = new TarefaAnaliticaService(),
  ) {}

  rastrearEquipamento = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { identificador } = request.params as { identificador: string };
      const { organizacaoId } = this.identidade(request);
      const equipamento = await this.auditoria.rastrearEquipamento(identificador, organizacaoId);
      return reply.code(200).send(equipamento);
    } catch (erro) {
      if (erro instanceof ErroValidacaoAuditoria) return reply.code(400).send({ mensagem: erro.message });
      if (erro instanceof EquipamentoRastreadoNaoEncontradoError) return reply.code(404).send({ mensagem: "Equipamento não encontrado." });
      return this.erroInterno(request, reply, erro, "rastrear o equipamento");
    }
  };

  criarLote = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { organizacaoId } = this.identidade(request);
      const dados = { ...(request.body as Omit<DadosNovoLote, "organizacaoId">), organizacaoId } as DadosNovoLote;
      const lote = await this.lotes.criar(dados);
      return reply.code(201).send(lote);
    } catch (erro) {
      if (erro instanceof ErroValidacaoLote) return reply.code(400).send({ mensagem: erro.message });
      if (erro instanceof OrganizacaoDoLoteNaoEncontradaError) return reply.code(404).send({ mensagem: "Organização vinculada à chave não encontrada." });
      if (erro instanceof OrganizacaoDoLoteInativaError) return reply.code(409).send({ mensagem: "A organização vinculada à chave está inativa." });
      return this.erroInterno(request, reply, erro, "cadastrar o lote");
    }
  };

  solicitarRelatorio = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { chaveId, organizacaoId } = this.identidade(request);
      const chave = request.headers["idempotency-key"];
      if (typeof chave !== "string" || chave.length < 8 || chave.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(chave)) {
        return reply.code(400).send({ mensagem: "Informe Idempotency-Key (8 a 128 caracteres alfanuméricos, ponto, hífen, sublinhado ou dois-pontos)." });
      }
      const pedido = request.body as import("../services/TarefaAnaliticaService.js").PedidoRelatorioParceiro;
      const { tarefa, repetida } = await this.tarefas.solicitar(pedido, organizacaoId, chaveId, chave);
      return reply.code(202).send({
        tarefaId: tarefa.id,
        tipo: tarefa.tipo,
        status: tarefa.status,
        criadaEm: tarefa.criadaEm,
        repetida,
        consultarStatus: `/api/v1/public/relatorios/tarefas/${tarefa.id}`,
        consultarResultado: `/api/v1/public/relatorios/tarefas/${tarefa.id}/resultado`,
      });
    } catch (erro) {
      if (erro instanceof ErroValidacaoTarefaAnalitica) return reply.code(400).send({ mensagem: erro.message });
      if (erro instanceof ChaveIdempotenciaConflitanteError) return reply.code(409).send({ mensagem: "Idempotency-Key já utilizada com parâmetros diferentes." });
      return this.erroInterno(request, reply, erro, "enfileirar o relatório");
    }
  };

  consultarTarefa = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { organizacaoId } = this.identidade(request);
      const { id } = request.params as { id: string };
      const tarefa = await this.tarefas.consultar(id, organizacaoId);
      if (!tarefa) return reply.code(404).send({ mensagem: "Tarefa analítica não encontrada." });
      return reply.code(200).send({
        tarefaId: tarefa.id, tipo: tarefa.tipo, status: tarefa.status,
        criadaEm: tarefa.criadaEm, iniciadaEm: tarefa.iniciadaEm, concluidaEm: tarefa.concluidaEm,
        tentativas: tarefa.tentativas, erro: tarefa.status === "FALHA" ? tarefa.erro : null,
        execucaoAnaliticaId: tarefa.execucao?.id ?? null,
      });
    } catch (erro) {
      return this.erroInterno(request, reply, erro, "consultar a tarefa analítica");
    }
  };

  consultarResultado = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { organizacaoId } = this.identidade(request);
      const { id } = request.params as { id: string };
      const tarefa = await this.tarefas.consultar(id, organizacaoId);
      if (!tarefa) return reply.code(404).send({ mensagem: "Tarefa analítica não encontrada." });
      if (tarefa.status !== "CONCLUIDA" || !tarefa.execucao) return reply.code(409).send({ mensagem: "O relatório ainda não está disponível.", status: tarefa.status });
      return reply.code(200).send({ tarefaId: tarefa.id, execucaoAnaliticaId: tarefa.execucao.id, resultado: tarefa.execucao.resultado, geradoEm: tarefa.execucao.geradoEm });
    } catch (erro) {
      return this.erroInterno(request, reply, erro, "consultar o resultado do relatório");
    }
  };

  private identidade(request: FastifyRequest) {
    if (!request.apiParceiro) throw new Error("Middleware de chave de parceiro não executado.");
    return request.apiParceiro;
  }

  private erroInterno(request: FastifyRequest, reply: FastifyReply, erro: unknown, operacao: string) {
    request.log.error(erro, `Falha ao ${operacao} pela API pública.`);
    return reply.code(500).send({ mensagem: `Não foi possível ${operacao}.` });
  }
}

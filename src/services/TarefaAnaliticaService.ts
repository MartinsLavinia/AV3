import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { TipoRelatorioAnalitico } from "../generated/prisma/enums.js";
import { filaAnalitica } from "../infrastructure/filaAnalitica.js";
import { TarefaAnaliticaRepository, type CriarTarefaAnalitica } from "../repositories/TarefaAnaliticaRepository.js";

export type PedidoRelatorioParceiro = {
  tipo: TipoRelatorioAnalitico;
  filtros?: { dataInicio?: string; dataFim?: string };
};

export class TarefaAnaliticaService {
  constructor(private readonly tarefas = new TarefaAnaliticaRepository()) {}

  async solicitar(pedido: PedidoRelatorioParceiro, organizacaoId: string, chaveApiId: string, idempotencyKey: string) {
    validarPedido(pedido);
    const normalizado = { tipo: pedido.tipo, filtros: pedido.tipo === TipoRelatorioAnalitico.EFICIENCIA_OPERACIONAL ? (pedido.filtros ?? {}) : {} };
    const hashRequisicao = createHash("sha256").update(JSON.stringify(normalizado)).digest("hex");
    const existente = await this.tarefas.buscarPorIdempotencia(organizacaoId, idempotencyKey);
    if (existente) {
      if (existente.hashRequisicao !== hashRequisicao) throw new ChaveIdempotenciaConflitanteError();
      const filaAtual = await filaAnalitica.getJob(existente.id);
      if (existente.status === "FALHA") throw new ErroValidacaoTarefaAnalitica("Esta solicitação já falhou; use uma nova Idempotency-Key para tentar novamente.");
      if (existente.status !== "CONCLUIDA" && !filaAtual) await garantirJob(existente.id, existente.hashRequisicao);
      return { tarefa: existente, repetida: true };
    }

    const id = randomUUID();
    const dados: CriarTarefaAnalitica = {
      id, organizacaoId, chaveApiId, tipo: pedido.tipo,
      chaveIdempotencia: idempotencyKey, hashRequisicao,
      parametros: normalizado as Prisma.InputJsonValue,
    };
    let tarefa;
    try {
      tarefa = await this.tarefas.criar(dados);
    } catch (erro) {
      if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== "P2002") throw erro;
      tarefa = await this.tarefas.buscarPorIdempotencia(organizacaoId, idempotencyKey);
      if (!tarefa || tarefa.hashRequisicao !== hashRequisicao) throw new ChaveIdempotenciaConflitanteError();
      const filaAtual = await filaAnalitica.getJob(tarefa.id);
      if (tarefa.status === "FALHA") throw new ErroValidacaoTarefaAnalitica("Esta solicitação já falhou; use uma nova Idempotency-Key para tentar novamente.");
      if (tarefa.status !== "CONCLUIDA" && !filaAtual) await garantirJob(tarefa.id, tarefa.hashRequisicao);
      return { tarefa, repetida: true };
    }
    await garantirJob(tarefa.id, tarefa.hashRequisicao);
    return { tarefa, repetida: false };
  }

  consultar(id: string, organizacaoId: string) {
    return this.tarefas.buscarDaOrganizacao(id, organizacaoId);
  }
}

async function garantirJob(tarefaId: string, hashRequisicao: string) {
  await filaAnalitica.add("relatorio-parceiro", { tarefaId, hashRequisicao }, { jobId: tarefaId });
}

function validarPedido(pedido: PedidoRelatorioParceiro) {
  if (!pedido || typeof pedido !== "object") throw new ErroValidacaoTarefaAnalitica("Informe o tipo de relatório.");
  if (!Object.values(TipoRelatorioAnalitico).includes(pedido.tipo)) throw new ErroValidacaoTarefaAnalitica("tipo de relatório inválido.");
  if (pedido.tipo !== TipoRelatorioAnalitico.EFICIENCIA_OPERACIONAL) {
    if (pedido.filtros && Object.keys(pedido.filtros).length) throw new ErroValidacaoTarefaAnalitica("filtros são aceitos somente para EFICIENCIA_OPERACIONAL.");
    return;
  }
  if (pedido.filtros && Object.keys(pedido.filtros).some((chave) => !["dataInicio", "dataFim"].includes(chave))) {
    throw new ErroValidacaoTarefaAnalitica("filtros aceita somente dataInicio e dataFim.");
  }
  const inicio = validarData(pedido.filtros?.dataInicio, "dataInicio");
  const fim = validarData(pedido.filtros?.dataFim, "dataFim");
  if (inicio && fim && inicio > fim) throw new ErroValidacaoTarefaAnalitica("dataInicio deve ser anterior ou igual a dataFim.");
}

function validarData(valor: string | undefined, campo: string) {
  if (valor === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(valor)) throw new ErroValidacaoTarefaAnalitica(`${campo} deve usar AAAA-MM-DD ou timestamp ISO UTC.`);
  const data = new Date(valor);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor.slice(0, 10)) throw new ErroValidacaoTarefaAnalitica(`${campo} não contém uma data válida.`);
  return data;
}

export class ErroValidacaoTarefaAnalitica extends Error {}
export class ChaveIdempotenciaConflitanteError extends Error {}

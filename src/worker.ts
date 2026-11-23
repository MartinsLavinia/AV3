import "dotenv/config";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { StatusTarefaAnalitica, TipoRelatorioAnalitico } from "./generated/prisma/enums.js";
import { prisma } from "./infrastructure/prisma.js";
import { criarConexaoRedis, filaAnalitica, MAX_TENTATIVAS_ANALITICAS, NOME_FILA_ANALITICA } from "./infrastructure/filaAnalitica.js";
import { AnaliseOperacionalService } from "./services/AnaliseOperacionalService.js";
import { AnaliseRecuperacaoService } from "./services/AnaliseRecuperacaoService.js";
import { AnaliseVidaUtilService } from "./services/AnaliseVidaUtilService.js";

type DadosJob = { tarefaId: string; hashRequisicao: string };
export type TarefaParaRelatorio = {
  id: string;
  tipo: TipoRelatorioAnalitico;
  organizacaoId: string;
  chaveApiId: string;
  parametros: unknown;
};
export type InterceptadorRelatorioParceiro = (
  tarefa: TarefaParaRelatorio,
  gerarRelatorio: () => Promise<unknown>,
) => Promise<unknown>;
const operacional = new AnaliseOperacionalService();
const recuperacao = new AnaliseRecuperacaoService();
const vidaUtil = new AnaliseVidaUtilService();

export async function processarTarefaAnalitica(
  job: Job<DadosJob>,
  interceptar: InterceptadorRelatorioParceiro = (_tarefa, gerarRelatorio) => gerarRelatorio(),
) {
  const tarefa = await prisma.tarefaAnalitica.findUnique({ where: { id: job.data.tarefaId }, include: { execucao: true } });
  if (!tarefa) throw new UnrecoverableError("A tarefa persistida não foi encontrada.");
  if (tarefa.hashRequisicao !== job.data.hashRequisicao) throw new UnrecoverableError("A carga da tarefa não corresponde ao registro persistido.");
  if (tarefa.status === StatusTarefaAnalitica.CONCLUIDA || tarefa.execucao) {
    if (tarefa.status !== StatusTarefaAnalitica.CONCLUIDA) await prisma.tarefaAnalitica.update({ where: { id: tarefa.id }, data: { status: StatusTarefaAnalitica.CONCLUIDA, concluidaEm: new Date(), erro: null } });
    return { execucaoAnaliticaId: tarefa.execucao?.id };
  }

  await prisma.tarefaAnalitica.updateMany({
    where: { id: tarefa.id, status: { in: [StatusTarefaAnalitica.AGUARDANDO, StatusTarefaAnalitica.PROCESSANDO] } },
    data: { status: StatusTarefaAnalitica.PROCESSANDO, iniciadaEm: new Date(), tentativas: { increment: 1 }, erro: null },
  });
  try {
    const execucaoExistente = await prisma.execucaoAnalitica.findUnique({ where: { tarefaId: tarefa.id }, select: { id: true } });
    if (execucaoExistente) {
      await prisma.tarefaAnalitica.update({ where: { id: tarefa.id }, data: { status: StatusTarefaAnalitica.CONCLUIDA, concluidaEm: new Date(), erro: null } });
      return { execucaoAnaliticaId: execucaoExistente.id };
    }
    const autor = `chave-api:${tarefa.chaveApiId}`;
    const filtros = (tarefa.parametros as { filtros?: Record<string, unknown> } | null)?.filtros ?? {};
    await interceptar(tarefa, async () => {
      if (tarefa.tipo === TipoRelatorioAnalitico.EFICIENCIA_OPERACIONAL) {
        return operacional.gerarRelatorio(filtros, autor, tarefa.organizacaoId, tarefa.id);
      }
      if (tarefa.tipo === TipoRelatorioAnalitico.VALOR_RECUPERACAO) {
        return recuperacao.gerarRelatorio(autor, tarefa.organizacaoId, tarefa.id);
      }
      return vidaUtil.gerarRelatorio(autor, tarefa.organizacaoId, tarefa.id);
    });
    await prisma.tarefaAnalitica.update({ where: { id: tarefa.id }, data: { status: StatusTarefaAnalitica.CONCLUIDA, concluidaEm: new Date(), erro: null } });
    return { tarefaId: tarefa.id };
  } catch (erro) {
    const tentativasRestantes = job.opts.attempts ?? MAX_TENTATIVAS_ANALITICAS;
    const terminal = erro instanceof UnrecoverableError || job.attemptsMade + 1 >= tentativasRestantes;
    const mensagem = "Falha temporária ao gerar relatório.";
    await prisma.tarefaAnalitica.update({
      where: { id: tarefa.id },
      data: { ...(terminal ? { status: StatusTarefaAnalitica.FALHA, concluidaEm: new Date() } : {}), erro: mensagem.slice(0, 500) },
    });
    throw erro;
  }
}

export async function registrarAgendamentosAnaliticos() {
  for (const tipo of Object.values(TipoRelatorioAnalitico)) {
    await filaAnalitica.upsertJobScheduler(
      `relatorio-diario-${tipo.toLowerCase()}`,
      { pattern: "0 0 2 * * *", tz: "America/Sao_Paulo" },
      {
        name: "relatorio-agendado",
        data: { tipo },
        opts: { attempts: MAX_TENTATIVAS_ANALITICAS, backoff: { type: "custom" }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 5000 } },
      },
    );
  }
}

export async function processarRelatorioAgendado(job: Job<{ tipo: TipoRelatorioAnalitico }>) {
  const autor = "agendamento-analitico-diario";
  if (job.data.tipo === TipoRelatorioAnalitico.EFICIENCIA_OPERACIONAL) return operacional.gerarRelatorio({}, autor);
  if (job.data.tipo === TipoRelatorioAnalitico.VALOR_RECUPERACAO) return recuperacao.gerarRelatorio(autor);
  return vidaUtil.gerarRelatorio(autor);
}

export async function iniciarWorker(
  agendar = true,
  interceptarRelatorio: InterceptadorRelatorioParceiro = (_tarefa, gerarRelatorio) => gerarRelatorio(),
) {
  const worker = new Worker(NOME_FILA_ANALITICA, async (job) => {
    if (job.name === "relatorio-parceiro") return processarTarefaAnalitica(job as Job<DadosJob>, interceptarRelatorio);
    if (job.name === "relatorio-agendado") return processarRelatorioAgendado(job as Job<{ tipo: TipoRelatorioAnalitico }>);
    throw new UnrecoverableError(`Tipo de tarefa não suportado: ${job.name}`);
  }, {
    connection: criarConexaoRedis(),
    concurrency: Number(process.env.ANALYTICS_WORKER_CONCURRENCY) || 2,
    settings: { backoffStrategy: (attemptsMade: number) => attemptsMade === 1 ? 3000 : 5000 },
  });
  worker.on("failed", (job, erro) => console.error("Falha no job analítico", { jobId: job?.id, erro: erro.message }));
  if (agendar) await registrarAgendamentosAnaliticos();
  return worker;
}

if (require.main === module) {
  void iniciarWorker(true).then((worker) => {
    console.log("Worker analítico iniciado.");
    const encerrar = async () => {
      await worker.close();
      await filaAnalitica.close();
      await prisma.$disconnect();
    };
    process.once("SIGINT", () => void encerrar().then(() => process.exit(0)));
    process.once("SIGTERM", () => void encerrar().then(() => process.exit(0)));
  }).catch(async (erro) => {
    console.error("Não foi possível iniciar worker analítico.", erro);
    await filaAnalitica.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
}

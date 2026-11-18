import { linearRegression, linearRegressionLine, mean, median, rSquared, standardDeviation } from "simple-statistics";
import { EstadoFisico } from "../generated/prisma/enums.js";
import { AnaliseVidaUtilRepository } from "../repositories/AnaliseVidaUtilRepository.js";

const ordemEstado: Record<EstadoFisico, number> = {
  [EstadoFisico.NOVO]: 0,
  [EstadoFisico.BOM_ESTADO]: 1,
  [EstadoFisico.USADO_LEVE]: 2,
  [EstadoFisico.USADO_MODERADO]: 3,
  [EstadoFisico.DANIFICADO_LEVE]: 4,
  [EstadoFisico.DANIFICADO_GRAVE]: 5,
  [EstadoFisico.INSERVIVEL]: 6,
};

const MINIMO_EVENTOS = 3;
const HORIZONTE_MAXIMO_ANOS = 30;
const MILISSEGUNDOS_POR_ANO = 365.2425 * 24 * 60 * 60 * 1000;

type BaseEquipamentos = Awaited<ReturnType<AnaliseVidaUtilRepository["obterEquipamentos"]>>;
type EquipamentoHistorico = BaseEquipamentos[number];
type EventoEstado = EquipamentoHistorico["historicoEstadosFisicos"][number];

type Previsao = {
  anosEstimados: number;
  dataPrevista: Date;
  taxaEstadosPorAno: number;
  coeficienteDeterminacao: number | null;
  pontosHistoricos: number;
};

export class AnaliseVidaUtilService {
  constructor(private readonly analises = new AnaliseVidaUtilRepository()) {}

  async gerarRelatorio(solicitadoPor: string) {
    const equipamentos = await this.analises.obterEquipamentos();
    const linhas = equipamentos.map((equipamento) => {
      const analise = analisarEquipamento(equipamento);
      const previsao = analise.previsao;
      return {
        equipamentoId: equipamento.id,
        codigoBarrasInterno: equipamento.codigoBarrasInterno,
        tipo: equipamento.tipo,
        marca: equipamento.marca,
        modelo: equipamento.modelo,
        anoFabricacao: equipamento.anoFabricacao,
        estadoFisicoAtual: equipamento.estadoFisico,
        statusRastreamento: equipamento.statusRastreamento,
        pontosHistoricos: equipamento.historicoEstadosFisicos.length,
        previsao: previsao
          ? {
              estadoAlvo: EstadoFisico.INSERVIVEL,
              anosEstimados: arredondar(previsao.anosEstimados, 2),
              mesesEstimados: arredondar(previsao.anosEstimados * 12, 1),
              dataPrevista: previsao.dataPrevista,
              taxaDegradacaoEstadosPorAno: arredondar(previsao.taxaEstadosPorAno, 4),
              coeficienteDeterminacao: previsao.coeficienteDeterminacao === null
                ? null
                : arredondar(previsao.coeficienteDeterminacao, 3),
              pontosHistoricosUtilizados: previsao.pontosHistoricos,
            }
          : null,
        motivoSemPrevisao: analise.motivoSemPrevisao,
      };
    });

    const porTipoMap = new Map<string, Array<(typeof linhas)[number]>>();
    for (const linha of linhas) {
      const lista = porTipoMap.get(linha.tipo) ?? [];
      lista.push(linha);
      porTipoMap.set(linha.tipo, lista);
    }

    const porTipo = [...porTipoMap.entries()].map(([tipo, itens]) => {
      const previsoes = itens.flatMap((item) => item.previsao ? [item.previsao.anosEstimados] : []);
      return {
        tipo,
        equipamentosAnalisados: itens.length,
        equipamentosComPrevisao: previsoes.length,
        equipamentosSemPrevisao: itens.length - previsoes.length,
        vidaUtilMediaAnosRestantes: previsoes.length ? arredondar(mean(previsoes), 2) : null,
        vidaUtilMedianaAnosRestantes: previsoes.length ? arredondar(median(previsoes), 2) : null,
        desvioPadraoPopulacionalAnosRestantes: previsoes.length > 1 ? arredondar(standardDeviation(previsoes), 2) : null,
      };
    });

    const geradoEm = new Date();
    const parametros = {
      metodo: "regressão linear simples por equipamento sobre o índice ordinal do estado físico",
      escalaEstado: ordemEstado,
      minimoEventosHistoricos: MINIMO_EVENTOS,
      horizonteMaximoAnos: HORIZONTE_MAXIMO_ANOS,
      regraConsistencia: "eventos cronológicos encadeados e estado atual igual ao último estado registrado",
    };
    const relatorio = {
      geradoEm,
      criterio: "Estima o tempo entre a última mudança física registrada e o estado INSERVIVEL, extrapolando a tendência histórica individual do equipamento.",
      limitacoes: [
        "A regressão requer ao menos três eventos históricos em datas distintas; o ano de fabricação não é tratado como observação do estado físico.",
        "Previsões são extrapolações simples da tendência observada, não garantias de falha; dados históricos insuficientes ou inconsistentes não geram projeção.",
        `Projeções superiores a ${HORIZONTE_MAXIMO_ANOS} anos são omitidas por excederem o horizonte configurado.`,
      ],
      resumo: {
        equipamentosAnalisados: linhas.length,
        equipamentosComPrevisao: linhas.filter((linha) => linha.previsao !== null).length,
        equipamentosSemPrevisao: linhas.filter((linha) => linha.previsao === null).length,
        eventosHistoricosConsiderados: equipamentos.reduce((total, equipamento) => total + equipamento.historicoEstadosFisicos.length, 0),
      },
      porTipo,
      equipamentos: linhas,
    };

    const execucao = await this.analises.registrarExecucao({
      geradoEm,
      quantidadeAmostras: equipamentos.length,
      resultado: relatorio,
      solicitadoPor,
      parametros,
    });

    return { ...relatorio, execucaoAnaliticaId: execucao.id };
  }
}

function analisarEquipamento(equipamento: EquipamentoHistorico): { previsao: Previsao | null; motivoSemPrevisao: string | null } {
  const eventos = equipamento.historicoEstadosFisicos;
  if (equipamento.estadoFisico === EstadoFisico.INSERVIVEL && eventos.at(-1)?.estadoNovo === EstadoFisico.INSERVIVEL) {
    return { previsao: {
        anosEstimados: 0,
        dataPrevista: eventos.at(-1)!.dataHora,
        taxaEstadosPorAno: 0,
        coeficienteDeterminacao: null,
        pontosHistoricos: eventos.length,
      }, motivoSemPrevisao: null };
  }
  if (eventos.length === 0) return { previsao: null, motivoSemPrevisao: "SEM_HISTORICO_FISICO" };
  if (!historicoConsistente(equipamento)) return { previsao: null, motivoSemPrevisao: "HISTORICO_INCONSISTENTE_COM_ESTADO_ATUAL" };
  if (eventos.length < MINIMO_EVENTOS || new Set(eventos.map((evento) => evento.dataHora.getTime())).size < MINIMO_EVENTOS) {
    return { previsao: null, motivoSemPrevisao: "AMOSTRA_HISTORICA_INSUFICIENTE" };
  }

  const inicioMs = eventos[0]!.dataHora.getTime();
  const pontos = eventos.map((evento) => ({
    x: (evento.dataHora.getTime() - inicioMs) / MILISSEGUNDOS_POR_ANO,
    y: ordemEstado[evento.estadoNovo],
  }));
  const coordenadas = pontos.map(({ x, y }): [number, number] => [x, y]);
  const reta = linearRegression(coordenadas);
  if (!Number.isFinite(reta.m) || !Number.isFinite(reta.b) || reta.m <= 0) {
    return { previsao: null, motivoSemPrevisao: "TENDENCIA_DE_DETERIORACAO_NAO_OBSERVADA" };
  }
  const funcaoReta = linearRegressionLine(reta);
  const r2 = Math.max(0, Math.min(1, rSquared(coordenadas, funcaoReta)));

  const estadoAtual = ordemEstado[equipamento.estadoFisico];
  const anosRestantes = (ordemEstado[EstadoFisico.INSERVIVEL] - estadoAtual) / reta.m;
  if (!Number.isFinite(anosRestantes) || anosRestantes < 0 || anosRestantes > HORIZONTE_MAXIMO_ANOS) {
    return { previsao: null, motivoSemPrevisao: "PREVISAO_FORA_DO_HORIZONTE_CONFIGURADO" };
  }

  const ultimaData = eventos.at(-1)!.dataHora;
  return {
    previsao: {
      anosEstimados: anosRestantes,
      dataPrevista: new Date(ultimaData.getTime() + anosRestantes * MILISSEGUNDOS_POR_ANO),
      taxaEstadosPorAno: reta.m,
      coeficienteDeterminacao: r2,
      pontosHistoricos: eventos.length,
    },
    motivoSemPrevisao: null,
  };
}

function historicoConsistente(equipamento: EquipamentoHistorico) {
  const eventos = equipamento.historicoEstadosFisicos;
  if (eventos.length === 0 || eventos.at(-1)!.estadoNovo !== equipamento.estadoFisico) return false;
  for (let i = 1; i < eventos.length; i += 1) {
    if (eventos[i]!.dataHora < eventos[i - 1]!.dataHora || eventos[i]!.estadoAnterior !== eventos[i - 1]!.estadoNovo) return false;
  }
  return true;
}

function arredondar(valor: number, casas: number) {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

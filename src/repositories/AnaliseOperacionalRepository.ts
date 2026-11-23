import { mean, median, standardDeviation } from "simple-statistics";
import { TipoEventoTriagem } from "../generated/prisma/enums.js";
import { prisma } from "../infrastructure/prisma.js";

export type FiltroAnaliseOperacional = { dataInicio?: Date; dataFim?: Date };

export class AnaliseOperacionalRepository {
  async gerarRelatorio(filtro: FiltroAnaliseOperacional, solicitadoPor: string, organizacaoId?: string, tarefaId?: string) {
    const lotes = await prisma.lote.findMany({
      where: {
        ...(organizacaoId ? { organizacaoId } : {}),
        ...(filtro.dataInicio || filtro.dataFim
          ? { dataEntrada: { ...(filtro.dataInicio ? { gte: filtro.dataInicio } : {}), ...(filtro.dataFim ? { lte: filtro.dataFim } : {}) } }
          : {}),
        equipamentos: { some: {} },
        NOT: { equipamentos: { some: { statusRastreamento: { in: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM"] } } } },
      },
      select: {
        id: true,
        notaFiscal: true,
        dataEntrada: true,
        equipamentos: {
          select: {
            eventosTriagem: {
              orderBy: [{ dataHora: "asc" }, { id: "asc" }],
              select: { tipo: true, dataHora: true, responsavel: true },
            },
          },
        },
      },
      orderBy: { dataEntrada: "asc" },
    });

    const participacoes: Array<{ responsavel: string; duracaoHoras: number }> = [];
    const concluidos = lotes.flatMap((lote) => {
      const triagensPorEquipamento = lote.equipamentos.map((equipamento) => {
        let inicio: (typeof equipamento.eventosTriagem)[number] | undefined;
        let ultimaTriagem: { conclusao: (typeof equipamento.eventosTriagem)[number]; duracaoHoras: number } | undefined;
        for (const evento of equipamento.eventosTriagem) {
          if (evento.tipo === TipoEventoTriagem.INICIADA) inicio = evento;
          if (evento.tipo === TipoEventoTriagem.CONCLUIDA) {
            if (!inicio || inicio.dataHora > evento.dataHora) continue;
            const duracaoHoras = (evento.dataHora.getTime() - inicio.dataHora.getTime()) / 3_600_000;
            if (duracaoHoras >= 0) {
              ultimaTriagem = { conclusao: evento, duracaoHoras };
            }
            inicio = undefined;
          }
        }
        return ultimaTriagem;
      });
      if (triagensPorEquipamento.some((triagem) => !triagem)) return [];
      const triagens = triagensPorEquipamento.filter((triagem) => triagem !== undefined);
      const eventos = triagens.map((triagem) => triagem.conclusao);
      const dataConclusao = new Date(Math.max(...eventos.map((evento) => evento.dataHora.getTime())));
      const duracaoHoras = (dataConclusao.getTime() - lote.dataEntrada.getTime()) / 3_600_000;
      if (duracaoHoras < 0) return [];
      participacoes.push(...triagens.map((triagem) => ({
        responsavel: triagem.conclusao.responsavel,
        duracaoHoras: triagem.duracaoHoras,
      })));
      const operadores = [...new Set(eventos.map((evento) => evento.responsavel))];
      return [{
        loteId: lote.id,
        notaFiscal: lote.notaFiscal,
        dataEntrada: lote.dataEntrada,
        triagemConcluidaEm: dataConclusao,
        duracaoHoras: arredondar(duracaoHoras),
        equipamentos: triagensPorEquipamento.length,
        operadoresResponsaveis: operadores,
      }];
    });

    const porOperadorMap = new Map<string, { duracoesHoras: number[] }>();
    for (const evento of participacoes) {
      const agregado = porOperadorMap.get(evento.responsavel) ?? { duracoesHoras: [] };
      agregado.duracoesHoras.push(evento.duracaoHoras);
      porOperadorMap.set(evento.responsavel, agregado);
    }

    const porPeriodoMap = new Map<string, { duracoesHoras: number[] }>();
    for (const lote of concluidos) {
      const periodo = lote.triagemConcluidaEm.toISOString().slice(0, 7);
      const agregado = porPeriodoMap.get(periodo) ?? { duracoesHoras: [] };
      agregado.duracoesHoras.push(lote.duracaoHoras);
      porPeriodoMap.set(periodo, agregado);
    }

    const estatisticasLotes = resumirDuracoes(concluidos.map((lote) => lote.duracaoHoras));
    const eventosForaDoEscopo = await prisma.triagemEvento.count({
      where: {
        tipo: TipoEventoTriagem.CONCLUIDA,
        ...(organizacaoId ? { equipamento: { is: { lote: { is: { organizacaoId } } } } } : {}),
        ...(filtro.dataInicio || filtro.dataFim
          ? { dataHora: { ...(filtro.dataInicio ? { gte: filtro.dataInicio } : {}), ...(filtro.dataFim ? { lte: filtro.dataFim } : {}) } }
          : {}),
      },
    });

    const relatorio = {
      geradoEm: new Date(),
      criterio: "Duração do lote entre dataEntrada e a conclusão do último equipamento; apenas lotes com todos os equipamentos triados.",
      periodo: {
        ...(filtro.dataInicio ? { dataInicio: filtro.dataInicio } : {}),
        ...(filtro.dataFim ? { dataFim: filtro.dataFim } : {}),
      },
      resumo: {
        lotesConcluidos: concluidos.length,
        eventosDeConclusaoRegistrados: eventosForaDoEscopo,
        tempoMedioHoras: estatisticasLotes.mediaHoras,
        tempoMedianoHoras: estatisticasLotes.medianaHoras,
        desvioPadraoPopulacionalHoras: estatisticasLotes.desvioPadraoHoras,
        observacao: "Média, mediana e desvio padrão populacional descrevem os lotes concluídos da amostra filtrada. Lotes legados sem eventos não entram; atribuição por operador usa o responsável pelo evento de conclusão de cada equipamento.",
      },
      porOperador: [...porOperadorMap.entries()].map(([responsavel, valores]) => {
        const estatisticas = resumirDuracoes(valores.duracoesHoras);
        return {
          responsavel,
          equipamentosTriados: valores.duracoesHoras.length,
          duracaoMediaTriagemHoras: estatisticas.mediaHoras,
          duracaoMedianaTriagemHoras: estatisticas.medianaHoras,
          desvioPadraoPopulacionalTriagemHoras: estatisticas.desvioPadraoHoras,
        };
      }).sort((a, b) => a.responsavel.localeCompare(b.responsavel)),
      porPeriodo: [...porPeriodoMap.entries()].map(([mes, valores]) => {
        const estatisticas = resumirDuracoes(valores.duracoesHoras);
        return {
          mes,
          lotesConcluidos: valores.duracoesHoras.length,
          duracaoMediaHoras: estatisticas.mediaHoras,
          duracaoMedianaHoras: estatisticas.medianaHoras,
          desvioPadraoPopulacionalHoras: estatisticas.desvioPadraoHoras,
        };
      }).sort((a, b) => a.mes.localeCompare(b.mes)),
      lotes: concluidos,
    };

    const execucao = await prisma.execucaoAnalitica.create({
      data: {
        tipo: "EFICIENCIA_OPERACIONAL",
        geradoEm: relatorio.geradoEm,
        ...(filtro.dataInicio ? { periodoInicio: filtro.dataInicio } : {}),
        ...(filtro.dataFim ? { periodoFim: filtro.dataFim } : {}),
        quantidadeAmostras: concluidos.length,
        versaoAlgoritmo: "1.0.0",
        parametros: JSON.parse(JSON.stringify({ ...filtro, ...(organizacaoId ? { organizacaoId } : {}) })),
        resultado: JSON.parse(JSON.stringify(relatorio)),
        solicitadoPor,
        ...(tarefaId ? { tarefaId } : {}),
      },
      select: { id: true },
    });

    return { ...relatorio, execucaoAnaliticaId: execucao.id };
  }
}

function arredondar(valor: number) { return Math.round(valor * 100) / 100; }

function resumirDuracoes(valores: number[]) {
  if (valores.length === 0) return { mediaHoras: null, medianaHoras: null, desvioPadraoHoras: null };
  return {
    mediaHoras: arredondar(mean(valores)),
    medianaHoras: arredondar(median(valores)),
    desvioPadraoHoras: arredondar(standardDeviation(valores)),
  };
}

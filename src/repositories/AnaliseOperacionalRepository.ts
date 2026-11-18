import { TipoEventoTriagem } from "../generated/prisma/enums.js";
import { prisma } from "../infrastructure/prisma.js";

export type FiltroAnaliseOperacional = { dataInicio?: Date; dataFim?: Date };

export class AnaliseOperacionalRepository {
  async gerarRelatorio(filtro: FiltroAnaliseOperacional) {
    const lotes = await prisma.lote.findMany({
      where: {
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

    const porOperadorMap = new Map<string, { triagensConcluidas: number; duracaoTotalHoras: number }>();
    for (const evento of participacoes) {
      const agregado = porOperadorMap.get(evento.responsavel) ?? { triagensConcluidas: 0, duracaoTotalHoras: 0 };
      agregado.triagensConcluidas += 1;
      agregado.duracaoTotalHoras += evento.duracaoHoras;
      porOperadorMap.set(evento.responsavel, agregado);
    }

    const porPeriodoMap = new Map<string, { lotesConcluidos: number; duracaoTotalHoras: number }>();
    for (const lote of concluidos) {
      const periodo = lote.triagemConcluidaEm.toISOString().slice(0, 7);
      const agregado = porPeriodoMap.get(periodo) ?? { lotesConcluidos: 0, duracaoTotalHoras: 0 };
      agregado.lotesConcluidos += 1;
      agregado.duracaoTotalHoras += lote.duracaoHoras;
      porPeriodoMap.set(periodo, agregado);
    }

    const somaHoras = concluidos.reduce((total, lote) => total + lote.duracaoHoras, 0);
    const eventosForaDoEscopo = await prisma.triagemEvento.count({
      where: {
        tipo: TipoEventoTriagem.CONCLUIDA,
        ...(filtro.dataInicio || filtro.dataFim
          ? { dataHora: { ...(filtro.dataInicio ? { gte: filtro.dataInicio } : {}), ...(filtro.dataFim ? { lte: filtro.dataFim } : {}) } }
          : {}),
      },
    });

    return {
      geradoEm: new Date(),
      criterio: "Duração do lote entre dataEntrada e a conclusão do último equipamento; apenas lotes com todos os equipamentos triados.",
      periodo: {
        ...(filtro.dataInicio ? { dataInicio: filtro.dataInicio } : {}),
        ...(filtro.dataFim ? { dataFim: filtro.dataFim } : {}),
      },
      resumo: {
        lotesConcluidos: concluidos.length,
        eventosDeConclusaoRegistrados: eventosForaDoEscopo,
        tempoMedioHoras: concluidos.length ? arredondar(somaHoras / concluidos.length) : null,
        observacao: "Lotes legados sem eventos de triagem não entram nas métricas. Atribuição por operador inclui os responsáveis pelos eventos de conclusão dos equipamentos do lote.",
      },
      porOperador: [...porOperadorMap.entries()].map(([responsavel, valores]) => ({
        responsavel,
        equipamentosTriados: valores.triagensConcluidas,
        duracaoMediaTriagemHoras: arredondar(valores.duracaoTotalHoras / valores.triagensConcluidas),
      })).sort((a, b) => a.responsavel.localeCompare(b.responsavel)),
      porPeriodo: [...porPeriodoMap.entries()].map(([mes, valores]) => ({
        mes,
        lotesConcluidos: valores.lotesConcluidos,
        duracaoMediaHoras: arredondar(valores.duracaoTotalHoras / valores.lotesConcluidos),
      })).sort((a, b) => a.mes.localeCompare(b.mes)),
      lotes: concluidos,
    };
  }
}

function arredondar(valor: number) { return Math.round(valor * 100) / 100; }

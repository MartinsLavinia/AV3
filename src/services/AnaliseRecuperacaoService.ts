import { median } from "simple-statistics";
import { AnaliseRecuperacaoRepository } from "../repositories/AnaliseRecuperacaoRepository.js";

type Referencia = Awaited<ReturnType<AnaliseRecuperacaoRepository["obterBaseCalculo"]>>[1][number];
type Equipamento = Awaited<ReturnType<AnaliseRecuperacaoRepository["obterBaseCalculo"]>>[0][number];
type ValorPorMoeda = { moeda: string; valorTotalEstimado: string; valorMedioPorEquipamentoComReferencia: string; valorMedianoPorEquipamentoComReferencia: string };

type Agregado = { equipamentosElegiveis: number; equipamentosComReferencia: number; equipamentosSemReferencia: number; totaisCentavos: Map<string, bigint>; quantidadesPorMoeda: Map<string, number>; valoresCentavosPorMoeda: Map<string, number[]> };

export class AnaliseRecuperacaoService {
  constructor(private readonly analises = new AnaliseRecuperacaoRepository()) {}

  async gerarRelatorio(solicitadoPor: string, organizacaoId?: string, tarefaId?: string) {
    const [equipamentos, referencias] = await this.analises.obterBaseCalculo(organizacaoId);
    const referenciasAtivas = referencias.map((referencia) => ({ referencia, moeda: referencia.moeda.toUpperCase() }));
    const usadas = new Map<string, Referencia>();
    const linhas = equipamentos.map((equipamento) => {
      const correspondencia = selecionarReferencia(equipamento, referenciasAtivas);
      if (!correspondencia) {
        return {
          equipamentoId: equipamento.id,
          codigoBarrasInterno: equipamento.codigoBarrasInterno,
          tipo: equipamento.tipo,
          estadoFisico: equipamento.estadoFisico,
          marca: equipamento.marca,
          modelo: equipamento.modelo,
          statusRastreamento: equipamento.statusRastreamento,
          valorEstimado: null,
          moeda: null,
          correspondencia: null,
        };
      }

      usadas.set(correspondencia.referencia.id, correspondencia.referencia);
      return {
        equipamentoId: equipamento.id,
        codigoBarrasInterno: equipamento.codigoBarrasInterno,
        tipo: equipamento.tipo,
        estadoFisico: equipamento.estadoFisico,
        marca: equipamento.marca,
        modelo: equipamento.modelo,
        statusRastreamento: equipamento.statusRastreamento,
        valorEstimado: correspondencia.referencia.valorEstimado.toFixed(2),
        moeda: correspondencia.referencia.moeda,
        correspondencia: {
          nivel: correspondencia.nivel,
          referenciaId: correspondencia.referencia.id,
          grupoId: correspondencia.referencia.grupoId,
          versao: correspondencia.referencia.versao,
          vigenteDesde: correspondencia.referencia.vigenteDesde,
          fonte: correspondencia.referencia.fonte,
          justificativa: correspondencia.referencia.justificativa,
        },
      };
    });

    const geral = criarAgregado();
    const porTipo = new Map<string, Agregado>();
    const porTipoEstado = new Map<string, Agregado>();
    for (let i = 0; i < equipamentos.length; i += 1) {
      const equipamento = equipamentos[i]!;
      const linha = linhas[i]!;
      acumular(geral, linha.moeda, linha.valorEstimado);
      acumular(obterAgregado(porTipo, equipamento.tipo), linha.moeda, linha.valorEstimado);
      acumular(obterAgregado(porTipoEstado, `${equipamento.tipo}|${equipamento.estadoFisico}`), linha.moeda, linha.valorEstimado);
    }

    const geradoEm = new Date();
    const referenciasUsadas = [...usadas.values()].map((referencia) => ({
      id: referencia.id,
      grupoId: referencia.grupoId,
      versao: referencia.versao,
      tipo: referencia.tipo,
      estadoFisico: referencia.estadoFisico,
      marca: referencia.marca,
      modelo: referencia.modelo,
      valorEstimado: referencia.valorEstimado.toFixed(2),
      moeda: referencia.moeda,
      vigenteDesde: referencia.vigenteDesde,
      fonte: referencia.fonte,
      justificativa: referencia.justificativa,
    }));

    const relatorio = {
      geradoEm,
      criterio: "Estimativa de valor por equipamento ainda em processamento, conforme referência ativa mais específica: modelo exato, marca ou referência geral. Equipamentos sem referência correspondente são listados sem valor.",
      observacao: "São valores estimados de recuperação, não receita ou rentabilidade realizada. Totais, médias e medianas são separados por moeda; a mediana resume a distribuição dos valores estimados por equipamento e não mede incerteza de mercado. Equipamentos já destinados a reaproveitamento, reciclagem, descarte ou baixa definitiva são excluídos para evitar dupla contagem.",
      resumo: {
        equipamentosElegiveis: geral.equipamentosElegiveis,
        equipamentosComReferencia: geral.equipamentosComReferencia,
        equipamentosSemReferencia: geral.equipamentosSemReferencia,
        valoresPorMoeda: valoresPorMoeda(geral),
      },
      porTipo: [...porTipo.entries()].map(([tipo, agregado]) => ({
        tipo,
        ...serializarAgregado(agregado),
        valoresPorMoeda: valoresPorMoeda(agregado),
      })),
      porTipoEstado: [...porTipoEstado.entries()].map(([chave, agregado]) => {
        const [tipo, estadoFisico] = chave.split("|");
        return {
          tipo,
          estadoFisico,
          ...serializarAgregado(agregado),
          valoresPorMoeda: valoresPorMoeda(agregado),
        };
      }),
      equipamentos: linhas,
      referenciasUsadas,
    };

    const execucao = await this.analises.registrarExecucao({
      geradoEm,
      quantidadeAmostras: equipamentos.length,
      resultado: relatorio,
      referenciasUsadas,
      solicitadoPor,
      ...(organizacaoId ? { organizacaoId } : {}),
      ...(tarefaId ? { tarefaId } : {}),
    });

    return { ...relatorio, execucaoAnaliticaId: execucao.id };
  }
}

function selecionarReferencia(equipamento: Equipamento, referencias: Array<{ referencia: Referencia; moeda: string }>) {
  const marca = normalizar(equipamento.marca);
  const modelo = normalizar(equipamento.modelo);
  const candidatas = referencias.filter(({ referencia }) => referencia.tipo === equipamento.tipo && referencia.estadoFisico === equipamento.estadoFisico);

  const exata = candidatas.find(({ referencia }) => normalizar(referencia.marca ?? "") === marca && normalizar(referencia.modelo ?? "") === modelo && referencia.marca !== null && referencia.modelo !== null);
  if (exata) return { referencia: exata.referencia, nivel: "MODELO_EXATO" as const };

  const porMarca = candidatas.find(({ referencia }) => normalizar(referencia.marca ?? "") === marca && referencia.modelo === null && referencia.marca !== null);
  if (porMarca) return { referencia: porMarca.referencia, nivel: "MARCA" as const };

  const geral = candidatas.find(({ referencia }) => referencia.marca === null && referencia.modelo === null);
  if (geral) return { referencia: geral.referencia, nivel: "GERAL" as const };
  return null;
}

function normalizar(valor: string) { return valor.trim().normalize("NFKC").toLocaleLowerCase("pt-BR"); }

function criarAgregado(): Agregado {
  return { equipamentosElegiveis: 0, equipamentosComReferencia: 0, equipamentosSemReferencia: 0, totaisCentavos: new Map(), quantidadesPorMoeda: new Map(), valoresCentavosPorMoeda: new Map() };
}

function obterAgregado(mapa: Map<string, Agregado>, chave: string) {
  let agregado = mapa.get(chave);
  if (!agregado) {
    agregado = criarAgregado();
    mapa.set(chave, agregado);
  }
  return agregado;
}

function acumular(agregado: Agregado, moeda: string | null, valor: string | null) {
  agregado.equipamentosElegiveis += 1;
  if (valor === null || moeda === null) {
    agregado.equipamentosSemReferencia += 1;
    return;
  }
  agregado.equipamentosComReferencia += 1;
  const centavos = BigInt(valor.replace(".", ""));
  agregado.totaisCentavos.set(moeda, (agregado.totaisCentavos.get(moeda) ?? 0n) + centavos);
  agregado.quantidadesPorMoeda.set(moeda, (agregado.quantidadesPorMoeda.get(moeda) ?? 0) + 1);
  const valores = agregado.valoresCentavosPorMoeda.get(moeda) ?? [];
  valores.push(Number(centavos));
  agregado.valoresCentavosPorMoeda.set(moeda, valores);
}

function serializarAgregado(agregado: Agregado) {
  return {
    equipamentosElegiveis: agregado.equipamentosElegiveis,
    equipamentosComReferencia: agregado.equipamentosComReferencia,
    equipamentosSemReferencia: agregado.equipamentosSemReferencia,
  };
}

function valoresPorMoeda(agregado: Agregado): ValorPorMoeda[] {
  return [...agregado.totaisCentavos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([moeda, total]) => {
    const quantidade = BigInt(agregado.quantidadesPorMoeda.get(moeda) ?? 0);
    const media = quantidade > 0n ? (total + quantidade / 2n) / quantidade : 0n;
    const medianaCentavos = median(agregado.valoresCentavosPorMoeda.get(moeda) ?? []);
    return {
      moeda,
      valorTotalEstimado: formatarCentavos(total),
      valorMedioPorEquipamentoComReferencia: formatarCentavos(media),
      valorMedianoPorEquipamentoComReferencia: formatarCentavos(BigInt(Math.round(medianaCentavos))),
    };
  });
}

function formatarCentavos(centavos: bigint) {
  const absoluto = centavos < 0n ? -centavos : centavos;
  const inteiro = absoluto / 100n;
  const fracao = (absoluto % 100n).toString().padStart(2, "0");
  return `${centavos < 0n ? "-" : ""}${inteiro}.${fracao}`;
}

import { prisma } from "../infrastructure/prisma.js";

export class AnaliseVidaUtilRepository {
  obterEquipamentos() {
    return prisma.equipamento.findMany({
      select: {
        id: true,
        codigoBarrasInterno: true,
        tipo: true,
        marca: true,
        modelo: true,
        anoFabricacao: true,
        estadoFisico: true,
        statusRastreamento: true,
        historicoEstadosFisicos: {
          orderBy: [{ dataHora: "asc" }, { id: "asc" }],
          select: {
            estadoAnterior: true,
            estadoNovo: true,
            dataHora: true,
            responsavel: true,
          },
        },
      },
      orderBy: [{ tipo: "asc" }, { codigoBarrasInterno: "asc" }],
    });
  }

  registrarExecucao(dados: {
    geradoEm: Date;
    quantidadeAmostras: number;
    resultado: unknown;
    solicitadoPor: string;
    parametros: unknown;
  }) {
    return prisma.execucaoAnalitica.create({
      data: {
        tipo: "VIDA_UTIL_REMANESCENTE",
        geradoEm: dados.geradoEm,
        quantidadeAmostras: dados.quantidadeAmostras,
        versaoAlgoritmo: "regressao-linear-ordinal-v1",
        parametros: JSON.parse(JSON.stringify(dados.parametros)),
        resultado: JSON.parse(JSON.stringify(dados.resultado)),
        solicitadoPor: dados.solicitadoPor,
      },
      select: { id: true },
    });
  }
}

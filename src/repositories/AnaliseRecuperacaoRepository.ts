import { prisma } from "../infrastructure/prisma.js";

export class AnaliseRecuperacaoRepository {
  obterBaseCalculo() {
    return Promise.all([
      prisma.equipamento.findMany({
        where: {
          statusRastreamento: {
            in: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE"],
          },
        },
        select: {
          id: true,
          codigoBarrasInterno: true,
          tipo: true,
          marca: true,
          modelo: true,
          estadoFisico: true,
          statusRastreamento: true,
        },
        orderBy: [{ tipo: "asc" }, { estadoFisico: "asc" }, { codigoBarrasInterno: "asc" }],
      }),
      prisma.referenciaRecuperacao.findMany({
        where: { ativa: true },
        orderBy: [{ vigenteDesde: "desc" }, { versao: "desc" }],
      }),
    ]);
  }

  registrarExecucao(dados: {
    geradoEm: Date;
    quantidadeAmostras: number;
    resultado: unknown;
    referenciasUsadas: unknown;
    solicitadoPor: string;
  }) {
    return prisma.execucaoAnalitica.create({
      data: {
        tipo: "VALOR_RECUPERACAO",
        geradoEm: dados.geradoEm,
        quantidadeAmostras: dados.quantidadeAmostras,
        versaoAlgoritmo: "1.0.0",
        parametros: { regraCorrespondencia: "MODELO_EXATO, MARCA, GERAL", moedasAgregadasSeparadamente: true },
        resultado: JSON.parse(JSON.stringify(dados.resultado)),
        referenciasUsadas: JSON.parse(JSON.stringify(dados.referenciasUsadas)),
        solicitadoPor: dados.solicitadoPor,
      },
      select: { id: true },
    });
  }
}

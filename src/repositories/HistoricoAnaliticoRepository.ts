import { prisma } from "../infrastructure/prisma.js";
import type { TipoRelatorioAnalitico } from "../generated/prisma/enums.js";

export type FiltroHistoricoAnalitico = {
  tipo?: TipoRelatorioAnalitico;
  dataInicio?: Date;
  dataFim?: Date;
  pular: number;
  limite: number;
};

export class HistoricoAnaliticoRepository {
  async listar(filtro: FiltroHistoricoAnalitico) {
    const where = {
      ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
      ...(filtro.dataInicio || filtro.dataFim
        ? { geradoEm: { ...(filtro.dataInicio ? { gte: filtro.dataInicio } : {}), ...(filtro.dataFim ? { lte: filtro.dataFim } : {}) } }
        : {}),
    };
    const [itens, total] = await prisma.$transaction([
      prisma.execucaoAnalitica.findMany({
        where,
        select: {
          id: true,
          tipo: true,
          geradoEm: true,
          periodoInicio: true,
          periodoFim: true,
          quantidadeAmostras: true,
          versaoAlgoritmo: true,
          solicitadoPor: true,
        },
        orderBy: [{ geradoEm: "desc" }, { id: "desc" }],
        skip: filtro.pular,
        take: filtro.limite,
      }),
      prisma.execucaoAnalitica.count({ where }),
    ]);
    return { itens, total };
  }

  buscarPorId(id: string) {
    return prisma.execucaoAnalitica.findUnique({ where: { id } });
  }
}

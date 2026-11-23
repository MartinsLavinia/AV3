import type { Prisma } from "../generated/prisma/client.js";
import { TipoRelatorioAnalitico } from "../generated/prisma/enums.js";
import { prisma } from "../infrastructure/prisma.js";

export type CriarTarefaAnalitica = {
  id: string;
  organizacaoId: string;
  chaveApiId: string;
  tipo: TipoRelatorioAnalitico;
  chaveIdempotencia: string;
  hashRequisicao: string;
  parametros?: Prisma.InputJsonValue;
};

export class TarefaAnaliticaRepository {
  criar(dados: CriarTarefaAnalitica) {
    return prisma.tarefaAnalitica.create({ data: dados });
  }

  buscarPorIdempotencia(organizacaoId: string, chaveIdempotencia: string) {
    return prisma.tarefaAnalitica.findUnique({ where: { organizacaoId_chaveIdempotencia: { organizacaoId, chaveIdempotencia } } });
  }

  buscarDaOrganizacao(id: string, organizacaoId: string) {
    return prisma.tarefaAnalitica.findFirst({
      where: { id, organizacaoId },
      select: {
        id: true, organizacaoId: true, tipo: true, status: true, criadaEm: true,
        iniciadaEm: true, concluidaEm: true, tentativas: true, erro: true,
        execucao: { select: { id: true, resultado: true, geradoEm: true } },
      },
    });
  }
}

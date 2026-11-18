import { Prisma } from "../generated/prisma/client.js";
import type { EstadoFisico, TipoEquipamento } from "../generated/prisma/enums.js";
import { prisma } from "../infrastructure/prisma.js";

export type DadosNovaReferencia = {
  grupoId: string;
  assinaturaCriterio: string;
  tipo: TipoEquipamento;
  estadoFisico: EstadoFisico;
  marca: string | null;
  modelo: string | null;
  valorEstimado: string;
  moeda: string;
  fonte: string;
  justificativa: string;
  criadaPor: string;
};

export type DadosRevisaoReferencia = {
  valorEstimado: string;
  moeda?: string;
  fonte: string;
  justificativa: string;
};

export class ReferenciaRecuperacaoRepository {
  listar() {
    return prisma.referenciaRecuperacao.findMany({
      orderBy: [{ tipo: "asc" }, { estadoFisico: "asc" }, { marca: "asc" }, { modelo: "asc" }, { versao: "desc" }],
    });
  }

  async criar(dados: DadosNovaReferencia) {
    try {
      return await prisma.referenciaRecuperacao.create({ data: dados });
    } catch (erro) {
      if (ehConflitoUnico(erro)) throw new CriterioReferenciaAtivoDuplicadoRepositoryError();
      throw erro;
    }
  }

  async revisar(id: string, versaoEsperada: number, dados: DadosRevisaoReferencia, responsavel: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const atual = await tx.referenciaRecuperacao.findUnique({ where: { id } });
        if (!atual) throw new ReferenciaNaoEncontradaRepositoryError();
        if (!atual.ativa || atual.versao !== versaoEsperada) throw new VersaoReferenciaConflitanteRepositoryError();

        const agora = new Date();
        const encerrada = await tx.referenciaRecuperacao.updateMany({
          where: { id, ativa: true, versao: versaoEsperada },
          data: {
            ativa: false,
            vigenteAte: agora,
            encerradaPor: responsavel,
            motivoEncerramento: `Substituída pela versão ${versaoEsperada + 1}.`,
          },
        });
        if (encerrada.count !== 1) throw new VersaoReferenciaConflitanteRepositoryError();

        const referenciaNova = await tx.referenciaRecuperacao.create({
          data: {
            grupoId: atual.grupoId,
            assinaturaCriterio: atual.assinaturaCriterio,
            tipo: atual.tipo,
            estadoFisico: atual.estadoFisico,
            marca: atual.marca,
            modelo: atual.modelo,
            ...dados,
            moeda: dados.moeda ?? atual.moeda,
            vigenteDesde: agora,
            versao: atual.versao + 1,
            criadaPor: responsavel,
          },
        });
        return { referenciaAnteriorId: atual.id, referencia: referenciaNova };
      });
    } catch (erro) {
      if (ehConflitoUnico(erro)) throw new VersaoReferenciaConflitanteRepositoryError();
      throw erro;
    }
  }

  async encerrar(id: string, versaoEsperada: number, responsavel: string, motivo: string) {
    const atual = await prisma.referenciaRecuperacao.findUnique({ where: { id } });
    if (!atual) throw new ReferenciaNaoEncontradaRepositoryError();
    if (!atual.ativa || atual.versao !== versaoEsperada) throw new VersaoReferenciaConflitanteRepositoryError();

    const resultado = await prisma.referenciaRecuperacao.updateMany({
      where: { id, ativa: true, versao: versaoEsperada },
      data: {
        ativa: false,
        vigenteAte: new Date(),
        encerradaPor: responsavel,
        motivoEncerramento: motivo,
      },
    });
    if (resultado.count !== 1) throw new VersaoReferenciaConflitanteRepositoryError();
    return prisma.referenciaRecuperacao.findUniqueOrThrow({ where: { id } });
  }
}

function ehConflitoUnico(erro: unknown) {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

export class ReferenciaNaoEncontradaRepositoryError extends Error {}
export class VersaoReferenciaConflitanteRepositoryError extends Error {}
export class CriterioReferenciaAtivoDuplicadoRepositoryError extends Error {}

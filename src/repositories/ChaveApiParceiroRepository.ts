import { prisma } from "../infrastructure/prisma.js";
import type { EscopoChaveApi } from "../generated/prisma/enums.js";

export class ChaveApiParceiroRepository {
  buscarParaAutenticacao(id: string) {
    return prisma.chaveApiParceiro.findUnique({
      where: { id },
      select: {
        id: true,
        organizacaoId: true,
        segredoHash: true,
        permissoes: true,
        expiraEm: true,
        revogadaEm: true,
        organizacao: { select: { ativo: true } },
      },
    });
  }

  registrarUtilizacao(id: string, agora: Date) {
    return prisma.chaveApiParceiro.updateMany({
      where: { id, revogadaEm: null, expiraEm: { gt: agora } },
      data: { ultimaUtilizacaoEm: agora },
    });
  }

  listar(organizacaoId?: string) {
    return prisma.chaveApiParceiro.findMany({
      where: organizacaoId ? { organizacaoId } : {},
      select: {
        id: true,
        organizacaoId: true,
        nome: true,
        prefixo: true,
        permissoes: true,
        criadaPor: true,
        criadaEm: true,
        expiraEm: true,
        ultimaUtilizacaoEm: true,
        revogadaEm: true,
        revogadaPor: true,
        motivoRevogacao: true,
        organizacao: { select: { razaoSocial: true, ativo: true } },
      },
      orderBy: [{ organizacaoId: "asc" }, { criadaEm: "desc" }],
    });
  }

  buscarOrganizacao(organizacaoId: string) {
    return prisma.organizacao.findUnique({
      where: { id: organizacaoId },
      select: { id: true, razaoSocial: true, ativo: true },
    });
  }

  criar(dados: {
    id: string;
    organizacaoId: string;
    nome: string;
    prefixo: string;
    segredoHash: string;
    permissoes: EscopoChaveApi[];
    criadaPor: string;
    expiraEm: Date;
  }) {
    return prisma.chaveApiParceiro.create({ data: dados, select: { id: true } });
  }

  buscarParaRenovacao(id: string) {
    return prisma.chaveApiParceiro.findUnique({ where: { id } });
  }

  revogar(id: string, revogadaPor: string, motivoRevogacao: string) {
    return prisma.chaveApiParceiro.updateMany({
      where: { id, revogadaEm: null },
      data: { revogadaEm: new Date(), revogadaPor, motivoRevogacao },
    });
  }

  async renovar(
    idAntigo: string,
    criadaPor: string,
    motivoRevogacao: string,
    novaChave: {
      id: string;
      nome: string;
      prefixo: string;
      segredoHash: string;
      expiraEm: Date;
    },
  ) {
    return prisma.$transaction(async (tx) => {
      const antiga = await tx.chaveApiParceiro.findUnique({ where: { id: idAntigo } });
      if (!antiga) throw new ChaveApiParceiroNaoEncontradaRepositoryError();
      if (antiga.revogadaEm) throw new ChaveApiParceiroJaRevogadaRepositoryError();

      const resultado = await tx.chaveApiParceiro.updateMany({
        where: { id: idAntigo, revogadaEm: null },
        data: { revogadaEm: new Date(), revogadaPor: criadaPor, motivoRevogacao },
      });
      if (resultado.count !== 1) throw new ChaveApiParceiroJaRevogadaRepositoryError();

      const criada = await tx.chaveApiParceiro.create({
        data: {
          ...novaChave,
          organizacaoId: antiga.organizacaoId,
          permissoes: antiga.permissoes,
          criadaPor,
        },
        select: { id: true },
      });
      return { antiga, criada };
    });
  }
}

export class ChaveApiParceiroNaoEncontradaRepositoryError extends Error {}
export class ChaveApiParceiroJaRevogadaRepositoryError extends Error {}

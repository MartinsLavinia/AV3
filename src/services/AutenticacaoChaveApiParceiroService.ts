import { createHash, timingSafeEqual } from "node:crypto";
import type { EscopoChaveApi } from "../generated/prisma/enums.js";
import { ChaveApiParceiroRepository } from "../repositories/ChaveApiParceiroRepository.js";

export type IdentidadeApiParceiro = {
  chaveId: string;
  organizacaoId: string;
  permissoes: EscopoChaveApi[];
};

const FORMATO_CHAVE = /^gc_live_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

export class AutenticacaoChaveApiParceiroService {
  constructor(private readonly chaves = new ChaveApiParceiroRepository()) {}

  async autenticar(valor: unknown): Promise<IdentidadeApiParceiro | null> {
    if (typeof valor !== "string") return null;
    const partes = FORMATO_CHAVE.exec(valor);
    if (!partes) return null;

    const [, id, segredo] = partes;
    const registro = await this.chaves.buscarParaAutenticacao(id!);
    if (!registro || registro.revogadaEm || registro.expiraEm.getTime() <= Date.now() || !registro.organizacao.ativo) return null;

    const hashRecebido = createHash("sha256").update(segredo!, "utf8").digest();
    const hashPersistido = Buffer.from(registro.segredoHash, "hex");
    if (hashPersistido.length !== hashRecebido.length || !timingSafeEqual(hashPersistido, hashRecebido)) return null;

    return {
      chaveId: registro.id,
      organizacaoId: registro.organizacaoId,
      permissoes: registro.permissoes,
    };
  }

  async registrarUtilizacao(chaveId: string) {
    const uso = await this.chaves.registrarUtilizacao(chaveId, new Date());
    return uso.count === 1;
  }
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EscopoChaveApi } from "../generated/prisma/enums.js";
import {
  ChaveApiParceiroJaRevogadaRepositoryError,
  ChaveApiParceiroNaoEncontradaRepositoryError,
  ChaveApiParceiroRepository,
} from "../repositories/ChaveApiParceiroRepository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSOES_VALIDAS = new Set<string>(Object.values(EscopoChaveApi));

export type DadosNovaChaveApi = { nome: unknown; permissoes: unknown; expiraEm: unknown };
export type DadosRenovacaoChaveApi = { expiraEm: unknown };

export class ChaveApiParceiroService {
  constructor(private readonly chaves = new ChaveApiParceiroRepository()) {}

  async listar(organizacaoIdInformado?: string) {
    const organizacaoId = organizacaoIdInformado === undefined
      ? undefined
      : this.validarUuid(organizacaoIdInformado, "organização");
    const chaves = await this.chaves.listar(organizacaoId);
    const agora = Date.now();
    return chaves.map((chave) => ({
      ...chave,
      status: chave.revogadaEm ? "REVOGADA" : chave.expiraEm.getTime() <= agora ? "EXPIRADA" : "ATIVA",
    }));
  }

  async criar(organizacaoIdInformado: string, dados: DadosNovaChaveApi, criadaPor: string) {
    const organizacaoId = this.validarUuid(organizacaoIdInformado, "organização");
    const organizacao = await this.chaves.buscarOrganizacao(organizacaoId);
    if (!organizacao) throw new OrganizacaoChaveApiNaoEncontradaError();
    if (!organizacao.ativo) throw new OrganizacaoChaveApiInativaError();

    const nome = this.validarNome(dados?.nome);
    const permissoes = this.validarPermissoes(dados?.permissoes);
    const expiraEm = this.validarExpiracao(dados?.expiraEm);
    const credencial = this.gerarCredencial();

    await this.chaves.criar({
      id: credencial.id,
      organizacaoId,
      nome,
      prefixo: credencial.prefixo,
      segredoHash: credencial.segredoHash,
      permissoes,
      criadaPor,
      expiraEm,
    });

    return {
      chave: credencial.valor,
      aviso: "Guarde esta chave agora. O segredo completo não será exibido novamente.",
      metadados: {
        id: credencial.id,
        organizacaoId,
        organizacao: organizacao.razaoSocial,
        nome,
        prefixo: credencial.prefixo,
        permissoes,
        criadaPor,
        expiraEm,
      },
    };
  }

  async revogar(idInformado: string, motivoInformado: unknown, revogadaPor: string) {
    const id = this.validarUuid(idInformado, "chave");
    const motivo = this.validarMotivo(motivoInformado);
    const resultado = await this.chaves.revogar(id, revogadaPor, motivo);
    if (resultado.count === 0) {
      const chave = await this.chaves.buscarParaRenovacao(id);
      if (!chave) throw new ChaveApiNaoEncontradaError();
      throw new ChaveApiJaRevogadaError();
    }
    return { id, revogadaEm: new Date(), revogadaPor, motivoRevogacao: motivo, status: "REVOGADA" as const };
  }

  async renovar(idInformado: string, dados: DadosRenovacaoChaveApi, criadaPor: string) {
    const idAntigo = this.validarUuid(idInformado, "chave");
    const expiraEm = this.validarExpiracao(dados?.expiraEm);
    const antiga = await this.chaves.buscarParaRenovacao(idAntigo);
    if (!antiga) throw new ChaveApiNaoEncontradaError();

    const credencial = this.gerarCredencial();
    try {
      await this.chaves.renovar(idAntigo, criadaPor, "Chave substituída por renovação administrativa.", {
        id: credencial.id,
        nome: antiga.nome,
        prefixo: credencial.prefixo,
        segredoHash: credencial.segredoHash,
        expiraEm,
      });
    } catch (erro) {
      if (erro instanceof ChaveApiParceiroNaoEncontradaRepositoryError) throw new ChaveApiNaoEncontradaError();
      if (erro instanceof ChaveApiParceiroJaRevogadaRepositoryError) throw new ChaveApiJaRevogadaError();
      throw erro;
    }

    return {
      chave: credencial.valor,
      aviso: "A chave anterior foi revogada. Guarde a nova chave agora; o segredo completo não será exibido novamente.",
      metadados: {
        id: credencial.id,
        chaveAnteriorId: idAntigo,
        organizacaoId: antiga.organizacaoId,
        nome: antiga.nome,
        prefixo: credencial.prefixo,
        permissoes: antiga.permissoes,
        criadaPor,
        expiraEm,
      },
    };
  }

  private gerarCredencial() {
    const id = randomUUID();
    const segredo = randomBytes(32).toString("base64url");
    const valor = `gc_live_${id}.${segredo}`;
    return {
      id,
      valor,
      prefixo: `gc_live_${id.slice(0, 8)}`,
      segredoHash: createHash("sha256").update(segredo, "utf8").digest("hex"),
    };
  }

  private validarUuid(valor: unknown, campo: string): string {
    if (typeof valor !== "string" || !UUID.test(valor)) throw new ErroValidacaoChaveApi(`Identificador de ${campo} inválido.`);
    return valor;
  }

  private validarNome(valor: unknown): string {
    if (typeof valor !== "string" || valor.trim().length < 3 || valor.trim().length > 80) {
      throw new ErroValidacaoChaveApi("O nome da integração deve ter entre 3 e 80 caracteres.");
    }
    return valor.trim();
  }

  private validarPermissoes(valor: unknown): EscopoChaveApi[] {
    if (!Array.isArray(valor) || valor.length === 0 || valor.some((item) => typeof item !== "string" || !PERMISSOES_VALIDAS.has(item))) {
      throw new ErroValidacaoChaveApi(`Informe ao menos uma permissão válida: ${[...PERMISSOES_VALIDAS].join(", ")}.`);
    }
    if (new Set(valor).size !== valor.length) throw new ErroValidacaoChaveApi("Não repita permissões na mesma chave.");
    return valor as EscopoChaveApi[];
  }

  private validarExpiracao(valor: unknown): Date {
    if (typeof valor !== "string") throw new ErroValidacaoChaveApi("Informe expiraEm como data AAAA-MM-DD ou timestamp ISO 8601 com fuso horário.");
    let data: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      data = new Date(`${valor}T23:59:59.999Z`);
      if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor) throw new ErroValidacaoChaveApi("A data de expiração não é válida.");
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(valor)) {
      data = new Date(valor);
      if (Number.isNaN(data.getTime())) throw new ErroValidacaoChaveApi("A data de expiração não é válida.");
    } else {
      throw new ErroValidacaoChaveApi("Informe expiraEm como data AAAA-MM-DD ou timestamp ISO 8601 com fuso horário.");
    }
    if (data.getTime() <= Date.now()) throw new ErroValidacaoChaveApi("A data de expiração deve estar no futuro.");
    return data;
  }

  private validarMotivo(valor: unknown): string {
    if (typeof valor !== "string" || valor.trim().length < 5 || valor.trim().length > 300) {
      throw new ErroValidacaoChaveApi("Informe um motivo de revogação entre 5 e 300 caracteres.");
    }
    return valor.trim();
  }
}

export class ErroValidacaoChaveApi extends Error {}
export class OrganizacaoChaveApiNaoEncontradaError extends Error {}
export class OrganizacaoChaveApiInativaError extends Error {}
export class ChaveApiNaoEncontradaError extends Error {}
export class ChaveApiJaRevogadaError extends Error {}

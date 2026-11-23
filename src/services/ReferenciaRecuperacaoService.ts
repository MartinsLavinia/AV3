import { randomUUID } from "node:crypto";
import { EstadoFisico, TipoEquipamento } from "../generated/prisma/enums.js";
import {
  CriterioReferenciaAtivoDuplicadoRepositoryError,
  ReferenciaNaoEncontradaRepositoryError,
  ReferenciaRecuperacaoRepository,
  VersaoReferenciaConflitanteRepositoryError,
} from "../repositories/ReferenciaRecuperacaoRepository.js";

export type DadosCriacaoReferencia = {
  tipo: TipoEquipamento;
  estadoFisico: EstadoFisico;
  marca?: string;
  modelo?: string;
  valorEstimado: number;
  moeda?: string;
  fonte: string;
  justificativa: string;
};

export type DadosRevisaoReferencia = {
  versao: number;
  valorEstimado: number;
  moeda?: string;
  fonte: string;
  justificativa: string;
};

export type DadosEncerramentoReferencia = { versao: number; motivo: string };

export class ReferenciaRecuperacaoService {
  constructor(private readonly referencias = new ReferenciaRecuperacaoRepository()) {}

  listar() { return this.referencias.listar(); }

  async criar(dados: DadosCriacaoReferencia, responsavel: string) {
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
      throw new ErroValidacaoReferencia("O corpo da requisição deve ser um objeto JSON.");
    }
    if (!Object.values(TipoEquipamento).includes(dados.tipo)) throw new ErroValidacaoReferencia("Tipo de equipamento inválido.");
    if (!Object.values(EstadoFisico).includes(dados.estadoFisico)) throw new ErroValidacaoReferencia("Estado físico inválido.");

    const marca = this.textoOpcional(dados.marca, "Marca", 120);
    const modelo = this.textoOpcional(dados.modelo, "Modelo", 120);
    if (modelo && !marca) throw new ErroValidacaoReferencia("Informe a marca quando cadastrar uma referência específica por modelo.");

    const valorEstimado = this.validarValor(dados.valorEstimado);
    const moeda = this.validarMoeda(dados.moeda);
    const fonte = this.textoObrigatorio(dados.fonte, "Fonte", 500);
    const justificativa = this.textoObrigatorio(dados.justificativa, "Justificativa", 2000);
    const assinaturaCriterio = this.assinatura(dados.tipo, dados.estadoFisico, marca, modelo);

    try {
      return await this.referencias.criar({
        grupoId: randomUUID(),
        assinaturaCriterio,
        tipo: dados.tipo,
        estadoFisico: dados.estadoFisico,
        marca,
        modelo,
        valorEstimado,
        moeda,
        fonte,
        justificativa,
        criadaPor: this.validarResponsavel(responsavel),
      });
    } catch (erro) {
      if (erro instanceof CriterioReferenciaAtivoDuplicadoRepositoryError) throw new CriterioReferenciaAtivoDuplicadoError();
      throw erro;
    }
  }

  //Tigre Tigre

  async revisar(id: string, dados: DadosRevisaoReferencia, responsavel: string) {
    this.validarId(id);
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new ErroValidacaoReferencia("O corpo da requisição deve ser um objeto JSON.");
    const versao = this.validarVersao(dados.versao);
    const atualizacoes = {
      valorEstimado: this.validarValor(dados.valorEstimado),
      ...(dados.moeda === undefined ? {} : { moeda: this.validarMoeda(dados.moeda) }),
      fonte: this.textoObrigatorio(dados.fonte, "Fonte", 500),
      justificativa: this.textoObrigatorio(dados.justificativa, "Justificativa", 2000),
    };
    try {
      return await this.referencias.revisar(id, versao, atualizacoes, this.validarResponsavel(responsavel));
    } catch (erro) {
      if (erro instanceof ReferenciaNaoEncontradaRepositoryError) throw new ReferenciaRecuperacaoNaoEncontradaError();
      if (erro instanceof VersaoReferenciaConflitanteRepositoryError) throw new VersaoReferenciaRecuperacaoConflitanteError();
      throw erro;
    }
  }

  async encerrar(id: string, dados: DadosEncerramentoReferencia, responsavel: string) {
    this.validarId(id);
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new ErroValidacaoReferencia("O corpo da requisição deve ser um objeto JSON.");
    const versao = this.validarVersao(dados.versao);
    const motivo = this.textoObrigatorio(dados.motivo, "Motivo do encerramento", 500);
    try {
      return await this.referencias.encerrar(id, versao, this.validarResponsavel(responsavel), motivo);
    } catch (erro) {
      if (erro instanceof ReferenciaNaoEncontradaRepositoryError) throw new ReferenciaRecuperacaoNaoEncontradaError();
      if (erro instanceof VersaoReferenciaConflitanteRepositoryError) throw new VersaoReferenciaRecuperacaoConflitanteError();
      throw erro;
    }
  }

  private assinatura(tipo: TipoEquipamento, estado: EstadoFisico, marca: string | null, modelo: string | null) {
    const canonical = (value: string | null) => value?.normalize("NFKC").toLocaleLowerCase("pt-BR") ?? "*";
    return `${tipo}|${estado}|${canonical(marca)}|${canonical(modelo)}`;
  }

  private validarValor(valor: unknown): string {
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > 9_999_999_999.99) {
      throw new ErroValidacaoReferencia("valorEstimado deve ser um número entre 0 e 9.999.999.999,99.");
    }
    const centavos = Math.round(valor * 100);
    if (Math.abs(valor * 100 - centavos) > 1e-7) throw new ErroValidacaoReferencia("valorEstimado pode ter no máximo duas casas decimais.");
    return (centavos / 100).toFixed(2);
  }

  private validarMoeda(valor: unknown): string {
    if (valor === undefined) return "BRL";
    if (typeof valor !== "string" || !/^[A-Za-z]{3}$/.test(valor.trim())) {
      throw new ErroValidacaoReferencia("moeda deve ser um código de três letras, como BRL.");
    }
    return valor.trim().toUpperCase();
  }

  private textoObrigatorio(valor: unknown, nome: string, maximo: number): string {
    if (typeof valor !== "string" || !valor.trim()) throw new ErroValidacaoReferencia(`${nome} é obrigatório.`);
    const texto = valor.trim();
    if (texto.length > maximo) throw new ErroValidacaoReferencia(`${nome} deve ter no máximo ${maximo} caracteres.`);
    return texto;
  }

  private textoOpcional(valor: unknown, nome: string, maximo: number): string | null {
    if (valor === undefined || valor === null || valor === "") return null;
    return this.textoObrigatorio(valor, nome, maximo);
  }

  private validarVersao(valor: unknown): number {
    if (!Number.isInteger(valor) || (valor as number) < 1) throw new ErroValidacaoReferencia("versao deve ser um inteiro positivo.");
    return valor as number;
  }

  private validarId(valor: string) {
    if (!UUID.test(valor)) throw new ErroValidacaoReferencia("Identificador da referência inválido.");
  }

  private validarResponsavel(valor: unknown): string {
    if (typeof valor !== "string" || !valor.trim()) throw new ErroValidacaoReferencia("Não foi possível identificar o administrador responsável.");
    return valor.trim();
  }
}

export class ErroValidacaoReferencia extends Error {}
export class ReferenciaRecuperacaoNaoEncontradaError extends Error {}
export class VersaoReferenciaRecuperacaoConflitanteError extends Error {}
export class CriterioReferenciaAtivoDuplicadoError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

import { TipoRelatorioAnalitico } from "../generated/prisma/enums.js";
import { HistoricoAnaliticoRepository, type FiltroHistoricoAnalitico } from "../repositories/HistoricoAnaliticoRepository.js";

export class HistoricoAnaliticoService {
  constructor(private readonly historico = new HistoricoAnaliticoRepository()) {}

  async listar(query: Record<string, unknown>) {
    const pagina = inteiroPositivo(query.pagina, 1, "pagina");
    const limite = inteiroPositivo(query.limite, 50, "limite");
    if (limite > 100) throw new ErroValidacaoHistoricoAnalitico("limite deve ser no máximo 100.");
    const tipo = query.tipo;
    if (tipo !== undefined && (typeof tipo !== "string" || !Object.values(TipoRelatorioAnalitico).includes(tipo as TipoRelatorioAnalitico))) {
      throw new ErroValidacaoHistoricoAnalitico("tipo deve ser EFICIENCIA_OPERACIONAL, VALOR_RECUPERACAO ou VIDA_UTIL_REMANESCENTE.");
    }
    const dataInicio = dataValida(query.dataInicio, "dataInicio", false);
    const dataFim = dataValida(query.dataFim, "dataFim", true);
    if (dataInicio && dataFim && dataInicio > dataFim) {
      throw new ErroValidacaoHistoricoAnalitico("dataInicio deve ser anterior ou igual a dataFim.");
    }

    const filtro: FiltroHistoricoAnalitico = {
      ...(tipo ? { tipo: tipo as TipoRelatorioAnalitico } : {}),
      ...(dataInicio ? { dataInicio } : {}),
      ...(dataFim ? { dataFim } : {}),
      pular: (pagina - 1) * limite,
      limite,
    };
    const { itens, total } = await this.historico.listar(filtro);
    return { pagina, limite, total, totalPaginas: Math.ceil(total / limite), execucoes: itens };
  }

  async obter(id: string) {
    if (!UUID.test(id)) throw new ErroValidacaoHistoricoAnalitico("Identificador da execução analítica inválido.");
    const execucao = await this.historico.buscarPorId(id);
    if (!execucao) throw new ExecucaoAnaliticaNaoEncontradaError();
    return execucao;
  }
}

function inteiroPositivo(valor: unknown, padrao: number, nome: string) {
  if (valor === undefined) return padrao;
  const convertido = typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : valor;
  if (!Number.isSafeInteger(convertido) || (convertido as number) < 1) {
    throw new ErroValidacaoHistoricoAnalitico(`${nome} deve ser um inteiro positivo.`);
  }
  return convertido as number;
}

function dataValida(valor: unknown, nome: string, fimDoDia: boolean): Date | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(valor)) {
    throw new ErroValidacaoHistoricoAnalitico(`${nome} deve usar AAAA-MM-DD ou timestamp ISO UTC.`);
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor.slice(0, 10)) {
    throw new ErroValidacaoHistoricoAnalitico(`${nome} não contém uma data válida.`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    if (fimDoDia) data.setUTCHours(23, 59, 59, 999);
    else data.setUTCHours(0, 0, 0, 0);
  }
  return data;
}

export class ErroValidacaoHistoricoAnalitico extends Error {}
export class ExecucaoAnaliticaNaoEncontradaError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

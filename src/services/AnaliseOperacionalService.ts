import { AnaliseOperacionalRepository, type FiltroAnaliseOperacional } from "../repositories/AnaliseOperacionalRepository.js";

export class AnaliseOperacionalService {
  constructor(private readonly analises = new AnaliseOperacionalRepository()) {}

  gerarRelatorio(query: Record<string, unknown>, solicitadoPor: string) {
    const dataInicio = this.dataValida(query.dataInicio, "dataInicio", false);
    const dataFim = this.dataValida(query.dataFim, "dataFim", true);
    if (dataInicio && dataFim && dataInicio > dataFim) {
      throw new ErroValidacaoAnaliseOperacional("dataInicio deve ser anterior ou igual a dataFim.");
    }
    const filtro: FiltroAnaliseOperacional = {
      ...(dataInicio ? { dataInicio } : {}),
      ...(dataFim ? { dataFim } : {}),
    };
    return this.analises.gerarRelatorio(filtro, solicitadoPor);
  }

  private dataValida(valor: unknown, nome: string, fimDoDia: boolean): Date | undefined {
    if (valor === undefined) return undefined;
    if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(valor)) {
      throw new ErroValidacaoAnaliseOperacional(`${nome} deve usar AAAA-MM-DD ou timestamp ISO UTC.`);
    }
    const data = new Date(valor);
    if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor.slice(0, 10)) {
      throw new ErroValidacaoAnaliseOperacional(`${nome} não contém uma data válida.`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      if (fimDoDia) data.setUTCHours(23, 59, 59, 999);
      else data.setUTCHours(0, 0, 0, 0);
    }
    return data;
  }
}

export class ErroValidacaoAnaliseOperacional extends Error {}
